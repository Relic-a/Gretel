import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, hardeningMigration, edgeFunction, embeddingProvider, authHook, appShell, videoUtils, supabaseConfig, tauriConfig] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260918060000_managed_embeddings.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260920174007_harden_managed_embedding_release.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/embed/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/feed/embeddings.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/use-gretel-auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/gretel-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/video-utils.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
]);

for (const table of [
  "entitlements",
  "access_codes",
  "embedding_usage",
  "embedding_cache"
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
}

assert.match(migration, /gretel_authorize_embedding_request/);
assert.match(migration, /for update/);
assert.match(migration, /gretel_finalize_embedding_request/);
assert.match(migration, /extensions\.digest/);
assert.doesNotMatch(migration, /grant execute[^;]+authenticated/i);

assert.match(edgeFunction, /withSupabase\(\s*\{ auth: "user" \}/);
assert.match(edgeFunction, /Deno\.env\.get\("OPENROUTER_API_KEY"\)/);
assert.match(edgeFunction, /normalizeEmbeddingText/);
assert.match(edgeFunction, /embedding_cache/);
assert.doesNotMatch(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edgeFunction, /hasExactKeys/);
assert.match(edgeFunction, /MAX_BODY_BYTES\s*=\s*128_000/);
assert.match(edgeFunction, /MAX_INPUTS\s*=\s*32/);
assert.match(edgeFunction, /MAX_ITEM_CHARACTERS\s*=\s*12_000/);
assert.match(edgeFunction, /MAX_TOTAL_CHARACTERS\s*=\s*60_000/);
assert.match(edgeFunction, /AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/);
assert.doesNotMatch(edgeFunction, /body\.model|body\.dimensions/);
assert.doesNotMatch(embeddingProvider, /action: "embed",\s*model:/);
assert.match(supabaseConfig, /verify_jwt\s*=\s*true/);

assert.match(hardeningMigration, /create table public\.managed_allowance_grants/);
assert.match(hardeningMigration, /gretel_grant_managed_inputs/);
assert.match(hardeningMigration, /revoke all on function public\.gretel_grant_managed_inputs[^;]+public, anon, authenticated/is);
assert.match(hardeningMigration, /status = 'reserved'[\s\S]+reservation_expired/);
assert.match(hardeningMigration, /for update/);
assert.match(hardeningMigration, /concurrency_limit_exceeded/);
assert.doesNotMatch(hardeningMigration, /user_metadata/i);

assert.match(embeddingProvider, /ManagedEmbeddingProvider/);
assert.match(embeddingProvider, /getManagedAccessToken/);
assert.match(authHook, /provider: "google"/);
assert.match(authHook, /flowType: "pkce"|exchangeCodeForSession/);
assert.match(authHook, /signInAnonymously/);
assert.match(authHook, /parsed\.protocol === "gretel:" && parsed\.hostname === "auth" && parsed\.pathname === "\/callback"/);
assert.match(authHook, /handledCallbackCodes/);
assert.match(authHook, /window\.addEventListener\("focus"/);
assert.match(authHook, /gretel:managed-usage-changed/);
assert.match(authHook, /window\.sessionStorage\.setItem\(managedAccessTokenKey/);
assert.doesNotMatch(videoUtils, /localStorage\.getItem\(supabaseAccessTokenKey/);
assert.match(appShell, /showSettings && auth\.session/);
assert.match(appShell, /gretel:managed-usage-changed/);

const parsedTauriConfig = JSON.parse(tauriConfig);
assert.deepEqual(parsedTauriConfig.plugins["deep-link"].desktop.schemes, ["gretel"]);
assert.match(parsedTauriConfig.app.security.csp, /grcoyidmgrxiumrezagz\.supabase\.co/);

console.log("managed embeddings integration tests passed");
