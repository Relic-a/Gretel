# Second-review repair contract

This follow-up repairs verification tooling without changing application behavior. Work is isolated on `verify/review-repair-20260907` in `/tmp/gretel-verification-repair`, based on integration commit `328634c8cb83a631faa07260ece58aa550381950`. Dependencies and the existing standalone build were independently copied (not symlinked) from the integration checkout. The application build is unchanged; its complete manifest is recorded by each server layer. Chaos identifies the application/source-worker inputs it actually compiles.

## Executable checks

From the repair checkout:

```sh
node tests/release/run-all-test.mjs
node tests/release/e2e/native-adapter-test.mjs
node tests/release/soak/storage-rotation-test.mjs
node tests/release/soak/soak-metrics-eval.mjs
node tests/release/lifecycle-test.mjs
node tests/release/artifact-identity-test.mjs
node tests/release/soak/soak-runner-test.mjs
node tests/release/run-all.mjs --quick --storage-only --strict --output /tmp/gretel-release-review
node tests/release/chaos/verify-chaos.mjs --mode full --strict --output /tmp/gretel-chaos-full-review
node tests/release/soak/run-soak-verification.mjs --skip-storage --duration 60 --interval 5 --strict --output /tmp/gretel-wall-review
npm run lint
```

Use fresh output directories. The unified runner creates `invocation-*` beneath the supplied directory and prints its report path. Exit 1 is expected for actual product defects and required blocked/not-run cases under `--strict`; it must not be described as a successful qualification. Each layer's nonzero exit is authoritative unless it is the explicitly supported exit-1 outcome accompanied by nonpassing cases. Signals, timeouts, crashes, malformed identity, missing evidence and invalid inventories produce tooling failures. Required inventories are included in the combined report; skipped layers have explicit missing cases. The `--self-test --fixture-layer FILE` interface is for owned harmless executable fixtures only and labels its report `self-test`.

The unified CLI controls cover healthy execution, exit 23 with/without JSON, signal, timeout, malformed JSON, stale token, missing/duplicate/invalid cases, absent/missing evidence, wrong artifact, reported failure and a skipped qualification layer. The fixture checks the actual custom-artifact argument and executes the selected harmless artifact. Native controls independently exercise hashes and run tokens, platform, architecture, package identity, absent/empty/missing/directory evidence, traversal, symlinks, duplicate/unexpected cases, exit versus reported failure, timeout, and cancellation after passing JSON.

The logger controls mutate the loaded logger or its actual filesystem dependency. They disable `logInfo`, append writes, renames, or correct retention. The healthy and broken cases execute the same gate. It checks actual retained logger records, ordering, removal of the oldest record, new active-file writes, recovery after a directory write error, and configured byte/count bounds. Worker exit regression uses the dedicated logger failure, independent of the product's cleanup defect.

## Resource and lifecycle evidence

Idle phases perform no workload requests for a full ten-minute measurement period, sampled throughout. Evaluators require one phase identity, continuous coverage with at most a 30-second gap, positive RSS, valid process measurements, and compatible PID/kernel-start-time identities. Samples bracket jittered window boundaries. First/final RSS windows must be separate. The default thresholds remain ten-minute warm-up, ten-minute idle windows, RSS allowance max(64 MiB, 20%), two-hour trend at <=1 MiB/hour p95, CPU mean <=2% and p95 <=5% of one core.

`soak-cli.mjs --phase-self-test` runs about three hours of virtual scheduling through the imported scheduler and actual window/evaluation functions. This is explicitly synthetic evidence, not a three-hour or 24-hour wall run. Controls cover active transitions, realistic 10,001ms spacing, missing/truncated/zero measurements, restarts, gaps, short smoke, high CPU/RSS and an earlier leak.

Metrics and idle samples have an explicit 200,000-sample cap; exhaustion invalidates trend coverage. JSONL evidence is appended incrementally with 64 MiB per-file budgets; failure or exhaustion is a failing evidence gate. Hashing is streamed and fatal-event counts are incremental. Watch operations reuse a bounded set of synthetic video IDs, retain exact acknowledged SQLite rows, and compare both HTTP metadata and durable rows after restart.

