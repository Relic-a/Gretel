# Gretel Chaos Verification Harness

The chaos verification harness subjects Gretel to harsh failure scenarios, including sudden process termination (`SIGKILL`), write interruptions at filesystem barriers, database lock contention, network failures, and privacy boundary leaks.

---

## Commands

### 1. Quick Chaos Verification
Executes deterministic fault injection cases in an isolated scratch directory:
```sh
node tests/release/chaos/verify-chaos.mjs \
  --output /tmp/gretel-chaos-quick \
  --mode quick \
  --seed 424242
```

### 2. Full Chaos Suite (10 Randomized Kill Seeds)
Includes repeated process interruption across randomized lifecycle points:
```sh
node tests/release/chaos/verify-chaos.mjs \
  --output /tmp/gretel-chaos-full \
  --mode full \
  --seed 424242
```

### 3. Strict Mode
Fails (exit 1) if any case fails or is blocked:
```sh
node tests/release/chaos/verify-chaos.mjs \
  --output /tmp/gretel-chaos-strict \
  --mode quick \
  --strict
```

---

## Key Scenarios & Behavioral Verifications

- **Settings Write Crash (`chaos.persistence.settings-write-crash`)**: An event-driven write barrier (`settings-write.barrier.json`) intercepts `node:fs.writeFileSync` on `user-settings.json` and immediately issues `SIGKILL` to the child worker. Verifies whether settings updates are atomic or leave truncated/corrupted files. Non-atomic writes fail honestly; atomic temp-and-rename writes pass.
- **Failed Refresh Feed Preservation (`chaos.feed.failed-refresh-preserves-prior-feed`)**: Creates a valid initial feed, triggers a feed refresh with simulated network/provider failure, and confirms that the prior feed remains completely intact without wipe or corruption. Reboots the server to ensure feed persistence across restart, then restores healthy providers and asserts successful refresh.
- **Vector Validation (`chaos.vector.corrupted-or-nan`)**: Sends valid JSON containing `NaN` floating point numbers to the embedding calculation boundary to verify whether values are validated for numerical finiteness.
- **Database Fault Recovery (`chaos.db.lock-recovery`, `chaos.db.readonly-recovery`)**: Introduces `SQLITE_BUSY` contention or read-only filesystem permissions, releases the condition, and verifies that subsequent writes through a fresh worker succeed normally.
- **Raw Privacy Scanner**: Synthetic canary tokens (`canary-secret-...`) are tracked. Raw stdout and stderr outputs are scanned for credential leakage before any evidence sanitization occurs.
- **Evidence Uniqueness**: Every child run outputs evidence uniquely prefixed by `${safeId}.${operation}.*`, preventing overwrite collisions across iterative crash cycles.
