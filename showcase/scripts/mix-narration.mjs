import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DURATION_SECONDS, VOICE_SPEED, VOICE_LEAD_SECONDS } from "../src/scenes.ts";
const dir = fileURLToPath(new URL("../public/audio/", import.meta.url));
// The complete continuous take plays end to end: one tempo change, one loudness
// pass, one lead-in. No clipped words, inserted gaps, or scene-by-scene splices.
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", dir + "rufus-continuous.wav",
  "-filter_complex", `[0:a]atempo=${VOICE_SPEED},loudnorm=I=-16:TP=-1.5:LRA=9,adelay=${VOICE_LEAD_SECONDS * 1000}:all=1,apad,atrim=duration=${DURATION_SECONDS}[out]`,
  "-map", "[out]",
  "-ar", "48000", "-c:a", "pcm_s16le", dir + "narration.wav"], { stdio: "inherit" });
