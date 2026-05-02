export const MAX_QUERIES = 5;
export const MAX_VIDEOS = 18;
export const RECOMMENDATION_SEEDS = 4;
export const MAX_NODE_WEIGHT = 5;

export const DEFAULT_FEED_NODE_WEIGHTS = {
  tagSearch: 2,
  channelVideos: 2,
  naturalLanguage: 1,
  relatedVideos: 3,
  watchedVideos: 2
} as const;

export const NODE_AFFINITY_STEP = 0.15;
export const CHANNEL_AFFINITY_STEP = 0.2;
export const MAX_AFFINITY_BOOST = 3;
export const WATCHED_RECOMMENDATION_SEEDS = 6;
