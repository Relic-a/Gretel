# Release verification: chaos (layer scope)

**Scope and honesty:** This is a deterministic module-integration and
production-server chaos harness. It does **not** prove native-package operation,
packaged updater behavior, WebView playback quality, feed relevance, or a full
24–48 hour soak. The optional browser harness was not used because Playwright
was not installed; HTTP API evidence cannot assert visual feed preservation.

## How to run

```bash
# quick gate
SCRATCH=$(mktemp -d /tmp/gretel-chaos-XXXXXXXX)
node tests/release/chaos/verify-chaos.mjs --output "$SCRATCH/artifact" --mode quick --strict

# representative full gate (no host disk pressure; no outbound services)
SCRATCH=$(mktemp -d /tmp/gretel-chaos-XXXXXXXX)
node tests/release/chaos/verify-chaos.mjs --output "$SCRATCH/artifact" --mode full --strict --seed 424242
```

Do not install dependencies in the main checkout. Install this worktree's
tracked dependencies separately if absent.

The runner compiles the production TypeScript modules into a private CommonJS
scratch build, then starts each worker with an allowlisted environment. Every
case receives a fresh data directory, settings/config copy, log destination,
browser-profile directory, synthetic API token, and localhost-only fixture.
The runner keeps worker stdin open because the production logger treats stdin
EOF as desktop shutdown. Workers are killed only by their parent process and
all evidence copied to `--output` is canary-redacted. The ignored
`tests/release/**` tree is intentionally force-added by the release verifier
owner; no shared ignore rule is changed.

## Scenarios

- `chaos.process.kill.after-write` — kill a real loader child immediately after
  an acknowledged transaction; restart the same data, then verify integrity,
  foreign keys and durability. Full mode repeats 10 seeded cases.
- `chaos.network.retry-budget` — 429, 500, hang, reset, truncated JSON, wrong
  and NaN embedding vectors. Confirms bounded attempts/timeouts, prior pool
  preservation after failed refresh, and recovery with a valid vector. HTTP
  429/500 are observed as one-attempt application errors because the current
  `fetchWithNetworkRetry` contract retries transport failures only.
- `chaos.cache.thumbnail-write-in-flight` — kill an owned worker after a real
  localhost thumbnail response reaches the cache write path, then verify no
  partial file is readable after restart.
- `chaos.concurrency.build-reset` — 20 concurrent same-profile workloads, then
  destructive operation. Confirms reset is observable through the production
  profile API and that stale process-local state cannot survive a real restart.
- `chaos.config.corruption` — malformed/absent config, malformed settings and
  pool JSON, SQLite corruption: safe recovery or explicit blocked recovery, no
  crash loop or silent reset.
- `chaos.privacy.canary` — nested headers/objects, arrays, cookies, URLs,
  error stacks and `/api/client-errors`; scans logs, rotations, performance
  traces and diagnostics export for raw/base64/urlencoded canaries.
- `chaos.api.auth` — every sensitive production route rejects missing and
  incorrect tokens and failed authorization does not mutate state.
- `chaos.diagnostics.bundle` — capability discovery gate. If no user-obtainable
  sanitized support bundle exists, the required gate is blocked, never passed.
- `chaos.runner.negative` — failing fixture, missing prerequisite and
  cancellation checks prove the runner itself cannot silently go green.

## Current findings

1. `lib/settings.ts` performs an in-place, non-atomic `writeFileSync`. A process
   kill during save can leave truncated JSON. Parsing recovers defaults, but the
   prior complete settings object is not preserved. This harness records a fail.
   *Suggested minimal fix:* write `user-settings.json.tmp` in the same directory,
   fsync it, then `renameSync` atomically over the destination.
2. Free-text/error canaries reach two runtime artifacts (log and enabled
   performance trace) even though sensitive
   key names and authorization headers are redacted. This harness records a
   fail. Error values, stacks, nested arrays and URL/query fields need a
   privacy-safe policy before support artifacts can be shared.
3. No user-obtainable sanitized diagnostics bundle was discovered: `/diagnostics`
   is local, token-gated analytics, and no support-bundle route/action exists.
   The required diagnostics gate is therefore blocked.
4. The concurrent build/reset workload reaches the destructive profile action
   before a deterministic YouTube/provider boundary acknowledgement. It is
   reported blocked rather than treating HTTP-only setup as proof of feed
   serialization or UI preservation. The production YouTube client has no
   explicit test endpoint seam.
5. A real BEGIN-before-COMMIT kill barrier, contained ENOSPC injection, and
   browser-visible feed preservation remain blocked. The report records each
   gate explicitly; it does not substitute toy SQLite, host disk pressure, or
   HTTP-only assertions for those missing boundaries.

## SQLite corruption policy

SQLite corruption is not automatically repaired. The harness seeds a backup and
asserts that corruption produces an explicit recoverable state and that backup
restoration succeeds when explicitly requested by the operator. Silent loss or a
new blank database is not accepted as success.

## Evidence from the checked smoke run

With Node v26.7.0, `--mode quick --seed 12345` produced 24 case records: 17
passes, two product failures for settings atomicity/privacy redaction, and
five honest blocked gates for concurrent build/provider acknowledgement, user
diagnostics export, BEGIN-before-COMMIT, ENOSPC, and browser-visible feed
preservation. The full mode repeats the process kill case for 10 deterministic
seeds and adds the remaining provider fault variants; it is intentionally short
and is not a 24–48 hour soak.
