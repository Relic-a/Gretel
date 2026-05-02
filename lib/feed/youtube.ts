import { getGretelConfig } from "./config";
import { applyChannelSort, getChannelId, getChannelIdFromInput, getChannelVideoItems } from "./channel-utils";
import { observeOperation } from "./observation";
import type { ChannelSort, FeedObservation, FeedVideo } from "./types";
import { getYoutubeClient } from "./youtube-client";
import { normalizeChannelKey } from "../profile-store";
import {
  getAuthor,
  getChannelVideoAuthor,
  getDuration,
  getVideoId,
  getViewCount,
  mixVideoBuckets,
  promptAvoidsShorts,
  shouldKeepVideo,
  getTitle
} from "./video-utils";

export async function searchVideos(
  queries: string[],
  prompt: string,
  observation: FeedObservation,
  profileId: string
) {
  return observeOperation(
    observation,
    "youtube.search",
    { queries: queries.length },
    async () => {
      const youtube = await getYoutubeClient(profileId);
      const seen = new Set<string>();
      const videosByQuery: FeedVideo[][] = [];
      const avoidShorts = promptAvoidsShorts(prompt);
      const config = getGretelConfig();
      const perQueryLimit = Math.max(
        config.feed.minVideosPerQuery,
        Math.ceil(config.feed.maxVideos / queries.length)
      );

      for (const query of queries) {
        const results = await youtube.search(query);
        const queryVideos: FeedVideo[] = [];

        for (const video of results.videos) {
          const id = getVideoId(video);
          const duration = getDuration(video);

          if (!shouldKeepVideo(id, duration, seen, avoidShorts)) {
            continue;
          }

          seen.add(id);
          const author = getAuthor(video);
          queryVideos.push({
            id,
            title: getTitle(video),
            author,
            duration,
            query,
            channelKey: normalizeChannelKey(author)
          });

          if (queryVideos.length >= perQueryLimit) {
            break;
          }
        }

        videosByQuery.push(queryVideos);
      }

      const mixed = mixVideoBuckets(videosByQuery);

      return {
        value: mixed,
        output: {
          rawVideos: videosByQuery.reduce((total, videos) => total + videos.length, 0),
          integratedVideos: mixed.length
        }
      };
    }
  );
}

export async function fetchChannelVideos(
  channels: string[],
  sort: ChannelSort,
  prompt: string,
  observation: FeedObservation,
  profileId: string
) {
  return observeOperation(
    observation,
    "youtube.channel_videos",
    { channels: channels.length, sort },
    async () => {
      const youtube = await getYoutubeClient(profileId);
      const seen = new Set<string>();
      const videosByChannel: FeedVideo[][] = [];
      const avoidShorts = promptAvoidsShorts(prompt);
      const config = getGretelConfig();
      const perChannelLimit = Math.max(
        config.feed.minVideosPerChannel,
        Math.ceil(config.feed.maxVideos / channels.length)
      );

      for (const channelName of channels) {
        const channelId = await resolveChannelId(channelName, observation, profileId);
        const channelKey = normalizeChannelKey(channelName);

        if (!channelId) {
          videosByChannel.push([]);
          continue;
        }

        try {
          const channel = await youtube.getChannel(channelId);
          const latestChannelVideos = await channel.getVideos();
          const fallbackVideos = getChannelVideoItems(latestChannelVideos);
          const sortedChannelVideos = await applyChannelSort(latestChannelVideos, sort, youtube);
          const sortedVideos = getChannelVideoItems(sortedChannelVideos);
          const videosToRead = sortedVideos.length > 0 ? sortedVideos : fallbackVideos;
          const sourceVideos =
            sort === "popular"
              ? [...videosToRead].sort((a, b) => getViewCount(b) - getViewCount(a))
              : videosToRead;

          const channelVideos: FeedVideo[] = [];

          for (const video of sourceVideos) {
            const id = getVideoId(video);
            const duration = getDuration(video);

            if (!shouldKeepVideo(id, duration, seen, avoidShorts)) {
              continue;
            }

            seen.add(id);
            const author = getChannelVideoAuthor(video, channelName);
            channelVideos.push({
              id,
              title: getTitle(video),
              author,
              duration,
              query: `${channelName} · ${sort}`,
              channelKey
            });

            if (channelVideos.length >= perChannelLimit) {
              break;
            }
          }

          videosByChannel.push(channelVideos);
        } catch (error) {
          console.error(`YouTube channel fetch failed for "${channelName}":`, error);
          videosByChannel.push([]);
        }
      }

      const mixed = mixVideoBuckets(videosByChannel);

      return {
        value: mixed,
        output: {
          rawVideos: videosByChannel.reduce((total, videos) => total + videos.length, 0),
          integratedVideos: mixed.length
        }
      };
    }
  );
}

async function resolveChannelId(
  channelName: string,
  observation: FeedObservation,
  profileId: string
) {
  return observeOperation(
    observation,
    "youtube.resolve_channel",
    { channel: channelName },
    async () => {
      const directId = getChannelIdFromInput(channelName);

      if (directId) {
        return {
          value: directId,
          output: { resolved: true, direct: true }
        };
      }

      const youtube = await getYoutubeClient(profileId);
      const results = await youtube.search(channelName, { type: "channel" });
      const channel = results.channels[0];
      const channelId = getChannelId(channel);

      return {
        value: channelId,
        output: { resolved: Boolean(channelId), direct: false }
      };
    }
  );
}
