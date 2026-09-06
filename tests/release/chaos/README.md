# Chaos verification harness

Owned CLI: `node tests/release/chaos/verify-chaos.mjs --output <absolute-scratch-dir> [--mode quick|full] [--strict] [--seed 12345]`

This layer intentionally excludes native updater/installer faults. It verifies
real profile SQLite stores, settings/config recovery, bounded network retry,
privacy logging, and API authorization using isolated child environments.

Evidence is module-integration/production-server only, not native-package E2E.
A dedicated runner-negative gate proves the report cannot silently pass.

Recommended representative full command (not executed by default):

`node tests/release/chaos/verify-chaos.mjs --output "$(mktemp -d /tmp/gretel-chaos-XXXXXXXX)" --mode full --strict --seed 424242`
