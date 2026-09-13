import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const dir = fileURLToPath(new URL("../public/audio/", import.meta.url));
await fs.mkdir(dir, { recursive: true });
const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY");
const input = (await fs.readFile(new URL("../narration.txt", import.meta.url), "utf8")).trim();
const model = process.env.SHOWCASE_TTS_MODEL || "deepgram/flux-tts:free";
const voice = process.env.SHOWCASE_TTS_VOICE || "flux-rufus-en";
const fingerprint = createHash("sha256").update(JSON.stringify({ input, model, voice })).digest("hex");
const output = dir + "rufus-continuous.wav";
try {
  const cached = JSON.parse(await fs.readFile(dir + "take.json", "utf8"));
  if (cached.fingerprint === fingerprint) {
    await fs.access(output);
    console.log("Using cached continuous take");
    process.exit(0);
  }
} catch {}
// One request preserves delivery across the whole tour.
const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model, voice, input, response_format: "pcm" }),
  signal: AbortSignal.timeout(180000)
});
if (!response.ok) throw new Error(`TTS HTTP ${response.status}: ${await response.text()}`);
const pcm = Buffer.from(await response.arrayBuffer());
if (!response.headers.get("content-type")?.startsWith("audio/") || pcm.length < 1000)
  throw new Error("Invalid audio response");
// OpenRouter speech PCM: signed 16-bit, mono, 24 kHz.
const header = Buffer.alloc(44);
header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
await fs.writeFile(output, Buffer.concat([header, pcm]));
await fs.writeFile(dir + "take.json", JSON.stringify({ fingerprint, model, voice, input, duration: pcm.length / 48000 }, null, 2));
console.log(`Continuous ${voice} take: ${(pcm.length / 48000).toFixed(2)} seconds`);
