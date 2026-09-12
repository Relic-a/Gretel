// Converts raw screencast frames into constant-FPS sequences, then encodes each
// shot to a compact clip for the renderer.
//
// Step 1 (this file's normalize pass) turns captures/<shot>/raw.json into
// frames.json plus a dense frames/00000.jpg… sequence, holding every captured
// frame for exactly as long as it was on screen. Step 2 shells out to
// encode-clips.mjs, because Remotion's bundler copies all of public/ and would
// otherwise move hundreds of megabytes of jpegs on every render.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_DIR = path.resolve(HERE, "..", "captures");
const FPS = Number(process.env.SHOWCASE_FPS || 30);

function normalizeShot(dir) {
  const rawPath = path.join(dir, "raw.json");
  if (!fs.existsSync(rawPath)) return null;
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const entries = raw.frames;
  if (!entries || entries.length === 0) return null;

  const t0 = entries[0].timestamp;
  const last = entries[entries.length - 1];
  const tEnd = last.holdUntil ?? last.timestamp;
  const duration = Math.max(tEnd - t0, 1 / FPS);
  const frameCount = Math.max(1, Math.round(duration * FPS));

  for (const frame of entries) {
    if (frame.holdUntil === undefined) frame.holdUntil = frame.timestamp;
  }

  const sequence = [];
  let cursor = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / FPS;
    while (
      cursor + 1 < entries.length &&
      entries[cursor + 1].timestamp - t0 <= t + 1 / (FPS * 2)
    ) {
      cursor += 1;
    }
    sequence.push(entries[cursor].index);
  }

  // Materialise the sequence as links so the clip encoder sees a dense range.
  const seqDir = path.join(dir, "frames");
  fs.rmSync(seqDir, { recursive: true, force: true });
  fs.mkdirSync(seqDir, { recursive: true });
  for (let frame = 0; frame < frameCount; frame += 1) {
    const source = path.join(dir, `${String(sequence[frame]).padStart(5, "0")}.jpg`);
    const target = path.join(seqDir, `${String(frame).padStart(5, "0")}.jpg`);
    try {
      fs.linkSync(source, target);
    } catch {
      fs.copyFileSync(source, target);
    }
  }

  const manifest = {
    name: path.basename(dir),
    fps: FPS,
    frameCount,
    durationSeconds: duration,
    width: raw.width,
    height: raw.height,
    sourceFrames: entries.length,
    beats: raw.beats || [],
    sequence
  };
  fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function main() {
  const manifests = [];
  for (const entry of fs.readdirSync(CAPTURE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = normalizeShot(path.join(CAPTURE_DIR, entry.name));
    if (manifest) manifests.push(manifest);
  }
  manifests.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(
    path.join(CAPTURE_DIR, "manifest.json"),
    JSON.stringify({ fps: FPS, shots: manifests }, null, 2)
  );
  for (const manifest of manifests) {
    console.log(
      `${manifest.name}: ${manifest.frameCount} frames ` +
        `(${manifest.durationSeconds.toFixed(2)}s, from ${manifest.sourceFrames} captured)`
    );
  }

  if (process.env.SHOWCASE_SKIP_CLIPS !== "1") {
    console.log("");
    execFileSync(process.execPath, [path.join(HERE, "encode-clips.mjs")], { stdio: "inherit" });
  }
}

main();
