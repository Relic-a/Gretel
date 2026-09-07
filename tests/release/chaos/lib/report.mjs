import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export function sha256(filePath, { createReadStream }) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function normalizeCase({
  id, criterion, status, durationMs = 0, evidence = [], reason, logs = [], metrics = {}
}) {
  return {
    id,
    criterion,
    status,
    durationMs,
    evidence,
    reason: reason ?? undefined,
    failureReason: reason ?? undefined,
    logs,
    metrics
  };
}
