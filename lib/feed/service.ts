import { createQueries } from "./input";
import { createWeightedFeed, type FeedNetworkNode } from "./network";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedNodeWeights, FeedObservation } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";

export async function createFeed(
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  prompt: string,
  weights: FeedNodeWeights,
  observation: FeedObservation
) {
  const queries = createQueries(tags);
  const tagSearchVideos =
    queries.length > 0 ? await searchVideos(queries, prompt, observation) : [];
  const naturalLanguageVideos =
    prompt.length > 0 ? await searchVideos([prompt], prompt, observation) : [];
  const channelVideos =
    channels.length > 0 ? await fetchChannelVideos(channels, channelSort, prompt, observation) : [];
  const seedVideos = [...tagSearchVideos, ...naturalLanguageVideos, ...channelVideos];
  const relatedVideos =
    weights.relatedVideos > 0 ? await recommendVideosFromSeeds(seedVideos, prompt, observation) : [];
  const networkNodes: FeedNetworkNode[] = [
    {
      id: "tagSearch",
      label: "Tag search",
      weight: weights.tagSearch,
      videos: tagSearchVideos
    },
    {
      id: "channelVideos",
      label: "Channel videos",
      weight: weights.channelVideos,
      videos: channelVideos
    },
    {
      id: "naturalLanguage",
      label: "Natural language search",
      weight: weights.naturalLanguage,
      videos: naturalLanguageVideos
    },
    {
      id: "relatedVideos",
      label: "Related videos",
      weight: weights.relatedVideos,
      videos: relatedVideos
    }
  ];
  const feed = createWeightedFeed(networkNodes);

  return {
    queries,
    videos: feed.videos,
    nodes: feed.nodes,
    searchVideos: tagSearchVideos.length + naturalLanguageVideos.length,
    channelVideos: channelVideos.length
  };
}
