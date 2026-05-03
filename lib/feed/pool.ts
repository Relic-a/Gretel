import { applyEngagement, type VideoInteraction } from "./engagement";
import type { GretelConfig } from "./config-defaults";
import type { FeedNodeSummary, FeedVideo } from "./types";
import { cosineSimilarity } from "./vector-math";

export type CandidatePoolResult = {
  videos: FeedVideo[];
  nodes: FeedNodeSummary[];
};

export function createCandidatePoolFeed(input: {
  rootVideos: FeedVideo[];
  channelVideos: FeedVideo[];
  relatedVideos: FeedVideo[];
  watchedVideoIds: Set<string>;
  interactions: Map<string, VideoInteraction>;
  config: GretelConfig;
}) {
  const interactionCount = input.interactions.size;
  const isColdStart = interactionCount < input.config.feed.coldStartInteractionThreshold;
  const allPoolVideos = [...input.rootVideos, ...input.channelVideos, ...input.relatedVideos]
    .map((video) => applyEngagement(video, input.interactions, input.config));
  const servedVideos = allPoolVideos
    .filter((video) => input.interactions.has(video.id))
    .filter((video) => (video.watchTimeRatio || 0) < input.config.learning.watchCompletionThreshold)
    .sort((left, right) => (right.engagementScore || 0) - (left.engagementScore || 0));
  const unservedVideos = allPoolVideos
    .filter((video) => !input.interactions.has(video.id) && !input.watchedVideoIds.has(video.id))
    .sort((left, right) => {
      if (isColdStart) {
        return coldStartExpansionScore(right, input.config) -
          coldStartExpansionScore(left, input.config);
      }

      return (right.parentEngagementScore || 0) - (left.parentEngagementScore || 0) ||
        (right.similarityScore || 0) - (left.similarityScore || 0);
    });
  const poolVideos = [...servedVideos, ...unservedVideos].slice(
    0,
    input.config.feed.readyQueueTargetSize
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

export function selectExpansionSeeds(input: {
  videos: FeedVideo[];
  interactions: Map<string, VideoInteraction>;
  config: GretelConfig;
}) {
  const isColdStart = input.interactions.size < input.config.feed.coldStartInteractionThreshold;

  return [...input.videos]
    .sort((left, right) => {
      if (isColdStart) {
        return (right.similarityScore || 0) - (left.similarityScore || 0);
      }

      return (right.engagementScore || 0) - (left.engagementScore || 0);
    })
    .slice(0, input.config.feed.expansionSeedCount);
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
