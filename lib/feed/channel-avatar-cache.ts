import type { FeedVideo } from "./types";
import { normalizeChannelKey } from "../profile-store";

type AvatarCacheEntry = {
  avatarUrl: string;
  timestamp: number;
};

type NameAliasEntry = {
  channelId?: string;
  avatarUrl: string;
  timestamp: number;
};

type ChannelAvatarFetcher = (channelId: string) => Promise<string | undefined>;

const POSITIVE_AVATAR_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MISSING_AVATAR_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AVATAR_CACHE_ENTRIES = 2000;

export function rememberChannelAvatar(
  channelOrId: string | { channelId?: string; channelName?: string; channelKey?: string } | undefined,
  avatarUrl: string | undefined,
  options: { isPersisted?: boolean; channelName?: string } = {}
) {
  let channelId: string | undefined;
  let channelName: string | undefined = options.channelName;
  const url = cleanUrl(avatarUrl);

  if (typeof channelOrId === "string") {
    if (channelOrId.startsWith("UC") || /^[a-zA-Z0-9_-]{20,}$/.test(channelOrId)) {
      channelId = channelOrId;
    } else {
      channelName = channelOrId;
    }
  } else if (channelOrId && typeof channelOrId === "object") {
    channelId = channelOrId.channelId;
    channelName = channelOrId.channelName || channelOrId.channelKey;
  }

  if (!url) {
    return;
  }

  const now = Date.now();
  const normalizedId = normalizeKey(channelId);
  const normalizedName = normalizeKey(channelName);

  if (!normalizedId && !normalizedName) {
    return;
  }

  boundCacheSize();

  const idCache = getIdCache();
  const nameCache = getNameAliasCache();

  if (normalizedId) {
    const existingIdEntry = idCache.get(normalizedId);
    if (options.isPersisted && existingIdEntry && now - existingIdEntry.timestamp <= POSITIVE_AVATAR_TTL_MS) {
      // Keep existing fresh authoritative entry over persisted stale value
    } else {
      idCache.set(normalizedId, { avatarUrl: url, timestamp: now });
      getMissingCache().delete(normalizedId);
    }

    if (normalizedName) {
      const existingNameEntry = nameCache.get(normalizedName);
      // Only associate alias if unassigned, expired, or already points to this channelId
      if (
        !existingNameEntry ||
        existingNameEntry.channelId === normalizedId ||
        now - existingNameEntry.timestamp > POSITIVE_AVATAR_TTL_MS
      ) {
        nameCache.set(normalizedName, { channelId: normalizedId, avatarUrl: url, timestamp: now });
      }
    }
  } else if (normalizedName) {
    // Only name available (no ID): store as temporary name alias if no conflicting ID is bound
    const existingNameEntry = nameCache.get(normalizedName);
    if (
      !existingNameEntry ||
      !existingNameEntry.channelId ||
      now - existingNameEntry.timestamp > POSITIVE_AVATAR_TTL_MS
    ) {
      nameCache.set(normalizedName, { avatarUrl: url, timestamp: now });
    }
  }
}

export function getChannelAvatar(channelIdOrKey?: string, fallbackChannelName?: string): string | undefined {
  const now = Date.now();
  const primaryKey = normalizeKey(channelIdOrKey);
  const secondaryKey = normalizeKey(fallbackChannelName);
  const idCache = getIdCache();
  const nameCache = getNameAliasCache();

  // 1. Authoritative check: primaryKey in idCache
  if (primaryKey) {
    const idEntry = idCache.get(primaryKey);
    if (idEntry) {
      if (now - idEntry.timestamp <= POSITIVE_AVATAR_TTL_MS) {
        return idEntry.avatarUrl;
      }
      idCache.delete(primaryKey);
    }
  }

  // 2. Check primaryKey in nameAliasCache (when called with channelName as first argument)
  if (primaryKey) {
    const nameEntry = nameCache.get(primaryKey);
    if (nameEntry) {
      if (now - nameEntry.timestamp <= POSITIVE_AVATAR_TTL_MS) {
        return nameEntry.avatarUrl;
      }
      nameCache.delete(primaryKey);
    }
  }

  // 3. Fallback check: secondaryKey in nameAliasCache
  if (secondaryKey) {
    const nameEntry = nameCache.get(secondaryKey);
    if (nameEntry) {
      if (now - nameEntry.timestamp <= POSITIVE_AVATAR_TTL_MS) {
        if (primaryKey && nameEntry.channelId && nameEntry.channelId !== primaryKey) {
          return undefined;
        }
        return nameEntry.avatarUrl;
      }
      nameCache.delete(secondaryKey);
    }
  }

  return undefined;
}

export function hydrateChannelAvatar(video: FeedVideo): FeedVideo {
  const channelId = video.channelId;
  const channelKey = video.channelKey || video.author;

  // 1. Authoritative channelId cache lookup
  const cachedForId = channelId ? getChannelAvatar(channelId) : undefined;
  if (cachedForId) {
    return {
      ...video,
      channelAvatarUrl: cachedForId
    };
  }

  // 2. If video has an existing avatarUrl (e.g. from persisted state or fresh API response)
  const currentUrl = cleanUrl(video.channelAvatarUrl);
  if (currentUrl) {
    rememberChannelAvatar(
      { channelId, channelKey },
      currentUrl,
      { isPersisted: true }
    );
    return video;
  }

  // 3. Fallback channel name alias lookup
  const cachedForName = channelKey ? getChannelAvatar(undefined, channelKey) : undefined;
  if (cachedForName) {
    return {
      ...video,
      channelAvatarUrl: cachedForName
    };
  }

  return video;
}

