# Gretel soak release verification

This layer verifies storage retention and sustained production-server behavior. It is intentionally separate from the normal application test script and does not change shipped runtime code.

Run the full short smoke from this worktree with:

```sh
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 180 --duration 60 --interval 5 \
  --seed release-smoke --output /tmp/gretel-soak-release-smoke
```

Use `--storage-days 365` for the optional one-year accelerated fixture. The wall-clock command is ready for CI and qualification runs, but a short run cannot qualify the long-duration gates:

```sh
node tests/release/soak/run-soak-verification.mjs \
  --skip-storage --duration 1800 --interval 10 \
  --seed ci-soak --output /tmp/gretel-soak-ci

node tests/release/soak/run-soak-verification.mjs \
  --skip-storage --duration 86400 --interval 30 \
  --seed qualification-24h --output /tmp/gretel-soak-24h --strict
```

The 24-hour command is the minimum proposed qualification duration. A 48-hour run uses `--duration 172800`. Do not treat `--duration 60` or `--duration 120` as evidence for two-hour RSS slopes, final ten-minute idle stability, or idle CPU limits. A missing build, invalid artifact, failed child startup, cancellation, and every `not_run` or `blocked` case return nonzero with `--strict`.

Each run uses a fresh output child root with separate data, log, config, child `HOME`, and browser-profile directories. The server child receives an allowlisted environment and a synthetic API token. Deterministic mode loads `network-guard.mjs`; loopback requests are allowed and all other HTTP(S) requests are recorded with query strings removed and rejected before network I/O. A preseeded SQLite pool exercises the real `/api/feed` serving route. The refresh route is attempted under the guard, but the repository has no production fixture seam for successful YouTube refresh, so `soak-refresh-fixture` is deliberately `blocked` until one is supplied. This keeps a blocked prerequisite visible instead of counting a network failure as a refresh pass.

The storage workload creates three profiles and 180 (or 365) simulated days of unique watched, saved, liked, interaction, impression, pool, visited, centroid, embedding, thumbnail, session, log, and performance-trace records. It calls the production profile, pool, algorithm, metrics, and `cleanupOldCaches(now)` routines. Direct SQL is used only to backdate disposable metrics, pool state, centroids, and embedding rows so the production 30-day write cleanup can be triggered reproducibly. It also changes the synthetic embedding model between `mock/hash-v1` and `mock/hash-v2`, forces the configured pool cap through `prunePool`, and captures SQLite WAL checkpoints, page counts, freelist, allocated/free page bytes, table row counts, and logical payload bytes by table.

The report is `report.json`. Sanitized evidence is written below the requested output root:

| Artifact | Meaning |
| --- | --- |
| `storage/storage-snapshot.json` | Storage counts, payload sizes, filesystem categories, page accounting, model-key count, durable checksum, and storage cases |
| `logs/metrics.jsonl` | Owned server-process RSS, CPU ticks, open FDs, threads, children, completed operations, and errors |
| `logs/events.jsonl` | Bounded server stdout/stderr, exit, spawn, operation, and cleanup events |
| `logs/network-guard.jsonl` | Guard initialization and redacted blocked outbound requests |

The storage report also includes `soak-storage-updater-temp-budget` as `blocked`: native updater temporary locations are not visible to this server-only harness and require package-layer evidence.

Every report case has a stable ID, criterion, `pass`, `fail`, `blocked`, or `not_run` status, duration, relative evidence paths, and a failure reason. `artifactMetadata` identifies the server mode, package version, artifact path/hash when available, and evidence paths. RSS is the complete owned process tree sampled through `/proc`; it is not a JavaScript heap measurement, and the harness process is excluded.

The proposed disposable storage budget is 512 MiB. It is a policy target for release review, not an existing guarantee. The logger gate is at most four files and 20 MiB total, with the logger's 5 MiB active-file and three-rotation policy; the check permits and reports at most a 16 KiB final-record overshoot. The feed pool gate is per profile and pool key. The proposed wall-clock gates, after at least ten minutes of warm-up and enough samples, are final idle RSS median within `max(64 MiB, 20%)` of the first post-warm-up ten-minute window, RSS trend p95 at most 1 MiB/hour over at least two hours, idle CPU mean at most 2% of one core and p95 at most 5% over ten minutes, zero unexpected crashes, and teardown within five seconds. Thresholds are reference-machine dependent and are recorded in the report.

The current smoke evidence exposes two release blockers in the existing production policies:

* `soak-storage-symlink-escape` fails because `lib/cache-cleanup.ts` follows a symlinked directory during recursive cleanup and deleted the stale file in the owned outside-data fixture. A file symlink target was preserved; directory traversal still needs a production fix that uses `lstat` and refuses links before recursion.
* `soak-storage-stale-key-policy` fails with changing pool and embedding keys because old `feed_pool_state`, `feed_visited_videos`, `feed_centroids`, and `feed_video_embeddings` rows remain. The workload reports the observed counts and does not delete history, saved, liked, or other user-owned records to manufacture a plateau. A retention policy and migration behavior for stale keys must be decided before this gate can pass.

The short smoke also proves startup, profile creation, preseeded feed serving, watch and impression writes, profile listing, restart, post-restart history, deterministic network blocking, owned-process teardown, and report plumbing. It leaves the RSS trend, idle RSS, and idle CPU qualification cases `not_run`; it is not a release qualification result. `soak-metrics-eval.mjs` separately tests stable versus rising synthetic RSS signals, missing-artifact startup, cancellation cleanup, and a deliberately failing strict fixture.
