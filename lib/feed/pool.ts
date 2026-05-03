import { applyEngagement, type VideoInteraction } from "./engagement";
import type { GretelConfig } from "./config-defaults";
import type { FeedNodeSummary, FeedVideo } from "./types";

export type CandidatePoolResult = {
  videos: FeedVideo[];
  nodes: FeedNodeSummary[];
};

export function createCandidatePoolFeed(input: {
  rootVideos: FeedVideo[];
  channelVideos: FeedVideo[];
  relatedVideos: FeedVideo[];
  watchedVideos?: FeedVideo[];
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
        return (right.similarityScore || 0) - (left.similarityScore || 0);
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
      summarizeNode("relatedVideos", "Related videos", input.relatedVideos, poolVideos),
      summarizeNode("watchedVideos", "Watched video neighbors", input.watchedVideos || [], poolVideos)
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

export function relatedBudgetForSeed(seed: FeedVideo, seeds: FeedVideo[], config: GretelConfig) {
  const scores = seeds.map((video) => Math.max(0, video.engagementScore || video.similarityScore || 0));
  const maxScore = Math.max(...scores, 0);
  const minBudget = config.feed.minRelatedVideosPerSeed;
  const maxBudget = config.feed.maxRelatedVideosPerSeed;

  if (maxScore === 0) {
    return minBudget;
  }

  return Math.max(
    minBudget,
    Math.min(maxBudget, Math.ceil((Math.max(0, seed.engagementScore || seed.similarityScore || 0) / maxScore) * maxBudget))
  );
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
