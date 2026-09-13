import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenes, FPS, framesFor } from "../src/scenes.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const captures = process.env.SHOWCASE_CAPTURE_DIR;
if (!captures) throw new Error("Set SHOWCASE_CAPTURE_DIR");
// A watch-only capture tree holds a single shot. Limit the pass to it so the
// approved clips from the full capture tree stay untouched.
const only = process.env.SHOWCASE_ONLY_SHOTS?.split(",").map((shot) => shot.trim());
const onlySet = only ? new Set(only) : null;
for (const scene of scenes) {
  if (onlySet && !onlySet.has(scene.shot)) continue;
  const dir = path.join(captures, scene.shot);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "frames.json")));
  const target = framesFor(scene) / FPS;
  // Speed up only if needed. Short shots hold their final frame rather than
  // slowing the pointer down. The lead hold lets actions follow spoken cues.
  const rate = Math.max(1, manifest.durationSeconds / (target - scene.lead));
  const points = JSON.parse(fs.readFileSync(path.join(dir, "pointer.json")));
  fs.mkdirSync(path.join(root, "src/pointers"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/pointers", scene.shot + ".json"), JSON.stringify({ rate, points }));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS),
    "-i", path.join(dir, "frames/%05d.png"),
    "-vf", `setpts=PTS/${rate},fps=${FPS},tpad=start_mode=clone:start_duration=${scene.lead}:stop_mode=clone:stop_duration=${target}`,
    "-frames:v", String(framesFor(scene)), "-an", "-c:v", "libx264", "-preset", "medium",
    "-crf", "10", "-pix_fmt", "yuv444p", "-g", "30",
    path.join(root, "public/clips", scene.shot + ".mp4")], { stdio: "inherit" });
  console.log(scene.shot, "speed", rate.toFixed(2), "seconds", target.toFixed(2));
}
