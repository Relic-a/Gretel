#!/usr/bin/env node
// Renders the README poster — a single still from the finished-feed scene.
// Used as the clickable preview that links to the full video.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(HERE, "..");
const OUT_DIR = path.resolve(SHOWCASE_DIR, "..", "docs", "showcase");
const VIDEO = process.env.POSTER_SOURCE || path.join(OUT_DIR, "gretel-showcase.mp4");
const POSTER = path.join(OUT_DIR, "gretel-showcase-poster.png");

fs.mkdirSync(OUT_DIR, { recursive: true });

if (fs.existsSync(VIDEO)) {
  // Pull the poster straight from the rendered video so it always matches.
  const at = process.env.POSTER_AT || "24";
  execFileSync(
    "ffmpeg",
    ["-y", "-v", "error", "-ss", at, "-i", VIDEO, "-frames:v", "1", POSTER],
    { stdio: "inherit" }
  );
  console.log(`poster: ${POSTER} (from video at ${at}s)`);
} else {
  // Fall back to rendering the frame from the composition.
  execFileSync(
    "npx",
    [
      "remotion", "still", "src/index.ts", "GretelShowcase", POSTER,
      `--frame=${process.env.POSTER_FRAME || "1180"}`,
      "--image-format=png"
    ],
    { cwd: SHOWCASE_DIR, stdio: "inherit" }
  );
  console.log(`poster: ${POSTER} (rendered frame)`);
}
