# Changelog

## 0.4.1-beta.2 — 2026-08-31

### Playback reliability

- Fixed YouTube player error 153 by allowing embedded players to receive the app origin required for client verification.
- Added regression coverage for the YouTube-compatible referrer policy.

## 0.4.1-beta.1 — 2026-08-31

### Security

- Updated and pinned the Next.js production stack to patched versions.
- Added Content Security Policy, referrer, and MIME-sniffing protections.
- Replaced the predictable loopback API token with a 256-bit random token.
- Restricted the local OpenRouter settings file to the current user on macOS and Linux.
- Added bounded profile, topic, channel, API-key, and model inputs.

### Accessibility and reliability

- Added dialog semantics, keyboard focus trapping, Escape handling, and focus restoration to onboarding and settings.
- Removed an inaccurate verified-channel indicator.
- Approved the native SQLite install script explicitly for reproducible Node 24 builds.
- Replaced layout-triggering feed-progress animation with a transform-based animation.

### Beta release

- Added public-beta installation, privacy, security-reporting, and manual-update guidance.
- Verified the Node 24 test suite, Rust tests, standalone runtime, and Linux `.deb` and `.rpm` packages.

## 0.4.0 — 2026-08-30

- Improved channel search responsiveness and displayed results in a bounded popup above subscriptions.
