import type { FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";

type ChannelAvatarCache = Map<string, string>;

export function rememberChannelAvatar(channelKey: string | undefined, avatarUrl: string | undefined) {
  const normalizedKey = normalizeKey(channelKey);
  const cleanedAvatarUrl = cleanUrl(avatarUrl);

  if (!normalizedKey || !cleanedAvatarUrl) {
    return;
  }

  getGlobalChannelAvatarCache().set(normalizedKey, cleanedAvatarUrl);
}

export function getChannelAvatar(channelKey: string | undefined) {
  const normalizedKey = normalizeKey(channelKey);

  if (!normalizedKey) {
    return undefined;
  }

  return getGlobalChannelAvatarCache().get(normalizedKey);
}

export function hydrateChannelAvatar(video: FeedVideo) {
  const channelKey = video.channelKey || normalizeKey(video.author);

  if (video.channelAvatarUrl) {
    rememberChannelAvatar(channelKey, video.channelAvatarUrl);
    return video;
  }

  const cachedAvatar = getChannelAvatar(channelKey);

  if (!cachedAvatar) {
    return video;
  }

  return {
    ...video,
    channelAvatarUrl: cachedAvatar
  };
}

export function hydrateChannelAvatars(videos: FeedVideo[]) {
  return videos.map((video) => hydrateChannelAvatar(video));
}

export function backfillChannelAvatarsWithinVideos(videos: FeedVideo[]) {
  const avatarByChannel = new Map<string, string>();

  for (const video of videos) {
    const channelKey = normalizeKey(video.channelKey || video.author);
    const avatarUrl = cleanUrl(video.channelAvatarUrl);

    if (channelKey && avatarUrl && !avatarByChannel.has(channelKey)) {
      avatarByChannel.set(channelKey, avatarUrl);
      rememberChannelAvatar(channelKey, avatarUrl);
    }
  }

  return videos.map((video) => {
    if (cleanUrl(video.channelAvatarUrl)) {
      return video;
    }

    const channelKey = normalizeKey(video.channelKey || video.author);
    const avatarUrl = channelKey ? avatarByChannel.get(channelKey) || getChannelAvatar(channelKey) : undefined;

    if (!avatarUrl) {
      return video;
    }

    return {
      ...video,
      channelAvatarUrl: avatarUrl
    };
  });
}

function getGlobalChannelAvatarCache() {
  const globalKey = "__gretelChannelAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: ChannelAvatarCache;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, string>();
  }

  return globalScope[globalKey];
}

function normalizeKey(value: string | undefined) {
  return value ? normalizeChannelKey(value) : "";
}

function cleanUrl(value: string | undefined) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}
