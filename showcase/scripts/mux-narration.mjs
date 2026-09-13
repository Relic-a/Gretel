import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
const root = fileURLToPath(new URL("../", import.meta.url));
const master = process.env.SHOWCASE_MASTER || path.join(root, "out/gretel-showcase.mp4");
const output = path.resolve(root, "../docs/showcase/gretel-showcase-narrated.mp4");
if (path.resolve(master) === output) throw new Error("Use a separate visual master as input");
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", master,
  "-i", path.join(root, "public/audio/narration.wav"),
  "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
  "-b:a", "192k", "-movflags", "+faststart", "-shortest", output], { stdio: "inherit" });
console.log(output);
