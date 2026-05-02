import { MAX_VIDEOS } from "./config";
import type { FeedNodeId, FeedNodeSummary, FeedVideo } from "./types";
import { nextUniqueVideo } from "./video-utils";

export type FeedNetworkNode = {
  id: FeedNodeId;
  label: string;
  weight: number;
  videos: FeedVideo[];
};

export type FeedNetworkOptions = {
  watchedVideoIds?: string[];
  nodeBoosts?: Partial<Record<FeedNodeId, number>>;
  channelBoosts?: Record<string, number>;
};

type RankedNode = FeedNetworkNode & {
  effectiveWeight: number;
};

export function createWeightedFeed(nodes: FeedNetworkNode[], options: FeedNetworkOptions = {}) {
  const watchedVideoIds = new Set(options.watchedVideoIds || []);
  const rankedNodes = nodes.map<RankedNode>((node) => ({
    ...node,
    effectiveWeight: node.weight + (options.nodeBoosts?.[node.id] || 0),
    videos: rankVideos(
      node.videos.filter((video) => !watchedVideoIds.has(video.id)),
      options.channelBoosts || {}
    )
  }));
  const activeNodes = rankedNodes.filter(
    (node) => node.effectiveWeight > 0 && node.videos.length > 0
  );
  const schedule = activeNodes.flatMap((node) =>
    Array.from({ length: Math.max(1, Math.round(node.effectiveWeight)) }, () => node)
  );
  const seen = new Set<string>();
  const cursors = new Map<string, number>();
  const outputCounts = new Map<string, number>();
  const videos: FeedVideo[] = [];

  while (videos.length < MAX_VIDEOS && schedule.length > 0) {
    let added = false;

    for (const node of schedule) {
      const cursor = cursors.get(node.id) || 0;
      const nextVideo = nextUniqueVideo(node.videos, seen, cursor);
      cursors.set(node.id, nextVideo.nextIndex);

      if (nextVideo.item) {
        videos.push({
          ...nextVideo.item,
          sourceNodeId: node.id,
          sourceNodeLabel: node.label
        });
        outputCounts.set(node.id, (outputCounts.get(node.id) || 0) + 1);
        added = true;
      }

      if (videos.length >= MAX_VIDEOS) {
        break;
      }
    }

    if (!added) {
      break;
    }
  }

  return {
    videos,
    nodes: rankedNodes.map<FeedNodeSummary>((node) => ({
      id: node.id,
      label: node.label,
      weight: node.weight,
      effectiveWeight: Number(node.effectiveWeight.toFixed(2)),
      inputVideos: node.videos.length,
      outputVideos: outputCounts.get(node.id) || 0
    }))
  };
}

function rankVideos(videos: FeedVideo[], channelBoosts: Record<string, number>) {
  return videos
    .map((video, index) => ({
      video,
      index,
      boost: video.channelKey ? channelBoosts[video.channelKey] || 0 : 0
    }))
    .sort((left, right) => right.boost - left.boost || left.index - right.index)
    .map((entry) => entry.video);
}
