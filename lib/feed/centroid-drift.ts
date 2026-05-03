import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { getDatabase, getVideoInteractions } from "../profile-store";
import type { FeedVideo } from "./types";
import { cosineSimilarity, driftCentroid } from "./vector-math";
import { getRetainedEmbedding, retainEmbedding } from "./algorithm-store";

export async function updateCentroidsForPositiveEngagement(profileId: string, video: FeedVideo) {
  const config = getGretelConfig();

  if (getVideoInteractions(profileId).size < config.feed.coldStartInteractionThreshold) {
    return;
  }

  let embedding = getRetainedEmbedding(profileId, video.id);

  if (!embedding) {
    const vectors = await getEmbeddingProvider(config).embedTexts([createEmbeddingInput(video)]);
    embedding = vectors[0] || null;

    if (embedding) {
      retainEmbedding(profileId, video.id, embedding);
    }
  }

  if (!embedding) {
    return;
  }

  const rows = getDatabase()
    .prepare(
      `SELECT cache_key, original_json, current_json
       FROM feed_centroids
       WHERE profile_id = ?`
    )
    .all(profileId) as Array<{
      cache_key: string;
      original_json: string;
      current_json: string;
    }>;
  const updatedAt = Date.now();
  const statement = getDatabase().prepare(
    `UPDATE feed_centroids
     SET current_json = ?, updated_at = ?
     WHERE profile_id = ? AND cache_key = ?`
  );

  for (const row of rows) {
    const original = JSON.parse(row.original_json) as number[];
    const current = JSON.parse(row.current_json) as number[];

    if (original.length === 0 || current.length === 0) {
      continue;
    }

    const proposed = driftCentroid(current, embedding, config.learning.centroidLearningRate);
    const driftDistance = 1 - cosineSimilarity(original, proposed);

    if (driftDistance <= config.learning.maxCentroidDrift) {
      statement.run(JSON.stringify(proposed), updatedAt, profileId, row.cache_key);
    }
  }
}
