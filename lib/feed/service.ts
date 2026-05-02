import { createQueries } from "./input";
import { createWeightedFeed, type FeedNetworkNode, type FeedNetworkOptions } from "./network";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedNodeWeights, FeedObservation, FeedVideo } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";

export async function createFeed(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  prompt: string,
  weights: FeedNodeWeights,
  observation: FeedObservation,
  networkOptions: FeedNetworkOptions,
  latestWatchedVideos: FeedVideo[] = []
) {
  const queries = createQueries(tags);
  const tagSearchVideos =
    queries.length > 0 ? await searchVideos(queries, prompt, observation, profileId) : [];
  const naturalLanguageVideos =
    prompt.length > 0 ? await searchVideos([prompt], prompt, observation, profileId) : [];
  const channelVideos =
    channels.length > 0
      ? await fetchChannelVideos(channels, channelSort, prompt, observation, profileId)
      : [];
  const seedVideos = [...tagSearchVideos, ...naturalLanguageVideos, ...channelVideos];
  const relatedVideos =
    weights.relatedVideos > 0
      ? await recommendVideosFromSeeds(seedVideos, prompt, observation, profileId)
      : [];
  const watchedVideos =
    weights.watchedVideos > 0 && latestWatchedVideos.length > 0
      ? await recommendVideosFromSeeds(
          latestWatchedVideos,
          prompt,
          observation,
          profileId,
          "Watched-neighbor from"
        )
      : [];
  const networkNodes: FeedNetworkNode[] = [
    {
      id: "tagSearch",
      label: "Tag search",
      weight: weights.tagSearch,
      videos: tagSearchVideos
    },
    {
      id: "channelVideos",
      label: "Subscription videos",
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
    },
    {
      id: "watchedVideos",
      label: "Watched video neighbors",
      weight: weights.watchedVideos,
      videos: watchedVideos
    }
  ];
  const feed = createWeightedFeed(networkNodes, networkOptions);

  return {
    queries,
    videos: feed.videos,
    nodes: feed.nodes,
    searchVideos: tagSearchVideos.length + naturalLanguageVideos.length,
    channelVideos: channelVideos.length,
    watchedVideos: watchedVideos.length
  };
}
