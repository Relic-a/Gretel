import path from "node:path";

import { Innertube, UniversalCache } from "youtubei.js";
import { getDataDir } from "../data-dir";
import { getGretelConfig } from "./config";

const youtubeClients = new Map<string, Promise<Innertube>>();
const maxCachedClients = 10;

export function getYoutubeClient(profileId: string) {
  if (!profileId) {
    throw new Error("A profile id is required for YouTube sessions.");
  }

  const profileKey = profileId;
  const { language } = getGretelConfig().youtube;
  const cacheKey = `${profileKey}:${language}`;
  const existingClient = youtubeClients.get(cacheKey);

  if (existingClient) {
    youtubeClients.delete(cacheKey);
    youtubeClients.set(cacheKey, existingClient);
    return existingClient;
  }

  const cacheDirectory = path.join(
    getDataDir(),
    "youtube-sessions",
    profileKey,
    language.replace(/[^a-z0-9._-]/gi, "_")
  );
  const client = Innertube.create({
    cache: new UniversalCache(true, cacheDirectory),
    enable_session_cache: true,
    lang: language
  });

  while (youtubeClients.size >= maxCachedClients) {
    const oldestKey = youtubeClients.keys().next().value as string | undefined;

    if (!oldestKey) {
      break;
    }

    youtubeClients.delete(oldestKey);
  }

  youtubeClients.set(cacheKey, client);
  return client;
}

export function forgetYoutubeClient(profileId: string) {
  for (const cacheKey of youtubeClients.keys()) {
    if (cacheKey.startsWith(`${profileId}:`)) {
      youtubeClients.delete(cacheKey);
    }
  }
}
