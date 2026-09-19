import { withSupabase } from "npm:@supabase/server@1.7.0";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_MODEL = "qwen/qwen3-embedding-8b";
const DEFAULT_DIMENSIONS = 1024;

type SupabaseContext = {
  supabaseAdmin: {
    from: (table: string) => any;
    rpc: (name: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  };
  userClaims?: { id?: string; email?: string; is_anonymous?: boolean };
  jwtClaims?: { sub?: string; is_anonymous?: boolean };
};

const authenticatedHandler = withSupabase(
  { auth: "user" },
  async (request: Request, context: SupabaseContext) => {
    const corsHeaders = getCorsHeaders(request);

    try {
      const userId = context.userClaims?.id || context.jwtClaims?.sub || "";
      if (!userId) {
        return json({ error: "Your Gretel session is no longer valid.", code: "invalid_session" }, 401, corsHeaders);
      }

      const body = await readJsonBody(request);
      const action = typeof body.action === "string" ? body.action : "embed";

      if (action === "status") {
        return handleStatus(context, userId, corsHeaders);
      }
      if (action === "redeem") {
        return handleRedemption(context, userId, body, corsHeaders);
      }
      if (action === "embed") {
        return handleEmbedding(context, userId, body, corsHeaders);
      }

      return json({ error: "Unknown Gretel gateway action.", code: "invalid_action" }, 400, corsHeaders);
    } catch (error) {
      console.error("gretel.embed.unhandled", safeError(error));
      return json({ error: "The embedding gateway could not complete this request.", code: "gateway_error" }, 500, corsHeaders);
    }
  },
);

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: getCorsHeaders(request) });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed.", code: "method_not_allowed" }, 405, getCorsHeaders(request));
    }
    return authenticatedHandler(request);
  },
};

async function handleStatus(context: SupabaseContext, userId: string, corsHeaders: Record<string, string>) {
  const isAnonymous = context.userClaims?.is_anonymous === true || context.jwtClaims?.is_anonymous === true;
  if (!isAnonymous) {
    const { error } = await context.supabaseAdmin.rpc("gretel_ensure_google_entitlement", {
      p_user_id: userId,
    });
    if (error) return databaseError(error, corsHeaders);
  }

  const { data, error } = await context.supabaseAdmin.rpc("gretel_entitlement_status", {
    p_user_id: userId,
  });
  if (error) return databaseError(error, corsHeaders);

  const status = Array.isArray(data) ? data[0] : data;
  return json({
    active: status?.active === true,
    plan: status?.plan || null,
    source: status?.source || null,
    monthlyInputLimit: Number(status?.monthly_input_limit || 0),
    usedInputs: Number(status?.used_inputs || 0),
    remainingInputs: Number(status?.remaining_inputs || 0),
    expiresAt: status?.expires_at || null,
    isAnonymous,
  }, 200, corsHeaders);
}

async function handleRedemption(
  context: SupabaseContext,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
) {
  const code = normalizeAccessCode(typeof body.code === "string" ? body.code : "");
  if (code.length < 12 || code.length > 80) {
    return json({ error: "Enter a valid Gretel access code.", code: "invalid_access_code" }, 400, corsHeaders);
  }

  const codeHash = await sha256(code);
  const { data, error } = await context.supabaseAdmin.rpc("gretel_redeem_access_code", {
    p_user_id: userId,
    p_code_hash_hex: codeHash,
  });

  if (error) {
    const errorCode = databaseCode(error);
    const message = errorCode === "access_code_redeemed"
      ? "That access code has already been used."
      : "That access code is invalid or has expired.";
    return json({ error: message, code: errorCode }, 400, corsHeaders);
  }

  const entitlement = Array.isArray(data) ? data[0] : data;
  return json({
    active: entitlement?.active === true,
    plan: entitlement?.plan || "beta",
    monthlyInputLimit: Number(entitlement?.monthly_input_limit || 0),
    expiresAt: entitlement?.expires_at || null,
  }, 200, corsHeaders);
}

