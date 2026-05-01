export type ChannelSort = "latest" | "popular";

export type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  query: string;
};

export type FeedNodeId = "tagSearch" | "channelVideos" | "naturalLanguage" | "relatedVideos";

export type FeedNodeWeights = Record<FeedNodeId, number>;

export type FeedNodeSummary = {
  id: string;
  label: string;
  weight: number;
  inputVideos: number;
  outputVideos: number;
};

export type FeedObservation = {
  requestId: string;
  startedAt: number;
  operations: Array<{
    name: string;
    durationMs: number;
    input?: Record<string, number | string | boolean>;
    output?: Record<string, number | string | boolean>;
  }>;
};
