# Verification repair handoff — 2026-09-07

Implementation commit: `7257dac8a9b21ccb743810bc7c58625b396008a7`. Branch: `verify/review-repair-20260907`. Worktree: `/tmp/gretel-verification-repair`.

This is an isolated repair branch from `328634c8cb83a631faa07260ece58aa550381950`; main and the original integration/sibling worktrees were not modified, merged, pushed, or published. No host native installation or real-credential tests occurred. The final delivery commit adds this handoff document; its SHA is in the final response / `git rev-parse HEAD`.

## Results and exact commands

All commands below ran from the repair worktree. Exit 1 for strict release runs is expected and is not represented as a qualified release.

| Command | Exit | Observed result / evidence |
| --- | ---: | --- |
| `node tests/release/run-all.mjs --quick --storage-only --strict --output /tmp/gretel-review-subreaper-final` | 1 | 64 cases: **51 pass, 6 product fail, 6 blocked, 1 not_run; 0 tooling failures**. Eight protocol groups passed. Report: `/tmp/gretel-review-subreaper-final/invocation-4fnorC/report.json` |
| `node tests/release/chaos/verify-chaos.mjs --mode full --strict --output /tmp/gretel-review-1488a53-full` | 1 | 40 cases: **32 pass, 4 fail, 4 blocked**. Report: `/tmp/gretel-review-1488a53-full/report.json` |
| `node tests/release/soak/run-soak-verification.mjs --skip-storage --duration 60 --interval 5 --strict --output /tmp/gretel-review-final-wall` | 1 | **8 pass, 0 fail, 2 blocked, 4 not_run**. Report: `/tmp/gretel-review-final-wall/report.json`. Required duration/provider evidence remains unavailable. |
| `node tests/release/run-all-test.mjs` | 0 | 16 CLI controls, including a passing-JSON orphan daemon; `/tmp/gretel-unified-controls-IWfpaN/outcomes.json` |
| `node tests/release/e2e/native-adapter-test.mjs` | 0 | 24 independent protocol controls plus cancellation after passing JSON, during a pending local HTTP request, and during partial report writing; `/tmp/gretel-native-controls-9Wi2dP` |
| `node tests/release/soak/storage-rotation-test.mjs` | 0 | Healthy logger passes; no-op logger, dropped append writes, disabled renames, and incorrect retention all fail the same gate; `/tmp/gretel-rotation-controls-RJMn34/outcomes.json` |
| `node tests/release/lifecycle-test.mjs` | 0 | Detached descendant, real server startup/idle, and real storage compilation/workload cancellation; `/tmp/gretel-lifecycle-controls-ZpaZYy` |
| `node tests/release/soak/soak-metrics-eval.mjs` | 0 | Actual evaluators and CLI virtual scheduler; stable jitter passes, mixed phases/gaps/invalid samples/restarts/earlier leaks cannot pass. Exact durable-row corruption controls pass. |
| `node tests/release/artifact-identity-test.mjs` | 0 | In-place artifact mutation changes hash; internal symlinks materialized; escaping symlinks invalidate identity. |
| `node tests/release/soak/soak-runner-test.mjs` | 0 | Stale output, worker EOF/exit regression, real logger no-op and zero duration controls. |
| `npm run lint` | 0 | TypeScript check. |
| Node `--check` over all 34 verification `.mjs` / `.cjs` files; Python AST parse; `git diff --check` | 0 | Syntax and whitespace checks. |

The combined run was against clean commit `5c8c96a5412680c853eed64b6d77d978aeeff5c1`; the full chaos run was against `1488a538e8020b502009928695420d41e1779866`, with identical chaos application/worker source. The final implementation commit adds native cancellation tests and strengthens the smoke-operation criterion; its wall run is reported below. The selected unchanged standalone manifest SHA is `0fe99df3ed6d8f6de824b56ced2882dc10af5091941f60f381a969b1f4d9cd69` (1,583 files).

The combined command includes clean-state/browser E2E and exact historical migration checks: **16 pass, native qualification blocked**. It includes 180-day accelerated storage: **7 pass, 2 product fail, 1 native blocker, wall skipped**. It does not run a wall soak; that was separately exercised above.

All **204 combined case evidence references** were checked as existing regular files relative to the combined report. Layer reports and protocol subprocess evidence are retained. Synthetic settings keys were absent from the shareable chaos output scan; raw-source scan metadata is recorded before sanitization.

## Reproduced false greens

