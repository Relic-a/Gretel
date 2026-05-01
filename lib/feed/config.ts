export const MAX_QUERIES = 5;
export const MAX_VIDEOS = 18;
export const RECOMMENDATION_SEEDS = 4;
export const MAX_NODE_WEIGHT = 5;

export const DEFAULT_FEED_NODE_WEIGHTS = {
  tagSearch: 2,
  channelVideos: 2,
  naturalLanguage: 1,
  relatedVideos: 3
} as const;
