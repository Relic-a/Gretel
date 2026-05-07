import { getDatabase } from "../profile-store";
import { getGretelConfig } from "./config";
import type { FeedVideo } from "./types";

export type StoredCentroid = {
  original: number[];
  current: number[];
  updatedAt: number;
};

type StoredCentroidRow = {
  cacheKey: string;
  original: number[];
  current: number[];
};

let feedAlgorithmTablesReady = false;

export function ensureFeedAlgorithmTables() {
  if (feedAlgorithmTablesReady) {
    return;
  }

  const database = getDatabase();
  const legacyCentroids = detachLegacyBaseTable("feed_centroids");
  const legacyEmbeddings = detachLegacyBaseTable("feed_video_embeddings");

  database.exec(`
    CREATE TABLE IF NOT EXISTS feed_centroids (
      profile_id TEXT NOT NULL,
      store_key TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      original_json TEXT NOT NULL,
      current_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, store_key, cache_key)
    );

    CREATE TABLE IF NOT EXISTS feed_video_embeddings (
      profile_id TEXT NOT NULL,
      store_key TEXT NOT NULL,
      video_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      retained INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, store_key, video_id)
    );
  `);

  migrateDetachedBaseTable(legacyCentroids);
  migrateDetachedBaseTable(legacyEmbeddings);
  migrateLegacyAlgorithmTables(new Set(
    [legacyCentroids?.tableName, legacyEmbeddings?.tableName].filter(Boolean) as string[]
  ));
  feedAlgorithmTablesReady = true;
}

export function createEmbeddingStoreName() {
  const config = getGretelConfig();
  return [
    config.embeddings.provider,
    config.embeddings.model,
    String(config.embeddings.dimensions)
  ].map(sanitizeIdentifierPart).join("_");
}

export function saveCentroid(profileId: string, cacheKey: string, original: number[], current: number[]) {
  ensureFeedAlgorithmTables();
  const updatedAt = Date.now();
  const storeKey = createEmbeddingStoreName();

  getDatabase()
    .prepare(
      `INSERT INTO feed_centroids (profile_id, store_key, cache_key, original_json, current_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, store_key, cache_key) DO UPDATE SET
         current_json = excluded.current_json,
         updated_at = excluded.updated_at`
    )
    .run(profileId, storeKey, cacheKey, JSON.stringify(original), JSON.stringify(current), updatedAt);
}

export function getCentroid(profileId: string, cacheKey: string): StoredCentroid | null {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();
  const row = getDatabase()
    .prepare(
      `SELECT original_json, current_json, updated_at
       FROM feed_centroids
       WHERE profile_id = ? AND store_key = ? AND cache_key = ?`
    )
    .get(profileId, storeKey, cacheKey) as
    | {
        original_json: string;
        current_json: string;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    original: JSON.parse(row.original_json) as number[],
    current: JSON.parse(row.current_json) as number[],
    updatedAt: row.updated_at
  };
}

export function listCentroids(profileId: string): StoredCentroidRow[] {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();
  const rows = getDatabase()
    .prepare(
      `SELECT cache_key, original_json, current_json
       FROM feed_centroids
       WHERE profile_id = ? AND store_key = ?`
    )
    .all(profileId, storeKey) as Array<{
      cache_key: string;
      original_json: string;
      current_json: string;
    }>;

  return rows.map((row) => ({
    cacheKey: row.cache_key,
    original: JSON.parse(row.original_json) as number[],
    current: JSON.parse(row.current_json) as number[]
  }));
}

export function updateCentroid(profileId: string, cacheKey: string, current: number[], updatedAt: number) {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();

  getDatabase()
    .prepare(
      `UPDATE feed_centroids
       SET current_json = ?, updated_at = ?
       WHERE profile_id = ? AND store_key = ? AND cache_key = ?`
    )
    .run(JSON.stringify(current), updatedAt, profileId, storeKey, cacheKey);
}

export function retainEmbedding(profileId: string, videoId: string, embedding: number[]) {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();

  getDatabase()
    .prepare(
      `INSERT INTO feed_video_embeddings (profile_id, store_key, video_id, embedding_json, retained, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(profile_id, store_key, video_id) DO UPDATE SET
         embedding_json = excluded.embedding_json,
         retained = 1,
         updated_at = excluded.updated_at`
    )
    .run(profileId, storeKey, videoId, JSON.stringify(embedding), Date.now());
}

export function getRetainedEmbedding(profileId: string, videoId: string) {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();
  const row = getDatabase()
    .prepare(
      `SELECT embedding_json
       FROM feed_video_embeddings
       WHERE profile_id = ? AND store_key = ? AND video_id = ? AND retained = 1`
    )
    .get(profileId, storeKey, videoId) as { embedding_json: string } | undefined;

  return row ? JSON.parse(row.embedding_json) as number[] : null;
}

export function deleteRetainedEmbeddings(profileId: string, videoIds: string[]) {
  if (videoIds.length === 0) {
    return;
  }

  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();
  const statement = getDatabase().prepare(
    "DELETE FROM feed_video_embeddings WHERE profile_id = ? AND store_key = ? AND video_id = ?"
  );

  runInTransaction(() => {
    for (const videoId of videoIds) {
      statement.run(profileId, storeKey, videoId);
    }
  });
}

