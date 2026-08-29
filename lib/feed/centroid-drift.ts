import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { createEmbeddingInputWithTranscript, fetchTranscriptIntroduction } from "./transcription";
import { getVideoInteractions } from "../profile-store";
import type { FeedVideo } from "./types";
import { cosineSimilarity, driftCentroid, normalizeVector } from "./vector-math";
import {
  getRetainedEmbedding,
  listCentroids,
  retainEmbedding,
  updateCentroid
} from "./algorithm-store";
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

  const rows = listCentroids(profileId);
  const updatedAt = Date.now();
  let updatedCentroids = 0;
  let rejectedCentroids = 0;

  for (const row of rows) {
    if (row.original.length === 0 || row.current.length === 0) {
      continue;
    }

    const proposed = driftCentroid(row.current, embedding, config.learning.centroidLearningRate);
    const nextCentroid = clampCentroidDrift(row.original, proposed, config.learning.maxCentroidDrift);

    updateCentroid(profileId, row.cacheKey, nextCentroid, updatedAt);
    recomputePoolSimilarities(profileId, row.cacheKey, nextCentroid);
    updatedCentroids += 1;
  }

  logInfo("feed.phase4.centroid_drift", {
    profileId,
    videoId: video.id,
    status: updatedCentroids > 0 ? "updated" : "unchanged",
    centroidsChecked: rows.length,
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
