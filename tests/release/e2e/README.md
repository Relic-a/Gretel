# Gretel E2E Release Verification

The E2E verification layer evaluates production server boot, readiness, API authentication, static asset loading, data persistence, browser UI rendering via Chrome DevTools Protocol (CDP), clean first-run onboarding, and historical database migrations.

---

## Commands

### 1. Full E2E Verification Suite
Runs clean first run, production routes, browser UI tests, and historical migrations:
```sh
node tests/release/e2e/run.mjs --mode all --output /tmp/gretel-e2e-all
```

### 2. Historical Schema Migrations
Validates data integrity, settings preservation, durable record equality, and dynamic embedding table migration:
```sh
node tests/release/e2e/run.mjs --mode migration --output /tmp/gretel-e2e-migration
```

### 3. Production Server Smoke
Validates API routes, authentication, concurrency, and persistence across server restart:
```sh
node tests/release/e2e/run.mjs --mode production --strict --output /tmp/gretel-e2e-production
```

### 4. Runner Self-Tests & Mutation Controls
Validates prerequisite checks, timeout handling, and negative mutation detection:
```sh
node tests/release/e2e/run.mjs --self-test
```

### 5. Native Desktop Adapter Protocol
Validates the target runner contract and report schema against harmless mock runners:
```sh
node tests/release/e2e/native-adapter-test.mjs
```

---

## Test Scenarios & Guarantees

- **`e2e.clean-first-run`**: Starts with a completely empty data directory. The server lazily initializes `gretel.sqlite` on first request. Headless Chromium navigates through the initial onboarding wizard (Profile name -> Topics selection -> Channels skip -> API key entry -> Feed build). Preload fixture `fixtures/mock-youtube-preload.cjs` deterministic feed building. Verifies exact state before and after production server restart.
- **`e2e.migration.v0-5-2`, `e2e.migration.v0-5-1`, `e2e.migration.v0-5-0`**: Restores historical database schemas and applies historical lazy schema additions (`git show $tag`). Compares profile data, masked settings in API responses, unmasked raw settings on disk, saved/liked videos, and exact SQLite `watched_videos` rows (`watched_seconds`, `duration_seconds`, `watched_ratio`).
- **`e2e.migration-legacy-embedding-tables`**: Populates older dynamic embedding tables (`feed_centroids_*`, `feed_video_embeddings_*`) and asserts that the current algorithm store successfully migrates vectors into `feed_centroids` and `feed_video_embeddings` with exact vector equality (`[1, 0, 0, 0, 0, 0, 0, 0]`).
- **`native.adapter`**: Implements the runner protocol for native package testing. When explicit artifacts or disposable runners are absent, cleanly reports `blocked` with the missing requirements rather than failing silently or passing falsely.
