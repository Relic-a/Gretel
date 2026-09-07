# Gretel Soak Verification Harness

The soak verification layer validates resource consumption (RSS memory drift and idle CPU utilization), SQLite WAL/database sizing, cache disk bounds, logging rotation, and long-term storage sustainability over extended operating periods.

---

## Architecture

- **`run-soak-verification.mjs`**: Entrypoint orchestrator for accelerated storage and wall-clock soak tests. Owns report creation, exit policy, artifact identity, process tree cleanup, and cancellation handling.
- **`soak-evaluator.mjs`**: Reusable production resource evaluator. Determines Linux clock tick rate via `getconf CLK_TCK` (not deprecated/broken APIs). Computes linear regression slope, median RSS comparisons, and idle CPU statistics.
- **`storage-accelerated.mjs`**: Orchestrates simulated multi-day workload cycles (default: 180 days).
- **`storage-worker.mjs`**: Isolated child worker executing application storage logic with controlled stdin lifecycle, ensuring `lib/logger.ts` EOF handlers cannot prematurely terminate the test orchestrator.
- **`soak-metrics-eval.mjs`**: Production test suite verifying `soak-evaluator.mjs` against synthetic traces (stable, memory leak, high idle CPU, process restarts, negative controls).
- **`soak-runner-test.mjs`**: Runner negative controls (failure propagation, stdin lifecycle, broken rotation control, stale report rejection).

---

## Usage

### 1. Accelerated Storage Verification (180 Days)
```sh
node tests/release/soak/run-soak-verification.mjs \
  --storage-only \
  --storage-days 180 \
  --output /tmp/gretel-soak-storage
```

### 2. Wall-Clock Smoke Test (60 Seconds)
```sh
node tests/release/soak/run-soak-verification.mjs \
  --duration 60 \
  --interval 5 \
  --output /tmp/gretel-soak-smoke
```

### 3. Production Resource Evaluator & Runner Tests
```sh
node tests/release/soak/soak-metrics-eval.mjs
node tests/release/soak/soak-runner-test.mjs
```

### 4. Full Release Qualification (24h / 48h)
```sh
# 24-Hour Soak Run
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 365 \
  --duration 86400 \
  --interval 10 \
  --strict \
  --output /var/log/gretel-soak-24h

# 48-Hour Extended Soak Run
node tests/release/soak/run-soak-verification.mjs \
  --storage-days 365 \
  --duration 172800 \
  --interval 15 \
  --strict \
  --output /var/log/gretel-soak-48h
```

---

## Qualification Evaluator Gates

1. **Warm-up Interval**: First 10 minutes (600s) excluded from idle baseline calculations.
2. **Idle RSS Baseline**: Final idle median RSS must remain within `max(64 MiB, 20%)` of the first post-warm-up idle median.
3. **RSS Trend Slope**: Evaluated over >=2 hours; must not exhibit an upward trajectory.
4. **Idle CPU Thresholds**: Mean CPU usage <= 2% of one core; 95th percentile <= 5% of one core over a 10-minute sustained idle window.

---

## Honest Defect Reporting

The soak suite intentionally reproduces and reports genuine product defects:
- `soak.cache.symlink-escape`: Probes cache cleanup with external symlinks; fails honestly if directory traversal escapes.
- `soak.cache.stale-keys`: Probes cache key accumulation over simulated 180-day workload; fails honestly due to lack of an automatic eviction policy.
