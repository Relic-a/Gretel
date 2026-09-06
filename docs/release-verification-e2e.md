# Gretel E2E release verification

This layer verifies the packaged Next.js production server, its browser-facing HTTP contract, old local database schemas, and the native package adapter contract. It is verification tooling under `tests/release/e2e/`; it does not add test bypasses or change the shipped runtime.

## Commands and evidence

Build and materialize the standalone asset directory in the isolated worktree before running the gate:

```sh
npm ci
npm run build
cp -a .next/static .next/standalone/.next/static
node tests/release/e2e/run.mjs --mode all --strict --output /tmp/gretel-e2e-output
```

The copy is the same static-asset materialization performed by `scripts/prepare-tauri.mjs`; a missing font or chunk in the standalone directory is a failed artifact gate. The verifier starts `.next/standalone/server.js` with an allow-listed environment containing only synthetic `GRETEL_DATA_DIR`, `GRETEL_LOG_FILE`, `GRETEL_CONFIG`, and `GRETEL_API_TOKEN` values. Each child owns a fresh `mkdtemp` run root. Synthetic settings are redacted from support evidence.

The report contract is `schemaVersion: 1`. Every case has a stable id, criterion, status, duration, evidence paths, failure reason when applicable, scope, and measurements. `--strict` returns nonzero for `fail`, `blocked`, or `not_run`; ordinary failures return nonzero in every mode. `--self-test --strict` checks the strict failure policy, missing-prerequisite blocking, and bounded process-group cleanup.

The production cases cover authenticated startup (threshold 30 seconds), token rejection, static JavaScript/CSS/font loads, profile creation and preferences, masked settings persistence, seeded feed serving, save/like/watch handlers, explicit missing-pool failure, concurrent writes, server restart persistence, and reset behavior. The reset case records the current behavior: it clears saved, liked, history, interactions, impressions, algorithm rows, and feed-pool rows while retaining the profile.

The browser cases use system Chromium through the Chrome DevTools Protocol. They use real DOM controls and real HTTP handlers, with no `/api/*` response interception. They cover boot, save and like clicks, settings UI, profile creation UI, switching to the second profile, corrupted localStorage recovery, and an independent fresh browser profile reading persisted saved data. Request failures and JavaScript exceptions are captured; the one expected `POST /api/feed/build` 400 is recorded when the UI creates an intentionally empty profile and is excluded from the unexpected-failure count. A seeded pool is deterministic provider-boundary coverage and does not claim initial YouTube/OpenRouter discovery.

## Migration evidence

`run.mjs --mode migration` reads the exact `lib/profile-store.ts` and `lib/feed/algorithm-store.ts` sources at tags `v0.5.2`, `v0.5.1`, and `v0.5.0` through `git show`, hashes those sources, extracts the old profile-store schema, and inserts synthetic profiles, preferences, saved/liked rows, watch history, and pool metadata. The current server then opens each database and the gate checks durable records, `integrity_check = 'ok'`, and an empty `foreign_key_check`. A dynamic-table case also exercises the current algorithm-store migration from `feed_centroids_<store-key>` and `feed_video_embeddings_<store-key>` into the current keyed tables and confirms the legacy tables are retired.

These are source-schema migration proofs. They are not proof that a previously published installer binary upgrades correctly. Exact old artifacts are required for that claim and are currently absent from this worktree, so the native upgrade cases remain blocked.

## Native package protocol

`native-adapter.mjs` accepts explicit old/new artifact paths, an explicit target OS, and an executable disposable runner. It records hashes and inventory identity. It defines cases for fresh install, reinstall with data preservation, old-to-new upgrade, explicit keep/remove uninstall, GUI/shell startup and child shutdown, tampered or wrong-signature payloads, interrupted downloads, install failure rollback, successful relaunch, and Arch’s manual update path. Until a target runner returns validated protocol evidence, these cases remain `blocked`; mocked updater UI tests cannot satisfy them. The release workflow currently builds Windows, macOS, Linux deb/rpm/AppImage, and an Arch package derived from the Linux deb. The Arch package has an `.arch-package` marker and must remain manual-update evidence.

No production signing key, host installation, firewall, package manager, or external service is used by these checks. Live provider canaries, real installer upgrades, GUI lifecycle checks across target OSes, and long-duration stability belong in disposable CI/nightly jobs.

## Release decision

The verifier is evidence-producing rather than a release publication mechanism. A release gate is blocked when a required artifact, old binary, target runner, browser, or diagnostic feature is missing. Passing seeded server/browser cases does not authorize publication and does not cover provider discovery, ranking relevance, real-video playback quality, native package lifecycle, or the 24–48 hour soak. The common catalog maps as follows:

| Criterion | E2E case | Required evidence | Hard blocker |
| --- | --- | --- | --- |
| Production server and durable UI state | `e2e.startup`, `e2e.persistence`, `e2e.browser` | `report.json`, server log, browser evidence | Artifact missing, startup timeout, unexpected request/page error |
| Legacy local data | `e2e.migration.*` | Source hashes, migrated DB checks | Old source/tag or integrity evidence missing |
| Native install/update | `native.*` | Target-runner report and artifact hashes | Any missing package, signature, target OS, or disposable runner |
| Fault and concurrency | `e2e.fault-handling`, `e2e.concurrency` | HTTP measurements and sanitized logs | Error silently passes, profile leakage, or cleanup failure |
| Fault injection and long stability | Chaos/soak sibling layers | Their own reports and serial/nightly commands | Missing required evidence; no automatic substitution by E2E |

There is no automatic publication or claim that the current public release is fully verified.
