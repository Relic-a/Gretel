#!/usr/bin/env node
// Builds the README's autoplaying preview GIF from the rendered video.
//
// GitHub strips <video> tags from README markdown, so the inline preview has to
// be an animated GIF. The encoding is tuned for Gretel's dark, flat UI: a
// 64-colour palette with dithering disabled. Ordered dithering on the subtle
// 40px background grid is what balloons the file past GitHub's 10 MB markdown
// limit, and without it the grid survives as clean flat colour.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(HERE, "..");
const OUT_DIR = path.resolve(SHOWCASE_DIR, "..", "docs", "showcase");
const VIDEO = process.env.GIF_SOURCE || path.join(OUT_DIR, "gretel-showcase.mp4");
const GIF = path.join(OUT_DIR, "gretel-showcase.gif");
const PALETTE = path.join(OUT_DIR, ".palette.png");

if (!fs.existsSync(VIDEO)) {
  console.error(`missing ${VIDEO}; run: npm run render`);
  process.exit(1);
}

// Defaults cover the build phases through the finished feed: the stretch that
// reads best at README size.
const START = process.env.GIF_START || "22";
const DURATION = process.env.GIF_DURATION || "12";
const WIDTH = Number(process.env.GIF_WIDTH || 820);
const FPS = Number(process.env.GIF_FPS || 11);
const COLORS = Number(process.env.GIF_COLORS || 64);

const preprocess = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`;

execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-ss", START, "-t", DURATION, "-i", VIDEO,
    "-vf", `${preprocess},palettegen=max_colors=${COLORS}:stats_mode=diff`,
    PALETTE
  ],
  { stdio: "inherit" }
);

execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-ss", START, "-t", DURATION, "-i", VIDEO,
    "-i", PALETTE,
    "-filter_complex",
    `${preprocess}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
    "-loop", "0",
    GIF
  ],
  { stdio: "inherit" }
);

fs.rmSync(PALETTE, { force: true });
const sizeMb = fs.statSync(GIF).size / 1048576;
console.log(`gif: ${GIF} (${sizeMb.toFixed(2)} MB)`);
if (sizeMb > 9.5) {
  console.warn("warning: GIF is close to GitHub's 10 MB markdown limit");
}
