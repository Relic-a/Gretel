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

if (!fs.existsSync(VIDEO)) {
  console.error(`missing ${VIDEO}; run: npm run render`);
  process.exit(1);
}

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

fs.mkdirSync(DEST, { recursive: true });

// Drop any stale clips so a renamed or removed step does not linger.
for (const entry of fs.readdirSync(DEST)) {
  if (entry.endsWith(".gif")) fs.rmSync(path.join(DEST, entry));
}

const preprocess = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=${HOLD_SECONDS}`;
const written = [];

for (const [index, scene] of scenes.entries()) {
  const start = scene.start / SOURCE_FPS;
  const duration = (scene.end - scene.start) / SOURCE_FPS;
  const name = `${String(index + 1).padStart(2, "0")}-${slug(scene.title)}.gif`;
  const out = path.join(DEST, name);
  const palette = path.join(DEST, `.${slug(scene.title)}.palette.png`);

  execFileSync(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-ss", String(start), "-t", String(duration), "-i", VIDEO,
      "-vf", `${preprocess},palettegen=max_colors=${COLORS}:stats_mode=diff`,
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
      `${preprocess}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
      "-loop", "0",
      out
    ],
    { stdio: "inherit" }
  );

  fs.rmSync(palette, { force: true });
  const sizeMb = fs.statSync(out).size / 1048576;
  written.push({ name, title: scene.title, duration, sizeMb });
  console.log(`${name}  ${duration.toFixed(2)}s  ${sizeMb.toFixed(2)} MB`);
}

const total = written.reduce((sum, clip) => sum + clip.sizeMb, 0);
const dims = `${GIF_WIDTH}×${Math.round((GIF_WIDTH * HEIGHT) / WIDTH)}`;
console.log(`\n${written.length} step GIFs in ${DEST} (${dims}, ${GIF_FPS} fps, ${total.toFixed(2)} MB total)`);

// One GIF holding every step back to back, for readers who want the whole
// sequence in a single inline asset. It starts at the first step (the intro
// title card is not a step) and runs to the last step's end.
const montageFrom = scenes[0].start / SOURCE_FPS;
const montageTo = scenes.at(-1).end / SOURCE_FPS;
const montageDuration = montageTo - montageFrom;
const montage = path.join(OUT_DIR, "gretel-showcase-steps.gif");
const montagePalette = path.join(OUT_DIR, ".gretel-showcase-steps.palette.png");

execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-ss", String(montageFrom), "-t", String(montageDuration), "-i", VIDEO,
    "-vf", `${preprocess},palettegen=max_colors=${COLORS}:stats_mode=diff`,
    montagePalette
  ],
  { stdio: "inherit" }
);

execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-ss", String(montageFrom), "-t", String(montageDuration), "-i", VIDEO,
    "-i", montagePalette,
    "-filter_complex",
    `${preprocess}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
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

