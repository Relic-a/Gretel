import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { createEmbeddingInputWithTranscript, fetchTranscriptIntroduction } from "./transcription";
import { getVideoInteractions } from "../profile-store";
import type { FeedVideo } from "./types";
import {
  getCentroid,
  getRetainedEmbedding,
  getTopicCentroids,
  listCentroidPoolKeys,
  listCentroids,
  retainEmbedding,
  updateCentroid,
  updateTopicCentroid,
  type StoredTopicCentroid
} from "./algorithm-store";
import { averageNormalizedVectors, cosineSimilarity, driftCentroid, normalizeVector } from "./vector-math";
import { listPoolNodes, updatePoolSimilarities } from "./pool-store";
import { logDebug, logInfo } from "../logger";

export async function updateCentroidsForPositiveEngagement(profileId: string, video: FeedVideo) {
  const config = getGretelConfig();

  if (!isPositiveEngagement(video, config.learning.watchSaveThreshold)) {
    logDebug("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "not_positive_engagement"
    });
    return;
  }

  if (getVideoInteractions(profileId).size < config.feed.coldStartInteractionThreshold) {
    logDebug("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "cold_start"
    });
    return;
  }

  let embedding = getRetainedEmbedding(profileId, video.id);

  if (!embedding) {
    const transcriptIntroduction = await fetchTranscriptIntroduction(profileId, video.id, config);
    const input = transcriptIntroduction
      ? createEmbeddingInputWithTranscript(video, transcriptIntroduction)
      : createEmbeddingInput(video);
    const vectors = await getEmbeddingProvider(config).embedTexts([input]);
    embedding = vectors[0] || null;

    if (embedding) {
      retainEmbedding(profileId, video.id, embedding);
    }
  }

  if (!embedding) {
    logDebug("feed.phase4.centroid_drift", {
      profileId,
      videoId: video.id,
      status: "skipped",
      reason: "missing_embedding"
    });
    return;
  }

  const poolKeys = listCentroidPoolKeys(profileId);
  const effectivePoolKeys = poolKeys.length > 0
    ? poolKeys
    : listCentroids(profileId).map((row) => row.cacheKey);
  const updatedAt = Date.now();
  let updatedCentroids = 0;

  for (const poolKey of effectivePoolKeys) {
    const topicCentroids = getTopicCentroids(profileId, poolKey);

    if (topicCentroids.length === 0) {
      continue;
    }

    if (topicCentroids.length === 1) {
      const tc = topicCentroids[0];
      if (tc.original.length === 0 || tc.current.length === 0) {
        continue;
      }

      const proposed = driftCentroid(tc.current, embedding, config.learning.centroidLearningRate);
      const nextCentroid = clampCentroidDrift(tc.original, proposed, config.learning.maxCentroidDrift);

      if (tc.topic === "default") {
        updateCentroid(profileId, poolKey, nextCentroid, updatedAt);
      } else {
        updateTopicCentroid(profileId, poolKey, tc.topic, nextCentroid, updatedAt);
        updateCentroid(profileId, poolKey, nextCentroid, updatedAt);
      }

      recomputePoolSimilarities(profileId, poolKey, [{ topic: tc.topic, vector: nextCentroid }]);
      updatedCentroids += 1;
      continue;
    }

    // Competitive learning: find the winning topic whose current centroid matches closest
    let bestScore = -Infinity;
    let winner: StoredTopicCentroid | null = null;

    for (const tc of topicCentroids) {
      if (tc.current.length === 0) continue;
      const score = cosineSimilarity(embedding, tc.current);
      if (score > bestScore) {
        bestScore = score;
        winner = tc;
      }
    }

    // Gating: only drift if there is positive alignment with the winning topic
    if (winner && bestScore > 0) {
      const proposed = driftCentroid(winner.current, embedding, config.learning.centroidLearningRate);
      const nextCentroid = clampCentroidDrift(winner.original, proposed, config.learning.maxCentroidDrift);

      // Drift ONLY the winning topic
      updateTopicCentroid(profileId, poolKey, winner.topic, nextCentroid, updatedAt);

      // Recompute composite centroid for legacy compatibility
      const updatedTopics = topicCentroids.map((tc) =>
        tc.topic === winner.topic
          ? { topic: tc.topic, vector: nextCentroid }
          : { topic: tc.topic, vector: tc.current }
      );
      const compositeCurrent = averageNormalizedVectors(updatedTopics.map((tc) => tc.vector));
      updateCentroid(profileId, poolKey, compositeCurrent, updatedAt);

      // Rescore pool nodes across all updated topic centroids
      recomputePoolSimilarities(profileId, poolKey, updatedTopics);
      updatedCentroids += 1;
    }
  }

  logInfo("feed.phase4.centroid_drift", {
    profileId,
    videoId: video.id,
    status: updatedCentroids > 0 ? "updated" : "unchanged",
    centroidsChecked: effectivePoolKeys.length,
    updatedCentroids,
    rejectedCentroids: 0
  });
}

export function clampCentroidDrift(original: number[], candidate: number[], maxDrift: number) {
  const sim = cosineSimilarity(original, candidate);
  const driftDistance = 1 - sim;

  if (driftDistance <= maxDrift) {
    return candidate;
  }

  const minSim = Math.max(-1, Math.min(1, 1 - maxDrift));
  const perp = candidate.map((val, i) => val - sim * original[i]);
  const perpNorm = Math.sqrt(perp.reduce((sum, val) => sum + val * val, 0));

  if (perpNorm === 0) {
    return original;
  }

  const sinAngle = Math.sqrt(Math.max(0, 1 - minSim * minSim));
  const clamped = original.map((val, i) => minSim * val + sinAngle * (perp[i] / perpNorm));

  return normalizeVector(clamped);
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

export function recomputePoolSimilarities(
  profileId: string,
  poolKey: string,
  centroidsInput?: Array<{ topic: string; vector: number[] }> | number[]
) {
  let centroids: Array<{ topic: string; vector: number[] }> = [];

  if (Array.isArray(centroidsInput) && centroidsInput.length > 0 && typeof centroidsInput[0] === "number") {
    centroids = [{ topic: "default", vector: centroidsInput as number[] }];
  } else if (Array.isArray(centroidsInput) && centroidsInput.length > 0) {
    centroids = centroidsInput as Array<{ topic: string; vector: number[] }>;
  } else {
    const topicCentroids = getTopicCentroids(profileId, poolKey);
    centroids = topicCentroids.map((tc) => ({ topic: tc.topic, vector: tc.current }));
  }

  const rescored = listPoolNodes(profileId, poolKey).flatMap((node) => {
    const embedding = getRetainedEmbedding(profileId, node.id);

    if (!embedding) {
      return [];
    }

    if (centroids.length === 0) {
      return [{
        ...node,
        similarityScore: 0
      }];
    }

    let bestScore = -1;
    let bestTopic: string | undefined;

    for (const tc of centroids) {
      if (tc.vector.length === 0) continue;
      const score = cosineSimilarity(embedding, tc.vector);
      if (score > bestScore) {
        bestScore = score;
        bestTopic = tc.topic;
      }
    }

    return [{
      ...node,
      similarityScore: bestScore >= 0 ? bestScore : 0,
      ...(bestTopic ? { matchedTopic: bestTopic } : {})
    }];
  });

  updatePoolSimilarities(profileId, poolKey, rescored);
}
