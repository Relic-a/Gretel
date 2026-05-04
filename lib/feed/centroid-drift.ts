import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { getVideoInteractions } from "../profile-store";
import type { FeedVideo } from "./types";
import { cosineSimilarity, driftCentroid } from "./vector-math";
import {
  getRetainedEmbedding,
  listCentroids,
  retainEmbedding,
  updateCentroid
} from "./algorithm-store";
import { listPoolNodes, updatePoolSimilarities } from "./pool-store";
import { logInfo } from "../logger";

export async function updateCentroidsForPositiveEngagement(profileId: string, video: FeedVideo) {
  const config = getGretelConfig();

  if (!isPositiveEngagement(video, config.learning.watchSaveThreshold)) {
    logInfo("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "not_positive_engagement"
    });
    return;
  }

  if (getVideoInteractions(profileId).size < config.feed.coldStartInteractionThreshold) {
    logInfo("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "cold_start"
    });
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
    logInfo("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "missing_embedding"
    });
    return;
  }

  const rows = listCentroids(profileId);
  const updatedAt = Date.now();
  let updatedCentroids = 0;
  let rejectedCentroids = 0;

  for (const row of rows) {
    if (row.original.length === 0 || row.current.length === 0) {
      continue;
    }

    const proposed = driftCentroid(row.current, embedding, config.learning.centroidLearningRate);
    const driftDistance = 1 - cosineSimilarity(row.original, proposed);

    if (driftDistance <= config.learning.maxCentroidDrift) {
      updateCentroid(profileId, row.cacheKey, proposed, updatedAt);
      recomputePoolSimilarities(profileId, row.cacheKey, proposed);
      updatedCentroids += 1;
    } else {
      rejectedCentroids += 1;
    }
  }

  logInfo("feed.phase4.centroid_drift", {
    profileId,
    videoId: video.id,
    status: updatedCentroids > 0 ? "updated" : "unchanged",
    centroidsChecked: rows.length,
    updatedCentroids,
    rejectedCentroids
  });
}

function isPositiveEngagement(video: FeedVideo, watchSaveThreshold: number) {
  if (video.liked || video.clicked) {
    return true;
  }

  if ((video.ignoreCount || 0) > 0) {
    return false;
  }

  return (video.watchTimeRatio || 0) >= watchSaveThreshold;
}

function recomputePoolSimilarities(profileId: string, poolKey: string, centroid: number[]) {
  const rescored = listPoolNodes(profileId, poolKey).flatMap((node) => {
    const embedding = getRetainedEmbedding(profileId, node.id);

    if (!embedding) {
      return [];
    }

    return [{
      ...node,
      similarityScore: cosineSimilarity(embedding, centroid)
    }];
  });

  updatePoolSimilarities(profileId, poolKey, rescored);
}
