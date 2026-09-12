// Pre-renders each captured shot into a small H.264 clip.
//
// Remotion copies the whole public/ directory into its bundle, so shipping the
// raw jpeg sequences there would mean copying ~370 MB per render. Encoding each
// shot to a compact clip once keeps the bundle small and the render fast, and
// OffthreadVideo can seek within a clip far more cheaply than through
// thousands of stills.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CAPTURE_DIR = path.join(ROOT, "captures");
const CLIP_DIR = path.join(ROOT, "public", "clips");
const FPS = Number(process.env.SHOWCASE_FPS || 30);

function main() {
  fs.mkdirSync(CLIP_DIR, { recursive: true });
  const only = process.env.SHOWCASE_ONLY_SHOTS;
  const onlySet = only ? new Set(only.split(",").map((s) => s.trim())) : null;

  for (const entry of fs.readdirSync(CAPTURE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (onlySet && !onlySet.has(entry.name)) continue;
    const manifestPath = path.join(CAPTURE_DIR, entry.name, "frames.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    const output = path.join(CLIP_DIR, `${entry.name}.mp4`);
    const started = Date.now();
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-framerate",
        String(FPS),
        "-i",
        path.join(CAPTURE_DIR, entry.name, "frames", "%05d.jpg"),
        "-frames:v",
        String(manifest.frameCount),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-movflags",
        "+faststart",
        output
      ],
      { stdio: "inherit" }
    );
    const size = fs.statSync(output).size;
    console.log(
      `${entry.name}: ${(size / 1024 / 1024).toFixed(1)} MB, ` +
        `${manifest.frameCount} frames (${((Date.now() - started) / 1000).toFixed(1)}s)`
    );
  }
}

main();
