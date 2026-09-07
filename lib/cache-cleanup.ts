import { readdirSync, rmdirSync, lstatSync, unlinkSync } from "node:fs";
import path from "node:path";

import { getDataDir } from "./data-dir";
import { getDatabase } from "./profile-store";
import { errorFields, logWarn } from "./logger";

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
  try {
    removeOldFeedData(cutoff);
  } catch (error) {
    // Maintenance must not crash an otherwise usable app on a busy/read-only DB.
    logWarn("cache.cleanup_failed", errorFields(error));
  }
}

// These tables are rebuildable caches. User history, saved videos and likes
// deliberately have no age-based deletion policy.
function removeOldFeedData(cutoff: number) {
  const database = getDatabase();
  database.transaction(() => {
    database.prepare(`DELETE FROM feed_pool_nodes WHERE (profile_id, pool_key) IN
      (SELECT profile_id, pool_key FROM feed_pool_state WHERE updated_at < ?)`)
      .run(cutoff);
    database.prepare("DELETE FROM feed_pool_state WHERE updated_at < ?").run(cutoff);
    database.prepare("DELETE FROM feed_visited_videos WHERE last_seen_at < ?").run(cutoff);
    for (const table of ["feed_centroids", "feed_video_embeddings"]) {
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
        database.prepare(`DELETE FROM ${table} WHERE updated_at < ?`).run(cutoff);
      }
    }
  })();
}

function removeOldEntries(root: string, cutoff: number) {
  let entries: string[];

  try {
    if (!lstatSync(root).isDirectory()) return;
    entries = readdirSync(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry);

    try {
      const stats = lstatSync(entryPath);

      if (stats.isDirectory()) {
        removeOldEntries(entryPath, cutoff);
        try {
          if (readdirSync(entryPath).length === 0) {
            rmdirSync(entryPath);
          }
        } catch {}
      } else if (stats.isFile() && stats.mtimeMs < cutoff) {
        unlinkSync(entryPath);
      }
    } catch {
      // Cache cleanup is best effort.
    }
  }
}
