import type { FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";

type ChannelAvatarCache = Map<string, string>;
type ChannelAvatarFetcher = (channelId: string) => Promise<string | undefined>;

const missingAvatarTtlMs = 5 * 60 * 1000;

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
    rememberChannelAvatar(video.channelId, video.channelAvatarUrl);
    return video;
  }

  const cachedAvatar = getChannelAvatar(video.channelId) || getChannelAvatar(channelKey);

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
    const channelId = normalizeKey(video.channelId);
    const avatarUrl = cleanUrl(video.channelAvatarUrl);

    if (avatarUrl) {
      if (channelKey && !avatarByChannel.has(channelKey)) {
        avatarByChannel.set(channelKey, avatarUrl);
      }
      if (channelId && !avatarByChannel.has(channelId)) {
        avatarByChannel.set(channelId, avatarUrl);
      }
      rememberChannelAvatar(channelKey, avatarUrl);
      rememberChannelAvatar(channelId, avatarUrl);
    }
  }

  return videos.map((video) => {
    if (cleanUrl(video.channelAvatarUrl)) {
      return video;
    }

    const channelKey = normalizeKey(video.channelKey || video.author);
    const channelId = normalizeKey(video.channelId);
    const avatarUrl = (channelId ? avatarByChannel.get(channelId) || getChannelAvatar(channelId) : undefined) ||
      (channelKey ? avatarByChannel.get(channelKey) || getChannelAvatar(channelKey) : undefined);

    if (!avatarUrl) {
      return video;
    }

    return {
      ...video,
      channelAvatarUrl: avatarUrl
    };
  });
}

export async function resolveMissingChannelAvatars(
  videos: FeedVideo[],
  fetchAvatar: ChannelAvatarFetcher
) {
  const hydratedVideos = backfillChannelAvatarsWithinVideos(videos);
  const channels = new Map<string, { channelId: string; aliases: Set<string> }>();

  for (const video of hydratedVideos) {
    if (cleanUrl(video.channelAvatarUrl) || !video.channelId) {
      continue;
    }

    const channelId = normalizeKey(video.channelId);

    if (!channelId) {
      continue;
    }

    const existing = channels.get(channelId) || {
      channelId: video.channelId,
      aliases: new Set<string>()
    };
    existing.aliases.add(video.channelId);
    existing.aliases.add(video.channelKey || video.author);
    channels.set(channelId, existing);
  }

  const pendingChannels = [...channels.values()];

  for (let index = 0; index < pendingChannels.length; index += 4) {
    await Promise.all(pendingChannels.slice(index, index + 4).map(async ({ channelId, aliases }) => {
      const avatarUrl = await getOrFetchChannelAvatar(channelId, fetchAvatar);

      if (!avatarUrl) {
        return;
      }

      for (const alias of aliases) {
        rememberChannelAvatar(alias, avatarUrl);
      }
    }));
  }

  return hydrateChannelAvatars(hydratedVideos);
}

async function getOrFetchChannelAvatar(channelId: string, fetchAvatar: ChannelAvatarFetcher) {
  const cachedAvatar = getChannelAvatar(channelId);

  if (cachedAvatar) {
    return cachedAvatar;
  }

  const normalizedId = normalizeKey(channelId);
  const missingUntil = getGlobalMissingAvatarCache().get(normalizedId) || 0;

  if (missingUntil > Date.now()) {
    return undefined;
  }

  const inFlightCache = getGlobalInFlightAvatarCache();
  const existingRequest = inFlightCache.get(normalizedId);

  if (existingRequest) {
    return existingRequest;
  }

  const request = fetchAvatar(channelId)
    .then((avatarUrl) => {
      const cleanedAvatarUrl = cleanUrl(avatarUrl);

      if (cleanedAvatarUrl) {
        rememberChannelAvatar(channelId, cleanedAvatarUrl);
        getGlobalMissingAvatarCache().delete(normalizedId);
        return cleanedAvatarUrl;
      }

      getGlobalMissingAvatarCache().set(normalizedId, Date.now() + missingAvatarTtlMs);
      return undefined;
    })
    .catch(() => {
      getGlobalMissingAvatarCache().set(normalizedId, Date.now() + missingAvatarTtlMs);
      return undefined;
    })
    .finally(() => {
      inFlightCache.delete(normalizedId);
    });

  inFlightCache.set(normalizedId, request);
  return request;
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

function getGlobalInFlightAvatarCache() {
  const globalKey = "__gretelInFlightChannelAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, Promise<string | undefined>>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, Promise<string | undefined>>();
  }

  return globalScope[globalKey];
}

function getGlobalMissingAvatarCache() {
  const globalKey = "__gretelMissingChannelAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, number>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, number>();
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