| Review probe | Repair / negative result |
| --- | --- |
| Unified layer exits 23 without report | Explicit tooling failure case and exit 1; fresh per-invocation root and execution token prevent stale reuse. |
| Native runner writes all-pass JSON, no evidence, exits 23 | Runner exit remains authoritative. Evidence must be nonempty, regular, contained and copied to generated paths. Each validation has a separate CLI control. |
| Loaded logger `logInfo` is disabled | Actual retained records, rotations, ordering, dropped oldest record, active destination and recovery assertions fail. Healthy loaded logger passes. |
| Realistic 10,001ms samples produce undersized windows | Selection uses bracketing observations from complete phases. Stable jittered ten-minute windows pass through the real evaluator. |
| CPU calculation bridges active work | Phase identity and full interval coverage are mandatory; active transitions, generation changes and excessive gaps prevent idle qualification. |

Additional controls reject malformed/current-looking stale reports, mismatched artifacts, duplicate/unexpected/missing cases, invalid statuses, escaping or symlink evidence, signals, timeouts, and orphan daemons. The custom artifact fixture actually executes the selected artifact. Linux descendant ownership uses a subreaper, with bounded TERM/KILL cleanup and reaping.

## Remaining work, without false qualification claims

**Product blockers:** cache cleanup follows a symlink outside its data root; stale pool keys/visited rows/old embeddings lack cleanup; interrupted in-place settings writes lose state; synthetic keys reach logs; the vector pipeline accepts the malformed string `"NaN"`; simultaneous builds perform duplicate provider work. Deletion succeeded in the concurrency case; stale resurrection was not observed. Missing diagnostics export is a **product capability gap**.

**Tooling gaps explicitly blocked:** a real before-COMMIT injector, contained ENOSPC injection, browser-visible failed-refresh assertions, and integration of the existing E2E provider/task fixture into soak refresh/drain checks. They are not classified as unavailable external platforms. The settings partial-write barrier covers synchronous final and temporary-file strategies; arbitrary asynchronous/low-level implementations need an appropriate observed boundary.

**Platform / duration evidence:** real disposable native installer/updater implementations and qualification remain unavailable. No 24h/48h wall run was performed. The CLI virtual-time run covers about three hours of scheduling but is synthetic evidence. Linux lifecycle controls do not establish equivalent Windows/macOS descendant tracking. Memory/evidence caps fail closed when coverage is exhausted rather than claiming long-duration qualification.

See [REVIEW-REPAIRS.md](REVIEW-REPAIRS.md) for the native contract, resource thresholds, implementation limits and exact next 24h/48h/native commands. These remaining gaps are not presented as repaired merely because negative controls pass.

## Changed files

All changes are verification code, test fixtures or documentation. No application behavior changed.

```text
tests/release/REVIEW-REPAIRS.md
tests/release/artifact-identity-test.mjs
tests/release/artifact-identity.mjs
tests/release/case-category.mjs
tests/release/case-inventory.json
tests/release/chaos/chaos-worker.mjs
tests/release/chaos/verify-chaos.mjs
tests/release/e2e/fixtures/mock-native-runner.mjs
tests/release/e2e/fixtures/native-protocol-control.mjs
tests/release/e2e/native-adapter-test.mjs
tests/release/e2e/native-adapter.mjs
tests/release/e2e/run.mjs
tests/release/fixtures/layer-control.mjs
tests/release/lifecycle-test.mjs
tests/release/owned-process.mjs
tests/release/owned-supervisor.py
tests/release/run-all-test.mjs
tests/release/run-all.mjs
tests/release/soak/durable-evaluator.mjs
tests/release/soak/report-schema.mjs
tests/release/soak/run-soak-verification.mjs
tests/release/soak/soak-cli.mjs
tests/release/soak/soak-evaluator.mjs
tests/release/soak/soak-metrics-eval.mjs
tests/release/soak/soak-runner-test.mjs
tests/release/soak/storage-accelerated.mjs
tests/release/soak/storage-rotation-test.mjs
tests/release/soak/storage-worker.mjs
tests/release/REVIEW-HANDOFF.md
```

## Final wall evidence

The final 60-second wrapper run has no tooling or product failures. It remains strict-exit 1 because refresh/drain fixture integration is blocked, storage was explicitly skipped, and ten-minute/two-hour resource windows were not run. Its observed post-setup counters were:

```json
{
  "browse": 1,
  "nonEmptyBrowse": 1,
  "impressions": 1,
  "watch": 1,
  "refresh": 0,
  "switchProfile": 1,
  "totalWorkloadCycles": 4
}
```

The acknowledged watch row was verified unchanged after restart, including durations, ratio, metadata and timestamp. Both owned server ports were checked closed after teardown. No 24–48h soak was claimed.
