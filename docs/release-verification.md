# Gretel Release Verification Catalog

Gretel 0.5.3 release verification is split into isolated, verifiable layers: **E2E**, **Chaos**, and **Soak**, plus the **Native Adapter Protocol**. Each layer produces a structured `report.json` satisfying the common schema, with deterministic artifact identity hashes, isolated scratch execution roots, and genuine failure propagation. Missing prerequisites are reported honestly as `blocked` or `not_run`, never masquerading as passes.

---

## Architecture & Verification Layers

| Layer | Entrypoint | Scope & Capabilities Tested | Execution Mode |
| --- | --- | --- | --- |
| **Combined** | `tests/release/run-all.mjs` | Unified release orchestrator across all layers | `--quick`, `--storage-only`, `--strict` |
| **E2E** | `tests/release/e2e/run.mjs` | Clean first run, production standalone server, browser CDP UI, historical migrations | `--mode all`, `--mode migration`, `--mode production` |
| **Native Adapter** | `tests/release/e2e/native-adapter.mjs` | Target OS installer, upgrade, rollback, signature tamper contract | Disposable VM/container target runner with explicit artifacts |
| **Chaos** | `tests/release/chaos/verify-chaos.mjs` | Process termination, write barrier SIGKILL, database lock recovery, network failure, privacy leaks | `--mode quick`, `--mode full` |
| **Soak** | `tests/release/soak/run-soak-verification.mjs` | 180-day accelerated storage, rotation thresholds, byte accounting, resource evaluator | `--storage-only`, `--duration 60` (smoke), 24h/48h (qualification) |

---

## Quick Start: Unified Verification

Build the production standalone artifact first:
```sh
npm run build
cp -a .next/static .next/standalone/.next/static
```

Run the complete release verification suite:
```sh
# Full verification run (E2E all, quick chaos, accelerated storage soak, protocol controls)
node tests/release/run-all.mjs --quick --storage-only --output /tmp/gretel-release-run

# Strict mode: exits 1 if ANY case fails, is blocked, or is not_run
node tests/release/run-all.mjs --quick --storage-only --strict --output /tmp/gretel-release-strict
```

The unified orchestrator produces:
- `<output>/report.json`: Aggregated schema-compliant report with composite artifact manifest SHA-256 (`manifestSha256`), runtime metadata, per-layer breakdowns, and individual case results.
- `<output>/summary.md`: Human-readable Markdown summary with layer tables, identified product defects, and external blocker explanations.

---

## Running Layers Individually

### 1. E2E Layer (`tests/release/e2e/run.mjs`)

Exercises the standalone Next.js server (`.next/standalone/server.js`) and headless Chromium via Chrome DevTools Protocol (CDP):

```sh
# Run full suite (clean first run, production routes, browser UI, migrations)
node tests/release/e2e/run.mjs --mode all --output /tmp/gretel-e2e-all

# Run only historical schema migrations (v0.5.2, v0.5.1, v0.5.0, legacy dynamic embedding tables)
node tests/release/e2e/run.mjs --mode migration --output /tmp/gretel-e2e-migration

# Run unit self-tests & negative controls
node tests/release/e2e/run.mjs --self-test
```

Key guarantees:
- **Clean First Run (`e2e.clean-first-run`)**: Starts with completely empty data directory (no SQLite, no settings). Boots server, drives browser through the onboarding wizard (profile name, topic tags, API key), triggers first feed generation via deterministic YouTube mock fixture (`fixtures/mock-youtube-preload.cjs`), restarts server, and validates exact logical equality before and after restart.
- **Historical Migrations (`e2e.migration.*`)**: Preserves exact historical provenance with lazy schema additions extracted from git history (`git show $tag`). Compares durable records before and after: profile name/tags/channels, masked settings, unmasked raw settings, saved/liked video IDs, exact watch history seconds/ratios, and migrated dynamic embedding vectors (`[1, 0, 0, 0, 0, 0, 0, 0]`).
- **Negative Control**: `runner.migration-assertion-catches-mutation` ensures record comparison catches corruptions or missing data.

### 2. Native Adapter Protocol (`tests/release/e2e/native-adapter.mjs`)

Implements the contract for native desktop package verification:

```sh
# Protocol test suite (harmless runner fixtures validating protocol contract)
node tests/release/e2e/native-adapter-test.mjs

# Target runner invocation (requires explicit artifacts and target runner script)
node tests/release/e2e/native-adapter.mjs \
  --old-artifact /path/to/v0.5.2.deb \
  --new-artifact /path/to/v0.5.3.deb \
  --target-os linux \
  --runner /path/to/target-runner.sh \
  --output /tmp/gretel-native-output
```

The adapter enforces:
- Explicit scratch root isolation with safety guards.
- Manifest and SHA-256 hash identity verification for both old and new artifacts.
- Target platform and package format validation (`deb`, `appimage`, `rpm`, `arch`, `tar.gz`, `msi`, `exe`, `dmg`).
- Timeout enforcement, failure propagation, schema validation, and rejection of stale or malformed runner reports.

### 3. Chaos Layer (`tests/release/chaos/verify-chaos.mjs`)

Stress-tests resilience against filesystem faults, crash interruptions, corrupted state, network outages, and privacy leaks:

```sh
# Quick mode (isolated faults and crash barriers)
node tests/release/chaos/verify-chaos.mjs --mode quick --output /tmp/gretel-chaos-quick

# Full mode (includes randomized kill seeds)
node tests/release/chaos/verify-chaos.mjs --mode full --output /tmp/gretel-chaos-full
```

