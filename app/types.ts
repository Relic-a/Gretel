export type FeedVideo = {
  id: string;
  title: string;
  author: string;
  query?: string;
  channelAvatarUrl?: string;
  duration: string;
  thumbnailUrl?: string;
  thumbnailCacheUrl?: string;
  publishedText?: string;
  publishedAt?: number;
  viewCount?: number;
  channelKey?: string;
  channelId?: string;
  parent_video_id?: string;
  parent_title?: string;
  parent_author?: string;
  recommendation_depth?: number;
  sourceNodeId?: "tagSearch" | "channelVideos" | "relatedVideos";
  sourceNodeLabel?: string;
  impressionCount?: number;
  liked?: boolean;
  clicked?: boolean;
  ignoreCount?: number;
  watchTimeRatio?: number;
};

export type Profile = {
  id: string;
  name: string;
  tags?: string[];
  channels?: string[];
};

export type ChannelResult = {
  id: string;
  name: string;
  thumbnailUrl?: string;
};

export type FeedResponse = {
  profile: Profile;
  videos: FeedVideo[];
  sessionId?: string;
  upNextByVideoId?: Record<string, string[]>;
};

export type PublicGretelConfig = {
  serving: {
    impressionPenaltyFactor: number;
    fastLaneImpressionPenaltyFactor: number;
    warmSemanticWeight: number;
  };
  expansion: {
    initialFetchSize: number;
    minDelayBetweenFetchesMs: number;
    maxFetchCallsPerCycle: number;
    cycleCooldownMs: number;
    minFreshVideos: number;
    minFreshRatio: number;
    minExpansionYield: number;
  };
  transcription: {
    introductionPercentage: number;
    maxCharacters: number;
  };
  feed: {
    maxVideos: number;
  };
  learning: {
    watchSaveThreshold: number;
  };
  embeddings: {
    provider: string;
    store: string;
    model: string;
    dimensions: number;
  };
  client: {
    watchProgressPollMs: number;
  };
  youtube: {
    language: string;
  };
};

export type UserSettings = {
  openRouterApiKey?: string;
  openRouterModel?: string;
};
