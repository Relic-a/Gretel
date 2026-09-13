# README showcase

The two exports share the same 2880×1920, 60 fps visual master:

- `docs/showcase/gretel-showcase.mp4`: silent.
- `docs/showcase/gretel-showcase-narrated.mp4`: Rufus narration.
- The poster and GIF link to the full video; GIF cannot carry sound.

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
6. Run `npm run poster` and `npm run gif`.

Raw capture directories and derived source clips are not committed. Pointer
tracks, narration, render sources, and final README assets are retained.
