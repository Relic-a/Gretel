export type GretelConfig = {
  serving: {
    impressionPenaltyFactor: number;
    fastLaneImpressionPenaltyFactor: number;
    warmSemanticWeight: number;
  };
  expansion: {
    initialFetchSize: number;
    initialExpansionCycles: number;
    initialExpansionSeedCount: number;
    minDelayBetweenFetchesMs: number;
    maxFetchCallsPerCycle: number;
    cycleCooldownMs: number;
    minFreshVideos: number;
    minFreshRatio: number;
    minExpansionYield: number;
    maxVideosPerCycle: number;
  };
  transcription: {
    introductionPercentage: number;
    maxCharacters: number;
  };
  feed: {
    maxQueries: number;
    maxVideos: number;
    poolSizeCap: number;
    subscriptionRefreshMinutes: number;
    recommendationSeeds: number;
    minVideosPerQuery: number;
    minVideosPerChannel: number;
    similarityThreshold: number;
    coldStartInteractionThreshold: number;
    expansionSeedCount: number;
    minRelatedVideosPerSeed: number;
    maxRelatedVideosPerSeed: number;
    subscriptionFastLanePerSession: number;
    coldStartParentEngagementWeight: number;
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
    openRouterSiteUrlEnv: string;
    openRouterAppNameEnv: string;
    model: string;
    dimensions: number;
    batchSize: number;
    maxConcurrentRequests: number;
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
  serving: {
    impressionPenaltyFactor: 0.35,
    fastLaneImpressionPenaltyFactor: 0.08,
    warmSemanticWeight: 0.25
  },
  expansion: {
    initialFetchSize: 240,
    initialExpansionCycles: 3,
    initialExpansionSeedCount: 6,
    minDelayBetweenFetchesMs: 500,
    maxFetchCallsPerCycle: 4,
    cycleCooldownMs: 120000,
    minFreshVideos: 24,
    minFreshRatio: 0.25,
    minExpansionYield: 1,
    maxVideosPerCycle: 120
  },
  transcription: {
    introductionPercentage: 0.15,
    maxCharacters: 2000
  },
  feed: {
    maxQueries: 5,
    maxVideos: 48,
    poolSizeCap: 400,
    subscriptionRefreshMinutes: 45,
    recommendationSeeds: 4,
    minVideosPerQuery: 3,
    minVideosPerChannel: 3,
    similarityThreshold: 0.45,
    coldStartInteractionThreshold: 12,
    expansionSeedCount: 4,
    minRelatedVideosPerSeed: 1,
    maxRelatedVideosPerSeed: 12,
    subscriptionFastLanePerSession: 6,
    coldStartParentEngagementWeight: 0.15
  },
  learning: {
    watchSaveThreshold: 0.1,
    watchTimeWeight: 0.5,
    likedWeight: 0.3,
    clickedWeight: 0.2,
    ignorePenaltyBase: 0.2,
    ignorePenaltyGrowth: 1.8,
    centroidLearningRate: 0.08,
    maxCentroidDrift: 0.18,
    watchCompletionThreshold: 0.6
  },
  embeddings: {
    provider: "openrouter",
    store: "sqlite-vec",
    openRouterApiKeyEnv: "OPENROUTER_API_KEY",
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    openRouterSiteUrlEnv: "OPENROUTER_SITE_URL",
    openRouterAppNameEnv: "OPENROUTER_APP_NAME",
    model: "qwen/qwen3-embedding-8b",
    dimensions: 1024,
    batchSize: 16,
    maxConcurrentRequests: 13,
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