async function handleEmbedding(
  context: SupabaseContext,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
) {
  const requestedTexts = Array.isArray(body.input) ? body.input : [];
  if (requestedTexts.length === 0 || requestedTexts.some((value) => typeof value !== "string")) {
    return json({ error: "Embedding input must be a non-empty list of text.", code: "invalid_input" }, 400, corsHeaders);
  }

  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim().slice(0, 200)
    : DEFAULT_MODEL;
  const dimensions = Number.isSafeInteger(body.dimensions)
    ? Number(body.dimensions)
    : DEFAULT_DIMENSIONS;
  if (dimensions < 1 || dimensions > 32768) {
    return json({ error: "Invalid embedding dimensions.", code: "invalid_dimensions" }, 400, corsHeaders);
  }

  const texts = requestedTexts.map((value) => normalizeEmbeddingText(value as string));
  if (texts.some((value) => value.length === 0 || value.length > 30000)) {
    return json({ error: "Each embedding input must contain between 1 and 30,000 characters.", code: "invalid_input" }, 400, corsHeaders);
  }

  const hashes = await Promise.all(texts.map(sha256));
  const { data: cachedRows, error: cacheError } = await context.supabaseAdmin
    .from("embedding_cache")
    .select("text_hash,embedding")
    .eq("model", model)
    .eq("dimensions", dimensions)
    .in("text_hash", [...new Set(hashes)]);
  if (cacheError) return databaseError(cacheError, corsHeaders);

  const cached = new Map<string, number[]>();
  for (const row of cachedRows || []) {
    if (Array.isArray(row.embedding)) cached.set(row.text_hash, row.embedding);
  }

  const missingHashes = new Set<string>();
  const missingIndexes = hashes.flatMap((hash, index) => {
    if (cached.has(hash) || missingHashes.has(hash)) return [];
    missingHashes.add(hash);
    return [index];
  });
  const requestId = crypto.randomUUID();
  const { data: quotaRows, error: quotaError } = await context.supabaseAdmin.rpc(
    "gretel_authorize_embedding_request",
    {
      p_request_id: requestId,
      p_user_id: userId,
      p_model: model,
      p_requested_inputs: texts.length,
      p_cached_inputs: texts.length - missingIndexes.length,
      p_character_count: texts.reduce((total, text) => total + text.length, 0),
    },
  );

  if (quotaError) {
    const code = databaseCode(quotaError);
    return json({ error: quotaMessage(code), code }, quotaStatus(code), corsHeaders);
  }

  const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;

  try {
    if (missingIndexes.length > 0) {
      const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") || "";
      if (!openRouterKey) {
        await finalize(context, requestId, false, "gateway_not_configured");
        return json({ error: "Managed embeddings are not configured yet.", code: "gateway_not_configured" }, 503, corsHeaders);
      }

      const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Relic-a/Gretel",
          "X-Title": "Gretel",
        },
        body: JSON.stringify({
          model,
          input: missingIndexes.map((index) => texts[index]),
          dimensions,
        }),
      });

      if (!response.ok) {
        const upstreamCode = `openrouter_${response.status}`;
        await finalize(context, requestId, false, upstreamCode);
        return json({ error: "The embedding provider is temporarily unavailable.", code: upstreamCode }, 502, corsHeaders);
      }

      const payload = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
      const returned = [...(payload.data || [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
      if (returned.length !== missingIndexes.length) throw new Error("embedding_count_mismatch");

      const cacheWrites = returned.map((item, returnedIndex) => {
        const embedding = item.embedding;
        if (!Array.isArray(embedding) || embedding.length !== dimensions || embedding.some((value) => !Number.isFinite(value))) {
          throw new Error("invalid_embedding");
        }
        const inputIndex = missingIndexes[returnedIndex];
        cached.set(hashes[inputIndex], embedding);
        return {
          model,
          dimensions,
          text_hash: hashes[inputIndex],
          embedding,
          last_hit_at: new Date().toISOString(),
        };
      });

      const { error: writeError } = await context.supabaseAdmin
        .from("embedding_cache")
        .upsert(cacheWrites, { onConflict: "model,dimensions,text_hash", ignoreDuplicates: true });
      if (writeError) console.error("gretel.embed.cache_write", safeError(writeError));
    }

    const embeddings = hashes.map((hash) => cached.get(hash));
    if (embeddings.some((embedding) => !embedding)) throw new Error("missing_embedding");

    await finalize(context, requestId, true);
    return json({
      data: embeddings.map((embedding, index) => ({ embedding, index })),
      model,
      usage: {
        requestedInputs: texts.length,
        cachedInputs: texts.length - missingIndexes.length,
        billedInputs: missingIndexes.length,
        remainingInputs: Number(quota?.remaining_inputs || 0),
      },
    }, 200, corsHeaders);
  } catch (error) {
    await finalize(context, requestId, false, safeError(error));
    console.error("gretel.embed.failed", safeError(error));
    return json({ error: "The embedding provider returned an invalid response.", code: "invalid_upstream_response" }, 502, corsHeaders);
  }
}

async function finalize(context: SupabaseContext, requestId: string, succeeded: boolean, errorCode?: string) {
  const { error } = await context.supabaseAdmin.rpc("gretel_finalize_embedding_request", {
    p_request_id: requestId,
    p_succeeded: succeeded,
    p_error_code: errorCode || null,
  });
  if (error) console.error("gretel.embed.finalize", safeError(error));
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?|tauri:\/\/localhost|https:\/\/tauri\.localhost)$/.test(origin)
    ? origin
    : "https://tauri.localhost";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function normalizeEmbeddingText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeAccessCode(value: string) {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function databaseError(error: unknown, corsHeaders: Record<string, string>) {
  console.error("gretel.embed.database", safeError(error));
  return json({ error: "The Gretel service is temporarily unavailable.", code: "database_error" }, 503, corsHeaders);
}

function databaseCode(error: any) {
  const message = String(error?.message || error?.details || "");
  const known = [
    "invalid_access_code", "access_code_redeemed", "access_required",
    "request_too_large", "rate_limit_exceeded", "quota_exceeded",
  ];
  return known.find((code) => message.includes(code)) || "request_denied";
}

function quotaMessage(code: string) {
  if (code === "access_required") return "Sign in or redeem an access code to use managed embeddings.";
  if (code === "request_too_large") return "This embedding request is too large.";
  if (code === "rate_limit_exceeded") return "Too many embedding requests. Wait a moment and try again.";
  if (code === "quota_exceeded") return "Your managed embedding allowance has been used for this month.";
  return "This embedding request was denied.";
}

function quotaStatus(code: string) {
  if (code === "rate_limit_exceeded") return 429;
  if (code === "quota_exceeded") return 402;
  if (code === "access_required") return 403;
  return 400;
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message).slice(0, 240);
  return String(error).slice(0, 240);
}