export function deleteFeedAlgorithmData(profileId: string) {
  ensureFeedAlgorithmTables();
  const database = getDatabase();

  runInTransaction(() => {
    database.prepare("DELETE FROM feed_centroids WHERE profile_id = ?").run(profileId);
    database.prepare("DELETE FROM feed_video_embeddings WHERE profile_id = ?").run(profileId);

    for (const tableName of listLegacyFeedAlgorithmTableNames()) {
      database.prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE profile_id = ?`).run(profileId);
    }
  });
}

export function retainVideoEmbeddings(
  profileId: string,
  videos: FeedVideo[],
  embeddings: Map<string, number[]>
) {
  ensureFeedAlgorithmTables();
  const storeKey = createEmbeddingStoreName();
  const statement = getDatabase().prepare(
    `INSERT INTO feed_video_embeddings (profile_id, store_key, video_id, embedding_json, retained, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(profile_id, store_key, video_id) DO UPDATE SET
       embedding_json = excluded.embedding_json,
       retained = 1,
       updated_at = excluded.updated_at`
  );
  const updatedAt = Date.now();

  runInTransaction(() => {
    for (const video of videos) {
      const embedding = embeddings.get(video.id);

      if (embedding) {
        statement.run(profileId, storeKey, video.id, JSON.stringify(embedding), updatedAt);
      }
    }
  });
}

export function listFeedAlgorithmTableNames() {
  return ["feed_centroids", "feed_video_embeddings"];
}

function migrateDetachedBaseTable(legacyTable: LegacyBaseTable | null) {
  if (!legacyTable) {
    return;
  }

  const database = getDatabase();

  if (legacyTable.baseName === "feed_centroids") {
    database
      .prepare(
        `INSERT OR IGNORE INTO feed_centroids (
           profile_id, store_key, cache_key, original_json, current_json, updated_at
         )
         SELECT profile_id, ?, cache_key, original_json, current_json, updated_at
         FROM ${quoteIdentifier(legacyTable.tableName)}`
      )
      .run(legacyTable.storeKey);
    database.exec(`DROP TABLE ${quoteIdentifier(legacyTable.tableName)}`);
    return;
  }

  database
    .prepare(
      `INSERT OR IGNORE INTO feed_video_embeddings (
         profile_id, store_key, video_id, embedding_json, retained, updated_at
       )
       SELECT profile_id, ?, video_id, embedding_json, retained, updated_at
       FROM ${quoteIdentifier(legacyTable.tableName)}`
    )
    .run(legacyTable.storeKey);
  database.exec(`DROP TABLE ${quoteIdentifier(legacyTable.tableName)}`);
}

function migrateLegacyAlgorithmTables(skipTables: Set<string>) {
  const database = getDatabase();

  for (const tableName of listLegacyFeedAlgorithmTableNames()) {
    if (skipTables.has(tableName)) {
      continue;
    }

    if (tableName.startsWith("feed_centroids_")) {
      const storeKey = tableName.slice("feed_centroids_".length);

      database
        .prepare(
          `INSERT OR IGNORE INTO feed_centroids (
             profile_id, store_key, cache_key, original_json, current_json, updated_at
           )
           SELECT profile_id, ?, cache_key, original_json, current_json, updated_at
           FROM ${quoteIdentifier(tableName)}`
        )
        .run(storeKey);
      database.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
      continue;
    }

    if (tableName.startsWith("feed_video_embeddings_")) {
      const storeKey = tableName.slice("feed_video_embeddings_".length);

      database
        .prepare(
          `INSERT OR IGNORE INTO feed_video_embeddings (
             profile_id, store_key, video_id, embedding_json, retained, updated_at
           )
           SELECT profile_id, ?, video_id, embedding_json, retained, updated_at
           FROM ${quoteIdentifier(tableName)}`
        )
        .run(storeKey);
      database.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
    }
  }
}

function listLegacyFeedAlgorithmTableNames() {
  const rows = getDatabase()
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND (name LIKE 'feed_centroids_%'
           OR name LIKE 'feed_video_embeddings_%')`
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

type LegacyBaseTable = {
  baseName: "feed_centroids" | "feed_video_embeddings";
  tableName: string;
  storeKey: string;
};

function detachLegacyBaseTable(baseName: LegacyBaseTable["baseName"]): LegacyBaseTable | null {
  if (!tableExists(baseName) || tableHasColumn(baseName, "store_key")) {
    return null;
  }

  const tableName = `${baseName}_legacy_${Date.now()}`;
  getDatabase().exec(`ALTER TABLE ${quoteIdentifier(baseName)} RENAME TO ${quoteIdentifier(tableName)}`);

  return {
    baseName,
    tableName,
    storeKey: createEmbeddingStoreName()
  };
}

function tableExists(tableName: string) {
  const row = getDatabase()
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

function tableHasColumn(tableName: string, columnName: string) {
  const columns = getDatabase()
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;

  return columns.some((column) => column.name === columnName);
}

function runInTransaction(work: () => void) {
  const database = getDatabase();

  database.exec("BEGIN");

  try {
    work();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sanitizeIdentifierPart(value: string) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "unknown";
}
