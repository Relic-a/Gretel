# Showcase pipeline

How the README's showcase video is produced. Everything here is reproducible;
the committed outputs live in [`docs/showcase/`](../../docs/showcase).

## What gets committed

| File | Purpose |
| --- | --- |
| `docs/showcase/gretel-showcase.gif` | Autoplaying preview embedded in the README |
| `docs/showcase/gretel-showcase.mp4` | Full 73s tour, linked from the poster image |
| `docs/showcase/gretel-showcase-poster.png` | Clickable preview frame |

Raw recorded footage (`showcase/captures/`) and the per-shot clips
(`showcase/public/clips/`) are **not** committed — they are large and fully
regenerable. Only `public/clips/*.mp4` is needed to re-render, and the build
step recreates them from `captures/`.

## Pipeline

```
capture  →  normalize  →  clips  →  render  →  gif/poster
```

1. **`npm run capture`** — drives a real Gretel session in Chromium and records
   it. Use with `--only=<shot>` to re-record one shot, `--keep-data` to reuse an
   existing install.

2. **`npm run normalize`** — converts the timestamped screencast frames into
   constant-30fps sequences (see below), then encodes each shot to a compact
   H.264 clip.

3. **`npm run render`** — renders the Remotion composition to `out/`.

4. **`npm run gif` / `npm run poster`** — derives the README assets from the
   rendered video.

## Why the capture works the way it does

**Screencast frames, not `recordVideo`.** Playwright's built-in recording
produces a webm with no reliable relationship between its frames and wall-clock
time. `capture/lib.mjs` instead uses CDP `Page.startScreencast`, which returns
every frame with a timestamp. `normalize.mjs` then holds each frame for exactly
as long as it was on screen, so the edit cuts on real moments.

**Beat markers.** Shots call `recorder.beat("name")` at meaningful moments
(a step opening, the first card appearing). These are written to
`captures/<shot>/raw.json` and are what `src/scenes.ts` uses to choose in/out
points, rather than eyeballed timings.

**Waiting for thumbnails.** The recorded feed must never show a card whose
thumbnail has not painted. `waitForVisibleImages()` requires every thumbnail
near the viewport to have `naturalWidth > 0`, and `waitForStableFeed()` waits
for the card count and image-loaded signature to stop changing. Waiting only for
the feed request to resolve is not enough — that is exactly the blank-thumbnail
case.

**Isolated session.** Recording runs against a throwaway data directory
(`GRETEL_DATA_DIR`) so the recorded session never contains the developer's own
profiles, and the OpenRouter key is pre-seeded via the settings API so the real
secret is never typed on camera.

## Rendering

`remotion.config`-free invocation; pass flags on the command line.

### Font

The composition asks for **Space Mono** by name. Install it once for the
rendering user:

```bash
npm run install-font          # copies public/fonts/*.woff2 into ~/.fonts
```

This is deliberate: Remotion's `loadFont()` keeps a `delayRender()` open until
the `FontFace` resolves, which intermittently times out during a long concurrent
render as browser pages are recycled. A system font removes that dependency.

### Browser

Remotion downloads its own `chrome-headless-shell`. On some hosts (notably
VPS kernels) that build segfaults on launch. If you see `Page crashed!`
immediately, install Google Chrome and point Remotion at it:

```bash
--browser-executable=/usr/bin/google-chrome
```

### Headless server requirements

```bash
sudo apt-get install -y ffmpeg unzip xz-utils \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 fonts-liberation fontconfig
```

## Editing the video

Scene timing lives in [`src/scenes.ts`](src/scenes.ts) — one entry per scene,
with `in`/`out` referencing the normalized frame numbers printed by
`npm run normalize`. `rate` compresses idle waiting (the recorded wizard is
~52s of real time for ~30s of screen time). Composition, overlays and
transitions live in `src/GretelShowcase.tsx`.

Preview interactively with `npm run studio`.
