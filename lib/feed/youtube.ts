import { getGretelConfig } from "./config";
import { applyChannelSort, getChannelId, getChannelIdFromInput, getChannelVideoItems } from "./channel-utils";
import { observeOperation } from "./observation";
import type { ChannelSort, FeedObservation, FeedVideo } from "./types";
import { getYoutubeClient } from "./youtube-client";
import { normalizeChannelKey } from "../profile-store";
import { errorFields, logWarn } from "../logger";
import {
  getAuthor,
  getChannelVideoAuthor,
  getDuration,
  getPublishedAt,
  getPublishedText,
  getThumbnailUrl,
  getVideoId,
  getViewCount,
  mixVideoBuckets,
  shouldKeepVideo,
  getText,
  getTitle
} from "./video-utils";

export async function searchVideos(
  queries: string[],
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

          if (!shouldKeepVideo(id, seen)) {
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
            thumbnailUrl: getThumbnailUrl(video) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            thumbnailCacheUrl: `/api/thumbnails/${profileId}/${id}`,
            publishedText: getPublishedText(video),
            publishedAt: getPublishedAt(video),
            viewCount: getViewCount(video),
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
          const latestVideos = getChannelVideoItems(latestChannelVideos);
          const popularPage = await applyChannelSort(latestChannelVideos, "popular", youtube);
          const popularVideos = getChannelVideoItems(popularPage);
          const sourceVideos = mixSubscriptionVideos(latestVideos, popularVideos);

          const channelVideos: FeedVideo[] = [];

          for (const video of sourceVideos) {
            const id = getVideoId(video);
            const duration = getDuration(video);

            if (!shouldKeepVideo(id, seen)) {
              continue;
            }

            seen.add(id);
            const author = getChannelVideoAuthor(video, channelName);
            channelVideos.push({
              id,
              title: getTitle(video),
              author,
              duration,
              query: channelName,
              thumbnailUrl: getThumbnailUrl(video) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              thumbnailCacheUrl: `/api/thumbnails/${profileId}/${id}`,
              publishedText: getPublishedText(video),
              publishedAt: getPublishedAt(video),
              viewCount: getViewCount(video),
              channelKey
            });

            if (channelVideos.length >= perChannelLimit) {
              break;
            }
          }

          videosByChannel.push(channelVideos);
        } catch (error) {
          logWarn("youtube.channel_fetch_failed", {
            requestId: observation.requestId,
            channel: channelName,
            sort,
            ...errorFields(error)
          });
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

export async function searchChannels(query: string, profileId: string) {
  const youtube = await getYoutubeClient(profileId);
  const results = await youtube.search(query, { type: "channel" });
  let channels = channelsFromSearchResults(results.channels);

  if (channels.length === 0) {
    const suggestions = await youtube.getSearchSuggestions(query);
    const suggestion = suggestions.find((item) => normalizeSearch(item) !== normalizeSearch(query));

    if (suggestion) {
      const suggestedResults = await youtube.search(suggestion, { type: "channel" });
      channels = channelsFromSearchResults(suggestedResults.channels);
    }
  }

  if (channels.length === 0) {
    const videoResults = await youtube.search(query);
    channels = channelsFromVideoResults(videoResults.videos || []);
  }

  return channels.slice(0, 8);
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
      let channelId = getChannelId(results.channels[0]);

      if (!channelId) {
        const suggestions = await youtube.getSearchSuggestions(channelName);
        const suggestion = suggestions.find((item) => normalizeSearch(item) !== normalizeSearch(channelName));

        if (suggestion) {
          const suggestedResults = await youtube.search(suggestion, { type: "channel" });
          channelId = getChannelId(suggestedResults.channels[0]);
        }
      }

      return {
        value: channelId,
        output: { resolved: Boolean(channelId), direct: false }
      };
    }
  );
}

function mixSubscriptionVideos(latestVideos: unknown[], popularVideos: unknown[]) {
  const config = getGretelConfig().feed.subscriptionMix;
  const latest = latestVideos;
  const popular = [...popularVideos].sort((a, b) => getViewCount(b) - getViewCount(a));
  const trending = latestVideos
    .slice(0, config.trendingLookbackVideos)
    .sort((a, b) => trendingScore(b) - trendingScore(a));

  return weightedRoundRobin([
    { videos: latest, weight: config.latest },
    { videos: trending, weight: config.trending },
    { videos: popular, weight: config.popular }
  ]);
}

function weightedRoundRobin(buckets: Array<{ videos: unknown[]; weight: number }>) {
  const output: unknown[] = [];
  const indexes = buckets.map(() => 0);
  const seen = new Set<string>();
  const totalWeight = buckets.reduce((total, bucket) => total + bucket.weight, 0) || 1;
  const quotas = buckets.map((bucket) => Math.max(1, Math.round((bucket.weight / totalWeight) * 10)));

  while (output.length < getGretelConfig().feed.maxVideos) {
    let added = false;

    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
      for (let count = 0; count < quotas[bucketIndex]; count += 1) {
        const videos = buckets[bucketIndex].videos;

        while (indexes[bucketIndex] < videos.length) {
          const video = videos[indexes[bucketIndex]];
          indexes[bucketIndex] += 1;
          const id = getVideoId(video);

          if (id && !seen.has(id)) {
            seen.add(id);
            output.push(video);
            added = true;
            break;
          }
        }
      }
    }

    if (!added) {
      break;
    }
  }

  return output;
}

function trendingScore(video: unknown) {
  const publishedAt = getPublishedAt(video);
  const ageDays = publishedAt > 0 ? Math.max(1, (Date.now() - publishedAt) / (24 * 60 * 60 * 1000)) : 30;

  return getViewCount(video) / ageDays;
}

function channelsFromSearchResults(channels: unknown[] = []) {
  return channels.flatMap((channel) => {
    const id = getChannelId(channel);
    const name = getChannelName(channel);

    if (!id || !name) {
      return [];
    }

    return [{
      id,
      name,
      thumbnailUrl: getThumbnailUrl(channel)
    }];
  });
}

function channelsFromVideoResults(videos: unknown[]) {
  const seen = new Set<string>();
  const channels: Array<{ id: string; name: string; thumbnailUrl: string }> = [];

  for (const video of videos) {
    const author = video && typeof video === "object" && "author" in video ? video.author : null;

    if (!author || typeof author !== "object") {
      continue;
    }

    const id = "id" in author ? getText(author.id) : "";
    const name = "name" in author ? getText(author.name) : "";

    if (!id || !name || seen.has(id)) {
      continue;
    }

    seen.add(id);
    channels.push({
      id,
      name,
      thumbnailUrl: getThumbnailUrl(author)
    });
  }

  return channels;
}

function normalizeSearch(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getChannelName(channel: unknown) {
  if (!channel || typeof channel !== "object") {
    return "";
  }

  if ("author" in channel && channel.author && typeof channel.author === "object" && "name" in channel.author) {
    return getText(channel.author.name);
  }

  if ("name" in channel) {
    return getText(channel.name);
  }

  if ("title" in channel) {
    return getTitle(channel);
  }

  return "";
}
