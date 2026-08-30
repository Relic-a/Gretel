import { errorFields, logError, requestFields } from "../../../lib/logger";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return new Response(null, { status: 401 });
  }

  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message : "Unknown client error";
    const source = typeof body?.source === "string" ? body.source : "unknown";
    const stack = typeof body?.stack === "string" ? body.stack : undefined;
    const details = readClientDetails(body?.details);

    logError("client.error", requestFields(request, {
      source,
      message,
      ...(stack ? { errorStack: stack } : {}),
      ...(details ? { clientDetails: details } : {}),
      url: typeof body?.url === "string" ? body.url : undefined,
      line: typeof body?.line === "number" ? body.line : undefined,
      column: typeof body?.column === "number" ? body.column : undefined
    }));
    return new Response(null, { status: 204 });
  } catch (error) {
    // Reporting must never turn into another user-facing failure.
    logError("client.error_report_failed", errorFields(error, { stack: true }));
    return new Response(null, { status: 204 });
  }
}

function readClientDetails(value: unknown): Record<string, string | number | boolean> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const details: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key)) continue;
    if (typeof entry === "string") details[key] = entry.slice(0, 2_048);
    else if (typeof entry === "number" && Number.isFinite(entry)) details[key] = entry;
    else if (typeof entry === "boolean") details[key] = entry;
  }

  return Object.keys(details).length > 0 ? details : undefined;
}
