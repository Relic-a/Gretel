# Gretel release verification catalog

Release verification is split into isolated evidence layers. Each layer emits the same versioned case report and treats missing prerequisites as `blocked` or `not_run`, never as a pass.

| Layer | Command location | Covers | Required mode |
| --- | --- | --- | --- |
| E2E | `tests/release/e2e/run.mjs` | Production standalone server, browser UI/HTTP paths, local schema migration | Serial smoke on every candidate; seeded provider boundary is labeled |
| Native E2E | `tests/release/e2e/native-adapter.mjs` | Install, reinstall, old-to-new package upgrade, GUI lifecycle, signed update faults | Disposable target OS runner with explicit old/new artifacts |
| Chaos | `../Gretel-verify-chaos/tests/release/chaos/verify-chaos.mjs` | Storage, process, network, fault injection | Disposable fixtures or VM/container; no host destructive faults |
| Soak | `../Gretel-verify-soak/tests/release/soak/run-soak-verification.mjs` | 24–48 hour stability and feed/persistence health | Nightly only, with bounded resource and restart evidence |

The E2E layer intentionally does not claim native installation, provider discovery, ranking relevance, playback quality, chaos safety, or long-duration stability. All of those require their own reports. A missing artifact, old binary, diagnostic endpoint, target runner, or platform prerequisite blocks the corresponding release criterion. Reports are retained under the explicit output directory and must be reviewed before any publication action.

Recommended sequence:

```sh
node tests/release/e2e/run.mjs --self-test --strict --output /tmp/gretel-e2e-self-test
npm run build
cp -a .next/static .next/standalone/.next/static
node tests/release/e2e/run.mjs --mode all --strict --output /tmp/gretel-e2e-smoke
node tests/release/e2e/native-adapter.mjs --strict --output /tmp/gretel-native-smoke
```

Run the sibling layers from their own isolated worktrees when their required
fixtures and runtime are available:

```sh
node tests/release/chaos/verify-chaos.mjs --output "$SCRATCH/artifact" --mode quick --strict
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 180 --duration 60 --interval 5 \
  --seed release-smoke --output "$SCRATCH/artifact"
```

The chaos layer's full command and seed contract are documented in
`../Gretel-verify-chaos/docs/release-verification-chaos.md`. The soak layer's
24–48 hour commands and bounded restart/resource contract are documented in
`../Gretel-verify-soak/docs/release-verification-soak.md`; its 60-second
storage/soak smoke is the integration command shown above. Those commands are
documentation links, not executables from this worktree.

The native smoke command is expected to exit nonzero until explicit target artifacts and a disposable target runner are supplied. A serial smoke run can be promoted to a nightly job by preserving its exact `report.json`, sanitized logs, artifact hashes, and environment metadata; a nightly run cannot substitute for missing native or migration evidence.
