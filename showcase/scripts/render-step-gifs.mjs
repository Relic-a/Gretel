#!/usr/bin/env node
// Cuts one short looping GIF per tour step out of the silent showcase master.
//
// README.md keeps a single 9-second GIF because GitHub refuses to inline the
// 19 MB MP4. That preview jumps between steps, so it can't show any one of them
// well. These per-step clips are the companion: each step in `src/scenes.ts`
// gets its own small GIF so a reader can see a single interaction without
// downloading the whole video.
//
// Every step is normalised to the same width, frame rate, and palette so the
// clips sit together without jittering in size or colour. Encoding mirrors
// `render-gif.mjs`: 64 colours with dithering disabled, because ordered
// dithering on the subtle background grid is what balloons the file size.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FPS as SOURCE_FPS, HEIGHT, WIDTH, scenes } from "../src/scenes.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(HERE, "..");
const OUT_DIR = path.resolve(SHOWCASE_DIR, "..", "docs", "showcase");
const VIDEO = process.env.STEP_GIF_SOURCE || path.join(OUT_DIR, "gretel-showcase.mp4");
const DEST = process.env.STEP_GIF_DIR || path.join(OUT_DIR, "steps");

// The GIF frame rate is well below the 60 fps master: the app moves in short
// bursts and 12 fps keeps every step small enough to commit.
const GIF_FPS = Number(process.env.STEP_GIF_FPS || 12);
const GIF_WIDTH = Number(process.env.STEP_GIF_WIDTH || 960);
const COLORS = Number(process.env.STEP_GIF_COLORS || 64);
// Hold the final frame for a beat so the last state is readable before the
// loop restarts.
const HOLD_SECONDS = Number(process.env.STEP_GIF_HOLD || 0.9);
// Leave this much of the paused tail in a trimmed step, so the result still
// reads before the loop restarts.
const BEAT_SECONDS = Number(process.env.STEP_GIF_BEAT || 0.4);

// The narration is one continuous take, so the tour deliberately holds after an
// action to let the voice catch up. On the steps below that hold runs on far
// longer than the action and the tail sits completely frozen; trimming it from
// the end makes the loop land on the finished state instead of staring at it.
//
// Measured against the master as the last frame with real UI motion, ignoring
// the text caret and encoder noise, then cross-checked with the committed
// pointer tracks:
//
//   v2-name     last motion  1.80s of a 6.38s scene -> 4.15s frozen tail
//   v2-topics   last motion  2.73s of a 5.95s scene -> 2.82s frozen tail
//   v2-channels last motion  2.10s of a 7.33s scene -> 4.83s frozen tail
//
// Steps that use their whole scene are absent: nothing is cut from them.
const TAIL_TRIM_SECONDS = {
  "v2-name": 4.15,
  "v2-topics": 2.82,
  "v2-channels": 4.83
};

if (!fs.existsSync(VIDEO)) {
  console.error(`missing ${VIDEO}; run: npm run render`);
  process.exit(1);
}

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const clips = scenes.map((scene) => {
  const full = (scene.end - scene.start) / SOURCE_FPS;
  const requested = TAIL_TRIM_SECONDS[scene.shot] || 0;
  const trim = Math.min(requested, Math.max(0, full - BEAT_SECONDS));
  if (requested > full - BEAT_SECONDS) {
    console.warn(`warning: ${scene.shot} trim of ${requested}s exceeds its scene; clamped to ${trim.toFixed(2)}s`);
  }
  return { scene, start: scene.start / SOURCE_FPS, duration: full - trim, trim };
});

fs.mkdirSync(DEST, { recursive: true });

// Drop any stale clips so a renamed or removed step does not linger.
for (const entry of fs.readdirSync(DEST)) {
  if (entry.endsWith(".gif")) fs.rmSync(path.join(DEST, entry));
}

const preprocess = (hold = HOLD_SECONDS) =>
  `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=${hold}`;
const written = [];

for (const [index, clip] of clips.entries()) {
  const { scene, start, duration, trim } = clip;
  const name = `${String(index + 1).padStart(2, "0")}-${slug(scene.title)}.gif`;
  const out = path.join(DEST, name);
  const palette = path.join(DEST, `.${slug(scene.title)}.palette.png`);

  execFileSync(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-ss", String(start), "-t", String(duration), "-i", VIDEO,
      "-vf", `${preprocess()},palettegen=max_colors=${COLORS}:stats_mode=diff`,
      palette
    ],
    { stdio: "inherit" }
  );

  execFileSync(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-ss", String(start), "-t", String(duration), "-i", VIDEO,
      "-i", palette,
      "-filter_complex",
      `${preprocess()}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
      "-loop", "0",
      out
    ],
    { stdio: "inherit" }
  );

  fs.rmSync(palette, { force: true });
  const sizeMb = fs.statSync(out).size / 1048576;
  written.push({ name, title: scene.title, duration, trim, sizeMb });
  const note = trim > 0 ? `  (trimmed ${trim.toFixed(2)}s of pause)` : "";
  console.log(`${name}  ${duration.toFixed(2)}s  ${sizeMb.toFixed(2)} MB${note}`);
}

const total = written.reduce((sum, clip) => sum + clip.sizeMb, 0);
const dims = `${GIF_WIDTH}×${Math.round((GIF_WIDTH * HEIGHT) / WIDTH)}`;
console.log(`\n${written.length} step GIFs in ${DEST} (${dims}, ${GIF_FPS} fps, ${total.toFixed(2)} MB total)`);

// One GIF holding every step back to back, for readers who want the whole
// sequence in a single inline asset. It concatenates exactly the segments the
// per-step clips use — same trims, same order — so the two never disagree, and
// it skips the intro title card because that is not a step. Both passes rebuild
// the concat from the master, so no intermediate encode is involved.
const montage = path.join(OUT_DIR, "gretel-showcase-steps.gif");
const montagePalette = path.join(OUT_DIR, ".gretel-showcase-steps.palette.png");
const montageDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);

const concatArgs = () => {
  const inputs = clips.flatMap((clip) => [
    "-ss", String(clip.start), "-t", String(clip.duration), "-i", VIDEO
  ]);
  const segments = clips
    .map((_, i) => `[${i}:v]fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos,format=yuv420p,setpts=PTS-STARTPTS[s${i}]`)
    .join(";");
  const labels = clips.map((_, i) => `[s${i}]`).join("");
  return { inputs, graph: `${segments};${labels}concat=n=${clips.length}:v=1:a=0[out]` };
};

const pass1 = concatArgs();
execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    ...pass1.inputs,
    "-filter_complex", `${pass1.graph};[out]palettegen=max_colors=${COLORS}:stats_mode=diff[p]`,
    "-map", "[p]",
    montagePalette
  ],
  { stdio: "inherit" }
);

const pass2 = concatArgs();
execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    ...pass2.inputs,
    "-i", montagePalette,
    "-filter_complex",
    `${pass2.graph};[out][${clips.length}:v]paletteuse=dither=none:diff_mode=rectangle[g]`,
    "-map", "[g]",
    "-loop", "0",
    montage
  ],
  { stdio: "inherit" }
);

fs.rmSync(montagePalette, { force: true });
const montageMb = fs.statSync(montage).size / 1048576;
console.log(`gretel-showcase-steps.gif  ${montageDuration.toFixed(2)}s  ${montageMb.toFixed(2)} MB`);
if (montageMb > 9.5) {
  console.warn("warning: step montage is close to GitHub's 10 MB markdown limit");
}
