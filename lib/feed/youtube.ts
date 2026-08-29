import { getGretelConfig } from "./config";
import { getChannelId, getChannelIdFromInput, getChannelVideoItems } from "./channel-utils";
import { observeOperation } from "./observation";
import type { ChannelSort, FeedObservation, FeedVideo } from "./types";
import { getYoutubeClient } from "./youtube-client";
import { normalizeChannelKey } from "../profile-store";
import { errorFields, logWarn } from "../logger";
import {
  getAuthor,
  getAuthorAvatarUrl,
  getAuthorChannelId,
  getChannelAvatarUrl,
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
import { rememberChannelAvatar, resolveMissingChannelAvatars } from "./channel-avatar-cache";

export async function searchVideos(
  queries: string[],
  observation: FeedObservation,
  profileId: string,
  maxVideos = getGretelConfig().feed.maxVideos
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
        Math.ceil(maxVideos / queries.length)
      );

      const searchResults = await Promise.all(
        queries.map(async (query) => {
          try {
            const results = await youtube.search(query, { type: "video" });
            return { query, results, error: null };
          } catch (error) {
            return { query, results: { results: [] }, error };
          }
        })
      );

      for (const { query, results } of searchResults) {
        const queryVideos: FeedVideo[] = [];
        const sourceVideos = getSearchVideoItems(results);
        const fetchedVideos = sourceVideos.length;

        for (const video of sourceVideos) {
          const id = getVideoId(video);
          const duration = getDuration(video);
          const title = getTitle(video);

          if (!titleMatchesQuery(title, query) || !shouldKeepVideo(id, seen)) {
            continue;
          }

          seen.add(id);
          const author = getAuthor(video);
          const channelId = getAuthorChannelId(video);
          queryVideos.push({
            id,
            title,
            author,
            channelAvatarUrl: getAuthorAvatarUrl(video),
            duration,
            query,
            thumbnailUrl: getThumbnailUrl(video) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            thumbnailCacheUrl: `/api/thumbnails/${profileId}/${id}`,
            publishedText: getPublishedText(video),
            publishedAt: getPublishedAt(video),
            viewCount: getViewCount(video),
            channelKey: normalizeChannelKey(author),
            channelId
          });

          if (queryVideos.length >= perQueryLimit) {
            break;
          }
        }

        videosByQuery.push(queryVideos);
        observation.operations.push({
          name: "feed.phase1.tag_filter",
          durationMs: 0,
          status: "ok",
          input: { query, fetchedVideos },
          output: {
            keptVideos: queryVideos.length,
            filteredVideos: fetchedVideos - queryVideos.length
          }
        });
      }

      const mixed = mixVideoBuckets(videosByQuery, maxVideos);
      const videos = await resolveMissingChannelAvatars(mixed, async (channelId) => {
        const channel = await youtube.getChannel(channelId);
        return getChannelAvatarUrl(channel);
      });

      return {
        value: videos,
        output: {
          keptVideos: videosByQuery.reduce((total, videos) => total + videos.length, 0),
          integratedVideos: mixed.length
        }
      };
    }
  );
}

function getSearchVideoItems(results: { videos?: unknown[]; results?: unknown[] }) {
  if (Array.isArray(results.results)) {
    return results.results.filter(
      (item) => item && typeof item === "object" && "type" in item && item.type === "Video"
    );
  }

  return Array.isArray(results.videos) ? results.videos : [];
}

function titleMatchesQuery(title: string, query: string) {
  return title.toLowerCase().includes(query.toLowerCase());
}

export async function fetchChannelVideos(
  channels: string[],
  sort: ChannelSort,
  observation: FeedObservation,
  profileId: string,
  maxVideos = getGretelConfig().feed.maxVideos
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
        Math.ceil(maxVideos / channels.length)
      );

      const channelResults = await Promise.all(
        channels.map(async (channelName) => {
          const channelId = await resolveChannelId(channelName, observation, profileId);
          const channelKey = normalizeChannelKey(channelName);

          if (!channelId) {
            return {
              channelName,
              channelId: null,
              channelKey,
              sourceVideos: [],
              channelAvatarUrl: undefined,
              channelNameFromPayload: undefined,
              error: null
            };
          }

          try {
            const channel = await youtube.getChannel(channelId);
            const channelAvatarUrl = getChannelAvatarUrl(channel);
            const channelNameFromPayload = getChannelName(channel);
            const latestChannelVideos = await channel.getVideos();
            const sourceVideos = getChannelVideoItems(latestChannelVideos);

            return {
              channelName,
              channelId,
              channelKey,
              sourceVideos,
              channelAvatarUrl,
              channelNameFromPayload,
              error: null
            };
          } catch (error) {
            logWarn("youtube.channel_fetch_failed", {
              requestId: observation.requestId,
              channel: channelName,
              sort,
              ...errorFields(error)
            });
            return {
              channelName,
              channelId,
              channelKey,
              sourceVideos: [],
              channelAvatarUrl: undefined,
              channelNameFromPayload: undefined,
              error
            };
          }
        })
      );

      for (const {
        channelName,
        channelId,
        channelKey,
        sourceVideos,
        channelAvatarUrl,
        channelNameFromPayload
      } of channelResults) {
        if (!channelId) {
          videosByChannel.push([]);
          continue;
        }

        rememberChannelAvatar(channelKey, channelAvatarUrl || undefined);
        rememberChannelAvatar(channelId, channelAvatarUrl);
        rememberChannelAvatar(channelNameFromPayload || undefined, channelAvatarUrl || undefined);

        const channelVideos: FeedVideo[] = [];

        for (const video of sourceVideos) {
          const id = getVideoId(video);
          const duration = getDuration(video);

          if (!shouldKeepVideo(id, seen)) {
            continue;
          }

          seen.add(id);
          const author = getChannelVideoAuthor(video, channelName);
          const authorChannelKey = normalizeChannelKey(author) || channelKey;
          const authorAvatarUrl = getAuthorAvatarUrl(video) || channelAvatarUrl || undefined;
          rememberChannelAvatar(authorChannelKey, authorAvatarUrl);
          channelVideos.push({
            id,
            title: getTitle(video),
            author,
            channelAvatarUrl: authorAvatarUrl,
            duration,
            query: channelName,
            thumbnailUrl: getThumbnailUrl(video) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            thumbnailCacheUrl: `/api/thumbnails/${profileId}/${id}`,
            publishedText: getPublishedText(video),
            publishedAt: getPublishedAt(video),
            viewCount: getViewCount(video),
            channelKey: authorChannelKey,
            channelId: getAuthorChannelId(video) || channelId
          });

          if (channelVideos.length >= perChannelLimit) {
            break;
          }
        }

        videosByChannel.push(channelVideos);
        observation.operations.push({
          name: "feed.phase1.channel_fetch",
          durationMs: 0,
          status: "ok",
          input: { channel: channelName, fetchedVideos: sourceVideos.length },
          output: {
            keptVideos: channelVideos.length,
            filteredVideos: sourceVideos.length - channelVideos.length
          }
        });
      }

      const mixed = mixVideoBuckets(videosByChannel, maxVideos);

      return {
        value: mixed,
        output: {
          keptVideos: videosByChannel.reduce((total, videos) => total + videos.length, 0),
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
