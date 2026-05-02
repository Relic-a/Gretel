export type ChannelSort = "latest" | "popular";

export type FeedVideo = {
  id: string;
  title: string;
  author: string;
  duration: string;
  query: string;
  sourceNodeId?: FeedNodeId;
  sourceNodeLabel?: string;
  channelKey?: string;
};

export type FeedNodeId =
  | "tagSearch"
  | "channelVideos"
  | "relatedVideos"
  | "watchedVideos";

export type FeedNodeWeights = Record<FeedNodeId, number>;

export type FeedNodeSummary = {
  id: FeedNodeId;
  label: string;
  weight: number;
  effectiveWeight: number;
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
