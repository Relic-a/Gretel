import { MAX_VIDEOS } from "./config";
import type { FeedNodeSummary, FeedVideo } from "./types";
import { nextUniqueVideo } from "./video-utils";

export type FeedNetworkNode = {
  id: string;
  label: string;
  weight: number;
  videos: FeedVideo[];
};

export function createWeightedFeed(nodes: FeedNetworkNode[]) {
  const activeNodes = nodes.filter((node) => node.weight > 0 && node.videos.length > 0);
  const schedule = activeNodes.flatMap((node) => Array.from({ length: Math.round(node.weight) }, () => node));
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
        videos.push(nextVideo.item);
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
    nodes: nodes.map<FeedNodeSummary>((node) => ({
      id: node.id,
      label: node.label,
      weight: node.weight,
      inputVideos: node.videos.length,
      outputVideos: outputCounts.get(node.id) || 0
    }))
  };
}