export function hydrateChannelAvatars(videos: FeedVideo[]): FeedVideo[] {
  return videos.map((video) => hydrateChannelAvatar(video));
}

export function backfillChannelAvatarsWithinVideos(videos: FeedVideo[]): FeedVideo[] {
  for (const video of videos) {
    const avatarUrl = cleanUrl(video.channelAvatarUrl);
    if (avatarUrl) {
      rememberChannelAvatar(
        { channelId: video.channelId, channelKey: video.channelKey || video.author },
        avatarUrl,
        { isPersisted: true }
      );
    }
  }

  return videos.map((video) => hydrateChannelAvatar(video));
}

export async function resolveMissingChannelAvatars(
  videos: FeedVideo[],
  fetchAvatar: ChannelAvatarFetcher
): Promise<FeedVideo[]> {
  const hydratedVideos = backfillChannelAvatarsWithinVideos(videos);
  const channelsToFetch = new Map<string, { channelId: string; aliases: Set<string> }>();

  for (const video of hydratedVideos) {
    if (cleanUrl(video.channelAvatarUrl) || !video.channelId) {
      continue;
    }

    const channelId = normalizeKey(video.channelId);
    if (!channelId) {
      continue;
    }

    if (getChannelAvatar(video.channelId)) {
      continue;
    }

    const existing = channelsToFetch.get(channelId) || {
      channelId: video.channelId,
      aliases: new Set<string>()
    };
    if (video.channelKey) existing.aliases.add(video.channelKey);
    if (video.author) existing.aliases.add(video.author);
    channelsToFetch.set(channelId, existing);
  }

  const pendingChannels = [...channelsToFetch.values()];

  if (pendingChannels.length > 0) {
    for (let index = 0; index < pendingChannels.length; index += 16) {
      await Promise.all(
        pendingChannels.slice(index, index + 16).map(async ({ channelId, aliases }) => {
          const avatarUrl = await getOrFetchChannelAvatar(channelId, fetchAvatar);
          if (avatarUrl) {
            rememberChannelAvatar(channelId, avatarUrl);
            for (const alias of aliases) {
              rememberChannelAvatar({ channelId, channelName: alias }, avatarUrl);
            }
          }
        })
      );
    }
  }

  return hydrateChannelAvatars(hydratedVideos);
}

async function getOrFetchChannelAvatar(
  channelId: string,
  fetchAvatar: ChannelAvatarFetcher
): Promise<string | undefined> {
  const cachedAvatar = getChannelAvatar(channelId);
  if (cachedAvatar) {
    return cachedAvatar;
  }

  const normalizedId = normalizeKey(channelId);
  if (!normalizedId) {
    return undefined;
  }

  const missingUntil = getMissingCache().get(normalizedId) || 0;
  if (missingUntil > Date.now()) {
    return undefined;
  }

  const inFlightCache = getInFlightCache();
  const existingRequest = inFlightCache.get(normalizedId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = fetchAvatar(channelId)
    .then((avatarUrl) => {
      const cleaned = cleanUrl(avatarUrl);
      if (cleaned) {
        rememberChannelAvatar(channelId, cleaned);
        getMissingCache().delete(normalizedId);
        return cleaned;
      }
      getMissingCache().set(normalizedId, Date.now() + MISSING_AVATAR_TTL_MS);
      return undefined;
    })
    .catch(() => {
      getMissingCache().set(normalizedId, Date.now() + MISSING_AVATAR_TTL_MS);
      return undefined;
    })
    .finally(() => {
      inFlightCache.delete(normalizedId);
    });

  inFlightCache.set(normalizedId, request);
  return request;
}

function boundCacheSize() {
  const idCache = getIdCache();
  if (idCache.size > MAX_AVATAR_CACHE_ENTRIES) {
    const entries = [...idCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = Math.floor(MAX_AVATAR_CACHE_ENTRIES * 0.2);
    for (let i = 0; i < toDelete; i++) {
      idCache.delete(entries[i][0]);
    }
  }

  const nameCache = getNameAliasCache();
  if (nameCache.size > MAX_AVATAR_CACHE_ENTRIES) {
    const entries = [...nameCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = Math.floor(MAX_AVATAR_CACHE_ENTRIES * 0.2);
    for (let i = 0; i < toDelete; i++) {
      nameCache.delete(entries[i][0]);
    }
  }
}

function getIdCache(): Map<string, AvatarCacheEntry> {
  const globalKey = "__gretelChannelIdAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, AvatarCacheEntry>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, AvatarCacheEntry>();
  }

  return globalScope[globalKey];
}

function getNameAliasCache(): Map<string, NameAliasEntry> {
  const globalKey = "__gretelChannelNameAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, NameAliasEntry>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, NameAliasEntry>();
  }

  return globalScope[globalKey];
}

function getInFlightCache(): Map<string, Promise<string | undefined>> {
  const globalKey = "__gretelInFlightChannelAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, Promise<string | undefined>>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, Promise<string | undefined>>();
  }

  return globalScope[globalKey];
}

function getMissingCache(): Map<string, number> {
  const globalKey = "__gretelMissingChannelAvatarCache";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, number>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, number>();
  }

  return globalScope[globalKey];
}

function normalizeKey(value: string | undefined): string {
  return value ? normalizeChannelKey(value) : "";
}

function cleanUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return trimmed.length > 0 ? trimmed : "";
}

export function clearChannelAvatarCache() {
  getIdCache().clear();
  getNameAliasCache().clear();
  getInFlightCache().clear();
  getMissingCache().clear();
}
