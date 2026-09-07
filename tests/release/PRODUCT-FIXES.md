# Application repairs — 2026-09-07

This supersedes the six unresolved application defects recorded in
[REVIEW-HANDOFF.md](REVIEW-HANDOFF.md). That document remains the historical
record of the verification-tooling work.

## Changes

- Cache cleanup uses `lstat` for roots and children and skips symbolic links.
- Daily maintenance expires disposable pool state/nodes, visited rows, centroids
  and embeddings after 30 days. Pool, centroid and embedding reads refresh their
  retention timestamps at most daily. History, saved videos and likes are retained.
  A maintenance database error is logged without crashing the application.
- Settings writes use a unique private temporary file, flush its contents, and
  rename it over the destination. Ordinary failures clean the temporary file;
  interruption before replacement leaves the previous settings intact.
- Logging redacts configured credentials and credentials identified in sensitive
  fields, serialized objects, bearer headers and URL parameters, including copies
  in messages, nested errors, arrays and URL/base64 encodings. Analytics persistence
  uses the same redaction. This is credential redaction, not a claim that arbitrary
  personal text is anonymized or that historical logs have been scrubbed.
- Embedding responses reject nonnumeric/nonfinite components before normalization.
  Normalization also rejects invalid components and scales finite vectors to avoid
  overflow/underflow in norm calculation.
- Identical in-flight feed builds share one promise. Profile identity, revision
  and request options are part of the key; completion or rejection removes it so
  later requests can retry. Existing profile-deletion checks remain in force.

## Verification

- `npm test`: passed, including 82 Node test cases plus the existing script-based
  smoke checks. Run with stdin attached/kept open: the application's desktop EOF
  shutdown handler can otherwise terminate tests before async cases finish.
- `npm run lint`: passed.
- `npm run build`: passed.
- Additional regressions cover failed settings replacement, credential redaction
  in SQLite diagnostics, malformed diagnostic text, finite vector extremes,
  shared build failure/retry and preservation of actively used personalization.
- Full chaos: **36 pass, 0 fail, 4 blocked**. Report:
  `/tmp/gretel-product-fixes-chaos-final-20260907/report.json`.
- Accelerated 180-day storage: **9 pass, 0 fail, 1 blocked, 1 not_run**. Report:
  `/tmp/gretel-product-fixes-storage-final-20260907/report.json`.

Both strict verification commands exit 1 because required blocked/not-run cases
remain. The missing user diagnostics export, before-COMMIT/ENOSPC/browser fault
checks, native installer/updater qualification, soak refresh/drain integration,
and 24–48-hour wall-duration evidence are not completed by these repairs.
