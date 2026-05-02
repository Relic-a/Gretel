import type { FeedNodeWeights } from "./types";

export type GretelConfig = {
  feed: {
    maxQueries: number;
    maxVideos: number;
    cacheTargetVideos: number;
    cacheRefreshHours: number;
    subscriptionRefreshMinutes: number;
    recommendationSeeds: number;
    watchedRecommendationSeeds: number;
    maxNodeWeight: number;
    cacheReadMultiplier: number;
    minVideosPerQuery: number;
    minVideosPerChannel: number;
    maxSharePerNode: number;
    maxSharePerChannel: number;
    defaultNodeWeights: FeedNodeWeights;
  };
  learning: {
    watchSaveThreshold: number;
    nodeAffinityStep: number;
    channelAffinityStep: number;
    maxAffinityBoost: number;
  };
  client: {
    watchProgressPollMs: number;
  };
};

export const DEFAULT_GRETEL_CONFIG: GretelConfig = {
  feed: {
    maxQueries: 5,
    maxVideos: 48,
    cacheTargetVideos: 120,
    cacheRefreshHours: 6,
    subscriptionRefreshMinutes: 45,
    recommendationSeeds: 4,
    watchedRecommendationSeeds: 6,
    maxNodeWeight: 5,
    cacheReadMultiplier: 3,
    minVideosPerQuery: 3,
    minVideosPerChannel: 3,
    maxSharePerNode: 1,
    maxSharePerChannel: 1,
    defaultNodeWeights: {
      tagSearch: 2,
      channelVideos: 2,
      relatedVideos: 3,
      watchedVideos: 2
    }
  },
  learning: {
    watchSaveThreshold: 0.5,
    nodeAffinityStep: 0.15,
    channelAffinityStep: 0.2,
    maxAffinityBoost: 3
  },
  client: {
    watchProgressPollMs: 2000
  }
};