The Linux owned-process supervisor uses Python 3 and `PR_SET_CHILD_SUBREAPER` so detached descendants cannot escape ownership when a parent exits between observations. It records PID plus kernel start time and rejects a runner that exits while descendants remain, even with passing JSON. Cancellation is registered before long work; shutdown uses TERM then bounded KILL, and reports incomplete work. Controls verify real storage compilation/workload cancellation, real server startup/idle cancellation, detached descendant teardown, and that the owned server port no longer accepts connections. This does not establish exhaustive cancellation coverage at every possible instruction, nor equivalent descendant tracking on Windows/macOS. HTTP/CDP probes now have deadlines.

## Native runner contract

No native packages are installed by these tests. A runner path alone does not declare a disposable environment. Harmless mocks require `--protocol-test`; real runners require `--disposable-contract owned-disposable-target-v1`, which is an explicit caller assertion that the current target is disposable. The adapter does not provision or attest a VM/container. Real OS/package implementations and their installer evidence remain required.

The adapter supplies `--run-id`, `--scratch-dir`, `--evidence-dir`, `--report-file`, old/new artifact paths and hashes, `--target-os`, `--package-format`, `--architecture`, `--qualification`, and comma-separated `--case-ids`. The runner receives only PATH, LANG and fresh HOME/TMPDIR, with no inherited credentials. Its schema-1 report must echo the run/platform/architecture/package/qualification/hash identity and exactly the supplied cases. Statuses are `pass`, `fail`, `blocked`, `not_run`; passing scenarios require nonempty regular evidence files inside the owned evidence root, without traversal or symlinks. Evidence is copied to generated filenames after the runner exits. The adapter rejects any nonzero runner exit, signal, timeout, cancellation or surviving descendant, even if JSON says pass.

Arch requires manual-update evidence and omits automatic-updater scenarios; other recognized formats omit the Arch-only case. Unknown formats and package-extension/declared-format mismatches cannot pass inventory validation. Protocol fixtures always remain `protocol-test`, never native qualification.

## Scope and remaining release blockers

* Product failures retained: cache symlink escape, stale pool-key/embedding retention, interrupted in-place settings-write loss, synthetic secret logging, malformed embedding component types (the string `"NaN"` in valid JSON), and duplicate provider work. The concurrency result does not claim observed stale resurrection.
* Product capability gap: no user-obtainable sanitized diagnostics export.
* Tooling gaps remain explicitly blocked: before-COMMIT injection, contained ENOSPC injection, browser-visible failed-refresh preservation, and integrating the existing E2E provider/task counters into soak refresh/drain assertions. These are not classified as external platform prerequisites.
* Chaos now tests same-pool expansion failure after candidate acknowledgement and at the embedding boundary, exact stored-node preservation, and a healthy retry. Its restart is a source-module worker restart, not a production HTTP-server restart. The separate different-pool test remains honestly labeled.
* Settings interruption uses one payload-aware partial-write barrier for final and temporary destinations. Old/new checks compare complete sanitized settings. The atomic control changes the destination strategy and passes through that same barrier; it does not validate every possible asynchronous/low-level implementation strategy.
* Real native installers/updaters and a 24–48h wall soak were not run. Long-run qualification is still blocked by the stated tooling gaps.

After completing the remaining tooling and provisioning disposable native targets, run:

```sh
node tests/release/soak/run-soak-verification.mjs --duration 86400 --interval 5 --storage-days 180 --strict --output /tmp/gretel-soak-24h
node tests/release/soak/run-soak-verification.mjs --duration 172800 --interval 5 --storage-days 180 --strict --output /tmp/gretel-soak-48h
node tests/release/e2e/native-adapter.mjs --old-artifact OLD_PACKAGE --new-artifact NEW_PACKAGE --target-os linux --package-format deb --runner DISPOSABLE_RUNNER --disposable-contract owned-disposable-target-v1 --strict --output /tmp/gretel-native-qualified
```

Do not interpret the executable commands or protocol controls as evidence that the missing qualification has already occurred.
