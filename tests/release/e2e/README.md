# Gretel E2E release verification

Run the deterministic production-server and browser gate from the repository root:

```sh
npm run build
cp -a .next/static .next/standalone/.next/static
node tests/release/e2e/run.mjs --mode all --strict --output /tmp/gretel-e2e-output
```

The runner uses a fresh data directory, log file, synthetic config, API token, and Chromium profile. It seeds a realistic local feed pool so the server and UI paths run without OpenRouter or YouTube credentials. `report.json` and redacted evidence are written below the explicit output directory. A seeded pool proves serving and persistence; it does not prove initial provider discovery or subjective recommendation quality.

Use `--mode production` for HTTP, persistence, fault, and concurrency checks, `--mode migration` for source-schema checks, `--mode browser` for Chromium CDP checks, and `--self-test --strict` to verify the runner’s failure, prerequisite, and cancellation behavior. The runner never uses `next dev` and does not alter the application or root package scripts.

Native package evidence is a separate adapter:

```sh
node tests/release/e2e/native-adapter.mjs \
  --old-artifact /path/to/old-installer \
  --new-artifact /path/to/new-installer \
  --target-os linux --runner /path/to/disposable-runner \
  --strict --output /tmp/gretel-native-output
```

Without explicit artifacts and a disposable target runner, native cases are blocked. The adapter never installs packages on the current host.