Key guarantees:
- **Behavioral Settings Crash (`chaos.persistence.settings-write-crash`)**: Uses a deterministic filesystem barrier (`settings-write.barrier.json`) during `writeFileSync` to send `SIGKILL` mid-write. Non-atomic writes fail honestly by corrupting or truncating the file; atomic temp-file-and-rename writes pass.
- **Failed Refresh Feed Preservation (`chaos.feed.failed-refresh-preserves-prior-feed`)**: Builds an initial healthy feed, triggers a refresh with injected external provider failure, verifies the prior feed is intact and usable without wipe, verifies persistence across restart, and demonstrates recovery when providers return to health.
- **Vector Validation (`chaos.vector.corrupted-or-nan`)**: Sends valid JSON containing `NaN` numeric components to verify whether vector calculations validate numeric finiteness before processing.
- **Database Fault Recovery**: Validates that after clearing `SQLITE_BUSY` locks or read-only permissions, a fresh worker successfully writes to the database.
- **Privacy Leak Scanner**: Inspects unscrubbed synthetic stdout/stderr logs for canary leaks before writing sanitized evidence.
- **Evidence Collision Prevention**: Evidence files are uniquely named `${safeId}.${operation}.*`.

### 4. Soak Layer (`tests/release/soak/run-soak-verification.mjs`)

Evaluates resource stability, logging rotation, database size boundaries, and memory trends:

```sh
# Accelerated 180-day storage verification
node tests/release/soak/run-soak-verification.mjs --storage-only --storage-days 180 --output /tmp/gretel-soak-storage

# Short wall-clock smoke test (60s)
node tests/release/soak/run-soak-verification.mjs --duration 60 --interval 5 --output /tmp/gretel-soak-smoke

# Production evaluators & negative controls
node tests/release/soak/soak-metrics-eval.mjs
node tests/release/soak/soak-runner-test.mjs
```

Key guarantees:
- **Production Evaluator Module (`tests/release/soak/soak-evaluator.mjs`)**: Evaluates RSS drift, slope trend, and idle CPU usage using `CLK_TCK` obtained via `getconf CLK_TCK`. Tested against stable traces, memory leaks, high idle CPU, process restarts, and negative controls.
- **Isolated Storage Worker (`tests/release/soak/storage-worker.mjs`)**: Storage logic runs in an isolated child process with controlled stdin lifecycle, preventing `lib/logger.ts` EOF handlers from terminating the parent process with `exit(0)`.
- **Accurate Disk & Byte Accounting**: Correctly probes SQLite `-wal` and `-shm` sidecar files; measures physical file sizes; accounts for UTF-8 bytes (`LENGTH(CAST(val AS BLOB))`) instead of character lengths.
- **Negative Rotation Control**: Verifies that disabling rotation causes the log boundary check to fail.

---

## Release Qualification: 24h/48h Soak Execution

For final release qualification, run the extended soak suites on dedicated qualification hosts:

```sh
# 24-Hour Soak Qualification
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 365 \
  --duration 86400 \
  --interval 10 \
  --strict \
  --output /var/log/gretel-soak-24h

# 48-Hour Extended Soak Qualification
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 365 \
  --duration 172800 \
  --interval 15 \
  --strict \
  --output /var/log/gretel-soak-48h
```

### Evaluator Thresholds for Qualification:
1. **Warm-up Interval**: 10 minutes (600 seconds).
2. **RSS Median Stability**: Final idle median RSS must be within `max(64 MiB, 20%)` of the first post-warm-up idle median.
3. **RSS Trend**: Non-positive or bounded slope over >=2 hours.
4. **Idle CPU Usage**: Mean idle CPU <= 2% of one core; 95th percentile <= 5% of one core over a sustained 10-minute idle window.

---

## Honest Defect Breakdown

The verification harness is designed to expose legitimate product bugs rather than masking them:

### Known Product Defects (Failing Honestly)
1. **Cache Cleanup Symlink Escape (`soak.cache.symlink-escape`)**: Cache deletion operations follow symbolic links outside the configured cache directory, potentially removing external files.
2. **Stale Cache Key Retention (`soak.cache.stale-keys`)**: Thumbnails and avatar cache entries lack an automatic expiration/eviction policy, allowing unbounded growth over simulated 180-day workloads.
3. **Non-Atomic Settings Write (`chaos.persistence.settings-write-crash`)**: Settings writes overwrite `user-settings.json` directly without an atomic write-and-rename barrier, causing file truncation or corruption if interrupted mid-write.
4. **NaN Vector Acceptance (`chaos.vector.corrupted-or-nan`)**: The embedding provider pipeline accepts `NaN` floating point values in valid JSON, propagating `NaN` into downstream centroid drift calculations.
5. **Raw Log Canary Leaks (`chaos.privacy.credential-leak`)**: Unredacted canary secrets appear in stdout/stderr logging streams prior to sanitization.

### External Blockers (Reported as `blocked`)
1. **Native OS Packaging (`native.adapter`)**: Native installation, upgrade, and GUI lifecycle verification requires disposable target OS environments (Debian/Ubuntu, Arch, Fedora, Windows sandbox, macOS VM) with explicit installer artifacts. When runners are unavailable, the adapter cleanly marks the case `blocked` without false passes.
