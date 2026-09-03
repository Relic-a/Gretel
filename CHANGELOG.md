# Changelog

## 0.5.1 — 2026-09-02

### Releases and updates

- Consolidated all platform packaging into one tag-driven, fail-closed release workflow that publishes only when every required artifact is present.
- Reduced release time by compiling Linux once for `.deb`, `.rpm`, and AppImage packages, running tests once in parallel, and caching Rust build outputs per platform.
- Added package-specific Linux updater targets so `.deb`, `.rpm`, and AppImage installations receive the correct signed artifact.
- Added an explicit Arch-package update path that opens the complete release instead of attempting to install an incompatible AppImage.

## 0.5.0 — 2026-09-02

### Search and feed discovery

- Added semantic centroid-filtered search (`/api/search`) with pure vector similarity scoring, optimized embeddings, and response caching.
- Enhanced top bar search UI with instant feedback, live loading states, and dynamic header updates.
- Added feed refresh support to fetch and re-rank fresh candidates across active profile topics.

### Feed intelligence & multi-topic centroids

- Implemented per-topic MaxSim scoring for multi-topic profiles, allowing diverse interests within a single profile.
- Added winner-takes-all centroid drift so user interactions refine the closest topic without polluting other topics.
- Calibrated the default feed similarity threshold to `0.58` for improved discovery and topic alignment.
- Added transparent on-the-fly auto-migration and backward compatibility for legacy single-centroid profiles.

### Reliability and bug fixes

- Patched `youtubei.js` to handle missing avatar icons in modern comment payloads without throwing errors.
- Added automated tests for multi-topic drift, winner-takes-all learning, legacy migration, comments handling, and updater manifests.

## 0.4.2 — 2026-09-02

### In-app updates

- Added signed in-app update checks, downloads, installation, and relaunch support.
- Added update status and controls to Settings, including progress and error states.
- Added signed updater artifacts and `latest.json` publication to the multi-platform release workflow.

## 0.4.1 — 2026-08-31

### Image reliability

- Added persistent, atomic thumbnail caching with high-resolution discovery and graceful fallback to real lower-resolution images.
- Improved channel-avatar caching and reuse across searches, recommendations, and feed results.
- Added regression coverage for thumbnail selection, cache behavior, route compatibility, and avatar resolution.

### Compatibility

- Allowed supported Node.js releases newer than version 24 while retaining Node.js 24 as the minimum.

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
