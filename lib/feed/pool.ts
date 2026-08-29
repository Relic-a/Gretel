import { applyEngagement, type VideoInteraction } from "./engagement";
import type { GretelConfig } from "./config-defaults";
import type { FeedNodeSummary, FeedVideo } from "./types";
import { cosineSimilarity } from "./vector-math";

export type CandidatePoolResult = {
  videos: FeedVideo[];
  nodes: FeedNodeSummary[];
};

export type PoolHealth = {
  totalVideos: number;
  eligibleVideos: number;
  excludedClientVideos: number;
  servableVideos: number;
  freshVideos: number;
  freshRatio: number;
  needsExpansion: boolean;
  reasons: string[];
};

export function createCandidatePoolFeed(input: {
  rootVideos: FeedVideo[];
  channelVideos: FeedVideo[];
  relatedVideos: FeedVideo[];
  watchedVideoIds: Set<string>;
  excludeVideoIds?: Set<string>;
  interactions: Map<string, VideoInteraction>;
  config: GretelConfig;
}) {
  const interactionCount = input.interactions.size;
  const isColdStart = interactionCount < input.config.feed.coldStartInteractionThreshold;
  const allPoolVideos = [...input.rootVideos, ...input.channelVideos, ...input.relatedVideos]
    .map((video) => applyEngagement(video, input.interactions, input.config));
  const poolVideos = allPoolVideos
    .filter((video) => isEligibleForServing(video, input.watchedVideoIds, input.interactions, input.config))
    .filter((video) => !input.excludeVideoIds?.has(video.id))
    .sort((left, right) =>
      servingScore(right, input.config, isColdStart) - servingScore(left, input.config, isColdStart) ||
      (right.similarityScore || 0) - (left.similarityScore || 0)
    );

  return {
    videos: poolVideos,
    nodes: [
      summarizeNode("tagSearch", "Tag search", input.rootVideos, poolVideos),
      summarizeNode("channelVideos", "Subscription videos", input.channelVideos, poolVideos),
      summarizeNode("relatedVideos", "Related videos", input.relatedVideos, poolVideos)
    ]
  } satisfies CandidatePoolResult;
}

export function describePoolHealth(input: {
  videos: FeedVideo[];
  watchedVideoIds: Set<string>;
  excludeVideoIds: Set<string>;
  interactions: Map<string, VideoInteraction>;
  config: GretelConfig;
}): PoolHealth {
  const eligibleVideos = input.videos.filter((video) =>
    isEligibleForServing(video, input.watchedVideoIds, input.interactions, input.config)
  );
  const excludedClientVideos = eligibleVideos.filter((video) => input.excludeVideoIds.has(video.id)).length;
  const servableVideos = eligibleVideos.filter((video) => !input.excludeVideoIds.has(video.id));
  const freshVideos = servableVideos.filter((video) => (video.impressionCount || 0) === 0).length;
  const freshRatio = servableVideos.length > 0 ? freshVideos / servableVideos.length : 0;
  const reasons: string[] = [];

  if (freshRatio < input.config.expansion.minFreshRatio) {
    reasons.push("fresh_ratio");
  }

  return {
    totalVideos: input.videos.length,
    eligibleVideos: eligibleVideos.length,
    excludedClientVideos,
    servableVideos: servableVideos.length,
    freshVideos,
    freshRatio,
    needsExpansion: reasons.length > 0,
    reasons
  };
}

export function selectExpansionSeeds(input: {
  videos: FeedVideo[];
  interactions: Map<string, VideoInteraction>;
  config: GretelConfig;
  seedCount?: number;
}) {
  const isColdStart = input.interactions.size < input.config.feed.coldStartInteractionThreshold;
  const count = input.seedCount ?? input.config.feed.expansionSeedCount;

  return [...input.videos]
    .sort((left, right) => {
      if (isColdStart) {
        return (right.similarityScore || 0) - (left.similarityScore || 0);
      }

      return (right.engagementScore || 0) - (left.engagementScore || 0);
    })
    .slice(0, count);
}

export function relatedBudgetForSeed(
  seed: FeedVideo,
  seeds: FeedVideo[],
  config: GretelConfig,
  warmStart = true
) {
  const scores = seeds.map((video) => Math.max(0, expansionScore(video, config, warmStart)));
  const maxScore = Math.max(...scores, 0);
  const minBudget = config.feed.minRelatedVideosPerSeed;
  const maxBudget = config.feed.maxRelatedVideosPerSeed;

  if (maxScore === 0) {
    return minBudget;
  }

  return Math.max(
    minBudget,
    Math.min(maxBudget, Math.ceil((Math.max(0, expansionScore(seed, config, warmStart)) / maxScore) * maxBudget))
  );
}

