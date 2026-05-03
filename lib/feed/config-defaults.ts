import type { FeedNodeWeights } from "./types";

export type GretelConfig = {
  feed: {
    maxQueries: number;
    maxVideos: number;
    poolSizeCap: number;
    cacheTargetVideos: number;
    cacheRefreshHours: number;
    subscriptionRefreshMinutes: number;
    recommendationSeeds: number;
    relatedVideosPerSeed: number;
    watchedRecommendationSeeds: number;
    maxNodeWeight: number;
    cacheReadMultiplier: number;
    minVideosPerQuery: number;
    minVideosPerChannel: number;
    maxSharePerNode: number;
    maxSharePerChannel: number;
    similarityThreshold: number;
    coldStartInteractionThreshold: number;
    expansionSeedCount: number;
    minRelatedVideosPerSeed: number;
    maxRelatedVideosPerSeed: number;
    readyQueueTargetSize: number;
    readyQueueLowWaterMark: number;
    subscriptionFastLanePerSession: number;
    coldStartParentEngagementWeight: number;
    defaultNodeWeights: FeedNodeWeights;
    subscriptionMix: {
      latest: number;
      trending: number;
      popular: number;
      trendingLookbackVideos: number;
    };
  };
  learning: {
    watchSaveThreshold: number;
    watchTimeWeight: number;
    likedWeight: number;
    clickedWeight: number;
    ignorePenaltyBase: number;
    ignorePenaltyGrowth: number;
    centroidLearningRate: number;
    maxCentroidDrift: number;
    watchCompletionThreshold: number;
  };
  embeddings: {
    provider: "openrouter" | "mock";
    store: "sqlite-vec";
    openRouterApiKeyEnv: string;
    openRouterBaseUrl: string;
    model: string;
    dimensions: number;
    batchSize: number;
    requestTimeoutMs: number;
    mockSeed: number;
  };
  client: {
    watchProgressPollMs: number;
  };
  youtube: {
    language: string;
  };
};

export const DEFAULT_GRETEL_CONFIG: GretelConfig = {
  feed: {
    maxQueries: 5,
    maxVideos: 48,
    poolSizeCap: 120,
    cacheTargetVideos: 120,
    cacheRefreshHours: 6,
    subscriptionRefreshMinutes: 45,
    recommendationSeeds: 4,
    relatedVideosPerSeed: 5,
    watchedRecommendationSeeds: 6,
    maxNodeWeight: 5,
    cacheReadMultiplier: 3,
    minVideosPerQuery: 3,
    minVideosPerChannel: 3,
    maxSharePerNode: 1,
    maxSharePerChannel: 1,
    similarityThreshold: 0.32,
    coldStartInteractionThreshold: 12,
    expansionSeedCount: 4,
    minRelatedVideosPerSeed: 1,
    maxRelatedVideosPerSeed: 8,
    readyQueueTargetSize: 48,
    readyQueueLowWaterMark: 16,
    subscriptionFastLanePerSession: 6,
    coldStartParentEngagementWeight: 0.15,
    defaultNodeWeights: {
      tagSearch: 2,
      channelVideos: 2,
      relatedVideos: 3,
      watchedVideos: 2
    },
    subscriptionMix: {
      latest: 0.4,
      trending: 0.35,
      popular: 0.25,
      trendingLookbackVideos: 24
    }
  },
  learning: {
    watchSaveThreshold: 0.5,
    watchTimeWeight: 0.5,
    likedWeight: 0.3,
    clickedWeight: 0.2,
    ignorePenaltyBase: 0.2,
    ignorePenaltyGrowth: 1.8,
    centroidLearningRate: 0.08,
    maxCentroidDrift: 0.18,
    watchCompletionThreshold: 0.9
  },
  embeddings: {
    provider: "openrouter",
    store: "sqlite-vec",
    openRouterApiKeyEnv: "OPENROUTER_API_KEY",
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen3-embedding-8b",
    dimensions: 4096,
    batchSize: 16,
    requestTimeoutMs: 30000,
    mockSeed: 20260503
  },
  client: {
    watchProgressPollMs: 2000
  },
  youtube: {
    language: "en"
  }
};
