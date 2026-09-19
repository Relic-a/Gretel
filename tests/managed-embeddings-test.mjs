import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, edgeFunction, embeddingProvider, authHook, tauriConfig] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260918060000_managed_embeddings.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/embed/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/feed/embeddings.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/use-gretel-auth.ts", import.meta.url), "utf8"),
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

assert.match(embeddingProvider, /ManagedEmbeddingProvider/);
assert.match(embeddingProvider, /getManagedAccessToken/);
assert.match(authHook, /provider: "google"/);
assert.match(authHook, /flowType: "pkce"|exchangeCodeForSession/);
assert.match(authHook, /signInAnonymously/);

const parsedTauriConfig = JSON.parse(tauriConfig);
assert.deepEqual(parsedTauriConfig.plugins["deep-link"].desktop.schemes, ["gretel"]);
assert.match(parsedTauriConfig.app.security.csp, /grcoyidmgrxiumrezagz\.supabase\.co/);

console.log("managed embeddings integration tests passed");

