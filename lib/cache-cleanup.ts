import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { getDataDir } from "./data-dir";

const dataDir = getDataDir();
const cleanupIntervalMs = 1000 * 60 * 60 * 24;
const maxCacheAgeMs = cleanupIntervalMs * 30;

let cleanupStarted = false;

export function startCacheCleanup() {
  if (cleanupStarted) {
    return;
  }

  cleanupStarted = true;
  cleanupOldCaches();
  setInterval(cleanupOldCaches, cleanupIntervalMs).unref?.();
}

export function cleanupOldCaches(now = Date.now()) {
  const cutoff = now - maxCacheAgeMs;

  removeOldEntries(path.join(dataDir, "thumbnails"), cutoff);
  removeOldEntries(path.join(dataDir, "youtube-sessions"), cutoff);
}

function removeOldEntries(root: string, cutoff: number) {
  let entries: string[];

  try {
    entries = readdirSync(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry);

    try {
      const stats = statSync(entryPath);

      if (stats.isDirectory()) {
        removeOldEntries(entryPath, cutoff);
      }

      const currentStats = statSync(entryPath);

      if (currentStats.mtimeMs < cutoff) {
        rmSync(entryPath, { recursive: true, force: true });
      }
    } catch {
      // Cache cleanup is best effort.
    }
  }
}
