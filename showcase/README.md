# README showcase

The two exports share the same 2880×1920, 60 fps visual master:

- `docs/showcase/gretel-showcase.mp4`: silent.
- `docs/showcase/gretel-showcase-narrated.mp4`: Rufus narration.
- The poster and GIF link to the full video; GIF cannot carry sound.
- `docs/showcase/gretel-showcase-steps.gif` and `docs/showcase/steps/*.gif`: the
  README's per-step previews, cut from the silent master.

## Step GIFs

`npm run gif-steps` cuts one short looping GIF per entry in `src/scenes.ts` from
the silent master (nothing is re-captured or re-rendered):

- `docs/showcase/steps/NN-<step>.gif`: that step on its own, numbered to match
  the tour order and named from the scene title.
- `docs/showcase/gretel-showcase-steps.gif`: every step back to back in one
  file, starting at the first step rather than the intro title card.

Scene boundaries come from the same measured timings the video uses, so the
clips stay in sync when the narration changes. All clips are normalised to
960×640 at 12 fps and a 64-colour palette with dithering off, matching
`render-gif.mjs`; the final frame holds for a beat so the resulting state is
readable before the loop restarts. The whole set is under 10 MB so the README
stays inside GitHub's markdown limit.

### Trimming the narration pauses

The narration is one continuous take, so the tour deliberately holds after an
action to let the voice catch up. On some steps that hold outlasts the action by
several seconds and the tail sits completely frozen. Those steps are trimmed
from the end in `TAIL_TRIM_SECONDS` so the loop lands on the finished state
instead of staring at it:

| Step | Scene | Last real motion | Trimmed |
| --- | --- | --- | --- |
| `v2-name` | 6.38s | 1.80s | 4.15s |
| `v2-topics` | 5.95s | 2.73s | 2.82s |
| `v2-channels` | 7.33s | 2.10s | 4.83s |

Each trim leaves a 0.4s beat of the pause (`STEP_GIF_BEAT`) so the result is
still readable, and the clip ends on the completed interaction — the typed name,
all three topic chips, the added channel. The remaining steps use their whole
scene and are untouched.

The measured instant is the last frame with real UI motion, ignoring the
blinking text caret and encoder noise, and it is cross-checked against the
committed pointer tracks in `src/pointers/`, whose last event lands at or before
the last real motion. The montage concatenates the same trimmed segments, so it
and the per-step clips always agree.

## What changed

The previous recording used JPEG frames at 1440×900, then applied a dark
gradient across the app. Its chapter labels and progress indicators covered
Gretel's own navigation. The new recording uses lossless 2880×1800 PNG frames,
with a separate 120-pixel caption strip. No gradients, labels, or video
progress bars cover the application.

CDP screencast ignores device pixel ratio on this Chrome build. Capture uses
a 2880×1800 viewport with content zoom 2, producing fresh high-resolution
pixels with the same effective app layout. It does not enlarge old footage.

Mouse events are captured separately and drawn at 60 fps. The real pointer
takes 180 ms to move; the old CSS delay is gone. App captures can hold when
nothing changes without making the pointer stutter.

The tour includes a real watch segment: opening a video and letting the
embedded player run, with the title and channel below it and the next-video
column on the right.

## Narration and timing

`narration.txt` is the script for a **single** request to
`deepgram/flux-tts:free`, voice `flux-rufus-en`. The lossless original is
`public/audio/rufus-continuous.wav`; `take.json` records its model, voice,
script, and cache fingerprint. Keys remain in a local environment file.

The complete performance plays end to end through one 0.9x tempo adjustment and
one loudness pass — every paragraph, including the watch segment. Nothing is cut
or assembled from separate voice generations. Scene boundaries in `src/scenes.ts`
follow measured word timings; short clips hold their final frame rather than
slowing down mouse movement.

Changing the spoken text requires updating those measured boundaries.
`scripts/transcribe-take.py` uses faster-whisper on the render server to
inspect word timings.

## The watch shot

Every other shot is recorded on the render server. YouTube refuses embedded
playback (error 150) to that datacenter IP, so for the watch shot the server's
Chrome egresses through a proxy on a residential connection:

1. Run a local forward proxy and reverse-tunnel it to the server
   (`ssh -R 127.0.0.1:1080:127.0.0.1:1080 debian@…`).
2. Set `SHOWCASE_PROXY=http://127.0.0.1:1080`; `launchBrowser` routes the
   browser through it.
3. `capture/recapture-watch.mjs` picks a card known to embed, pre-warms the
   player (cold start is ~8 s, warm ~2 s), records, and **asserts the player
   advances** before keeping the footage. A blocked or loading-only player is
   rejected, never passed off as playback.

Then `SHOWCASE_FPS=60 SHOWCASE_SKIP_CLIPS=1 npm run normalize` and
`SHOWCASE_ONLY_SHOTS=v2-watch npm run prepare-clips` refresh just that clip.

## Reproduce

Use Node 24+, FFmpeg, Chrome, and a production Gretel server pointed at a
**copy of the demo data**, not your personal profiles. All heavy work can run
on the Debian render server.

1. Set `SHOWCASE_CAPTURE_DIR` to a new directory and
   `SHOWCASE_BROWSER=/usr/bin/google-chrome`; run `npm run capture`.
2. Run `SHOWCASE_FPS=60 SHOWCASE_SKIP_CLIPS=1 npm run normalize`, then
   `npm run prepare-clips`. Keep the same capture-directory environment.
3. Run `npm run narrate` with a local OpenRouter key; then
   `npm run mix-narration`.
4. Run `npm run render -- --browser-executable=/usr/bin/google-chrome`.
5. Copy the visual master to the silent MP4. Run `npm run mux-narration`
   to create the separate narrated MP4 without re-encoding the visuals.
6. Run `npm run poster`, `npm run gif`, and `npm run gif-steps`.

Raw capture directories and derived source clips are not committed. Pointer
tracks, narration, render sources, and final README assets are retained.
