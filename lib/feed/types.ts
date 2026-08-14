export type ChannelSort = "mixed";

export type FeedVideo = {
  id: string;
  title: string;
  author: string;
  channelAvatarUrl?: string;
  duration: string;
  query: string;
  thumbnailUrl?: string;
  thumbnailCacheUrl?: string;
  publishedText?: string;
  publishedAt?: number;
  viewCount?: number;
  sourceNodeId?: FeedNodeId;
  sourceNodeLabel?: string;
  channelKey?: string;
  parent_video_id?: string;
  parent_title?: string;
  parent_author?: string;
  recommendation_depth?: number;
  similarityScore?: number;
  engagementScore?: number;
  parentEngagementScore?: number;
  impressionCount?: number;
  watchTimeRatio?: number;
  liked?: boolean;
  clicked?: boolean;
  ignoreCount?: number;
};

export type FeedNodeId =
  | "tagSearch"
  | "channelVideos"
  | "relatedVideos";

export type FeedNodeSummary = {
  id: FeedNodeId;
  label: string;
  weight: number;
  effectiveWeight: number;
  inputVideos: number;
  outputVideos: number;
};

import type { PerformanceTrace } from "../performance-metrics";

export type FeedObservation = PerformanceTrace;