export function selectUpNextCandidates(input: {
  currentVideo: FeedVideo;
  candidates: FeedVideo[];
  embeddings: Map<string, number[]>;
  limit?: number;
}) {
  const currentEmbedding = input.embeddings.get(input.currentVideo.id);

  if (!currentEmbedding) {
    return input.candidates.slice(0, input.limit);
  }

  return [...input.candidates]
    .sort((left, right) => {
      const leftSimilarity = similarityToCurrent(currentEmbedding, left, input.embeddings);
      const rightSimilarity = similarityToCurrent(currentEmbedding, right, input.embeddings);

      return rightSimilarity - leftSimilarity ||
        (right.engagementScore || 0) - (left.engagementScore || 0);
    })
    .slice(0, input.limit);
}

function expansionScore(video: FeedVideo, config: GretelConfig, warmStart: boolean) {
  return warmStart ? video.engagementScore || 0 : coldStartExpansionScore(video, config);
}

function servingScore(video: FeedVideo, config: GretelConfig, isColdStart: boolean) {
  return describeServingScore(video, config, isColdStart).score;
}

function warmServingScore(video: FeedVideo, config: GretelConfig) {
  const engagementScore = video.engagementScore || video.parentEngagementScore || 0;

  return engagementScore + (video.similarityScore || 0) * config.serving.warmSemanticWeight;
}

export function describeServingScore(video: FeedVideo, config: GretelConfig, isColdStart: boolean) {
  const semanticScore = video.similarityScore || 0;
  const engagementScore = video.engagementScore || video.parentEngagementScore || 0;
  const parentEngagementScore = video.parentEngagementScore || 0;
  const impressionCount = video.impressionCount || 0;
  const semanticWeight = config.serving.warmSemanticWeight;
  const impressionPenaltyFactor = config.serving.impressionPenaltyFactor;
  const coldStartParentEngagementWeight = config.feed.coldStartParentEngagementWeight;
  const baseScore = isColdStart
    ? coldStartExpansionScore(video, config)
    : warmServingScore(video, config);
  const impressionDecay = impressionCount === 0
    ? 1
    : Math.pow(1 - impressionPenaltyFactor, impressionCount);
  const score = impressionDecay === 1
    ? baseScore
    : baseScore >= 0
      ? baseScore * impressionDecay
      : baseScore * (2 - impressionDecay);

  return {
    score,
    baseScore,
    semanticScore,
    semanticContribution: isColdStart ? semanticScore : semanticScore * semanticWeight,
    engagementScore,
    engagementContribution: isColdStart ? parentEngagementScore * coldStartParentEngagementWeight : engagementScore,
    parentEngagementScore,
    impressionCount,
    impressionDecay,
    mode: isColdStart ? "coldStart" : "warm",
    weights: {
      semanticWeight,
      impressionPenaltyFactor,
      coldStartParentEngagementWeight
    }
  };
}

function similarityToCurrent(
  currentEmbedding: number[],
  candidate: FeedVideo,
  embeddings: Map<string, number[]>
) {
  const candidateEmbedding = embeddings.get(candidate.id);
  return candidateEmbedding ? cosineSimilarity(currentEmbedding, candidateEmbedding) : 0;
}

function coldStartExpansionScore(video: FeedVideo, config: GretelConfig) {
  return (video.similarityScore || 0) +
    (video.parentEngagementScore || 0) * config.feed.coldStartParentEngagementWeight;
}

function isEligibleForServing(
  video: FeedVideo,
  watchedVideoIds: Set<string>,
  interactions: Map<string, VideoInteraction>,
  config: GretelConfig
) {
  return (video.watchTimeRatio || 0) < config.learning.watchCompletionThreshold &&
    (interactions.has(video.id) || !watchedVideoIds.has(video.id));
}

function summarizeNode(
  id: FeedNodeSummary["id"],
  label: string,
  inputVideos: FeedVideo[],
  outputVideos: FeedVideo[]
) {
  return {
    id,
    label,
    weight: 1,
    effectiveWeight: 1,
    inputVideos: inputVideos.length,
    outputVideos: outputVideos.filter((video) => video.sourceNodeId === id).length
  };
}
