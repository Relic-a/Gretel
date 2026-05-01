import { createQueries } from "./input";
import { blendVideosWithRecommendations } from "./recommendations";
import type { ChannelSort, FeedObservation } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";

export async function createFeed(
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  prompt: string,
  observation: FeedObservation
) {
  const queries = createQueries(tags);
  const searchVideosForQueries =
    queries.length > 0 ? await searchVideos(queries, prompt, observation) : [];
  const channelVideos =
    channels.length > 0 ? await fetchChannelVideos(channels, channelSort, prompt, observation) : [];
  const videos = await blendVideosWithRecommendations(
    [...searchVideosForQueries, ...channelVideos],
    prompt,
    observation
  );

  return {
    queries,
    videos,
    searchVideos: searchVideosForQueries.length,
    channelVideos: channelVideos.length
  };
}

