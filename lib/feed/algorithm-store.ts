import { getDatabase } from "../profile-store";
import type { FeedVideo } from "./types";

export type StoredCentroid = {
  original: number[];
  current: number[];
  updatedAt: number;
};

export function ensureFeedAlgorithmTables() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS feed_centroids (
      profile_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      original_json TEXT NOT NULL,
      current_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, cache_key)
    );

    CREATE TABLE IF NOT EXISTS feed_video_embeddings (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      retained INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, video_id)
    );
  `);
}

export function saveCentroid(profileId: string, cacheKey: string, original: number[], current: number[]) {
  ensureFeedAlgorithmTables();
  const updatedAt = Date.now();

  getDatabase()
    .prepare(
      `INSERT INTO feed_centroids (profile_id, cache_key, original_json, current_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, cache_key) DO UPDATE SET
         current_json = excluded.current_json,
         updated_at = excluded.updated_at`
    )
    .run(profileId, cacheKey, JSON.stringify(original), JSON.stringify(current), updatedAt);
}

export function getCentroid(profileId: string, cacheKey: string): StoredCentroid | null {
  ensureFeedAlgorithmTables();
  const row = getDatabase()
    .prepare(
      `SELECT original_json, current_json, updated_at
       FROM feed_centroids
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

export function retainEmbedding(profileId: string, videoId: string, embedding: number[]) {
  ensureFeedAlgorithmTables();
  getDatabase()
    .prepare(
      `INSERT INTO feed_video_embeddings (profile_id, video_id, embedding_json, retained, updated_at)
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
  const row = getDatabase()
    .prepare(
      `SELECT embedding_json
       FROM feed_video_embeddings
       WHERE profile_id = ? AND video_id = ? AND retained = 1`
    )
    .get(profileId, videoId) as { embedding_json: string } | undefined;

  return row ? JSON.parse(row.embedding_json) as number[] : null;
}

export function deleteFeedAlgorithmData(profileId: string) {
  ensureFeedAlgorithmTables();
  getDatabase().prepare("DELETE FROM feed_centroids WHERE profile_id = ?").run(profileId);
  getDatabase().prepare("DELETE FROM feed_video_embeddings WHERE profile_id = ?").run(profileId);
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
