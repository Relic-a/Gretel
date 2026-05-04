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

export function ensureFeedAlgorithmTables() {
  const centroidsTable = quotedTableName("feed_centroids");
  const embeddingsTable = quotedTableName("feed_video_embeddings");

  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS ${centroidsTable} (
      profile_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      original_json TEXT NOT NULL,
      current_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, cache_key)
    );

    CREATE TABLE IF NOT EXISTS ${embeddingsTable} (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      retained INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, video_id)
    );
  `);
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
  const tableName = quotedTableName("feed_centroids");

  getDatabase()
    .prepare(
      `INSERT INTO ${tableName} (profile_id, cache_key, original_json, current_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, cache_key) DO UPDATE SET
         current_json = excluded.current_json,
         updated_at = excluded.updated_at`
    )
    .run(profileId, cacheKey, JSON.stringify(original), JSON.stringify(current), updatedAt);
}

export function getCentroid(profileId: string, cacheKey: string): StoredCentroid | null {
  ensureFeedAlgorithmTables();
  const tableName = quotedTableName("feed_centroids");
  const row = getDatabase()
    .prepare(
      `SELECT original_json, current_json, updated_at
       FROM ${tableName}
       WHERE profile_id = ? AND cache_key = ?`
    )
    .get(profileId, cacheKey) as
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
  const tableName = quotedTableName("feed_centroids");
  const rows = getDatabase()
    .prepare(
      `SELECT cache_key, original_json, current_json
       FROM ${tableName}
       WHERE profile_id = ?`
    )
    .all(profileId) as Array<{
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
  const tableName = quotedTableName("feed_centroids");

  getDatabase()
    .prepare(
      `UPDATE ${tableName}
       SET current_json = ?, updated_at = ?
       WHERE profile_id = ? AND cache_key = ?`
    )
    .run(JSON.stringify(current), updatedAt, profileId, cacheKey);
}

export function retainEmbedding(profileId: string, videoId: string, embedding: number[]) {
  ensureFeedAlgorithmTables();
  const tableName = quotedTableName("feed_video_embeddings");

  getDatabase()
    .prepare(
      `INSERT INTO ${tableName} (profile_id, video_id, embedding_json, retained, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(profile_id, video_id) DO UPDATE SET
         embedding_json = excluded.embedding_json,
         retained = 1,
         updated_at = excluded.updated_at`
    )
    .run(profileId, videoId, JSON.stringify(embedding), Date.now());
}

export function getRetainedEmbedding(profileId: string, videoId: string) {
  ensureFeedAlgorithmTables();
  const tableName = quotedTableName("feed_video_embeddings");
  const row = getDatabase()
    .prepare(
      `SELECT embedding_json
       FROM ${tableName}
       WHERE profile_id = ? AND video_id = ? AND retained = 1`
    )
    .get(profileId, videoId) as { embedding_json: string } | undefined;

  return row ? JSON.parse(row.embedding_json) as number[] : null;
}

export function deleteRetainedEmbeddings(profileId: string, videoIds: string[]) {
  if (videoIds.length === 0) {
    return;
  }

  ensureFeedAlgorithmTables();
  const tableName = quotedTableName("feed_video_embeddings");
  const statement = getDatabase().prepare(
    `DELETE FROM ${tableName} WHERE profile_id = ? AND video_id = ?`
  );

  for (const videoId of videoIds) {
    statement.run(profileId, videoId);
  }
}

export function deleteFeedAlgorithmData(profileId: string) {
  ensureFeedAlgorithmTables();
  for (const tableName of listFeedAlgorithmTableNames()) {
    getDatabase().prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE profile_id = ?`).run(profileId);
  }
}

export function retainVideoEmbeddings(
  profileId: string,
  videos: FeedVideo[],
  embeddings: Map<string, number[]>
) {
  for (const video of videos) {
    const embedding = embeddings.get(video.id);

    if (embedding) {
      retainEmbedding(profileId, video.id, embedding);
    }
  }
}

export function listFeedAlgorithmTableNames() {
  const rows = getDatabase()
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND (name = 'feed_centroids'
           OR name = 'feed_video_embeddings'
           OR name LIKE 'feed_centroids_%'
           OR name LIKE 'feed_video_embeddings_%')`
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function quotedTableName(baseName: "feed_centroids" | "feed_video_embeddings") {
  return quoteIdentifier(`${baseName}_${createEmbeddingStoreName()}`);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sanitizeIdentifierPart(value: string) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "unknown";
}
