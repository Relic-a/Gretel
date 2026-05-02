import path from "node:path";

import { Innertube, UniversalCache } from "youtubei.js";

const youtubeClients = new Map<string, Promise<Innertube>>();

export function getYoutubeClient(profileId = "default") {
  const cacheKey = profileId || "default";
  const existingClient = youtubeClients.get(cacheKey);

  if (existingClient) {
    return existingClient;
  }

  const cacheDirectory = path.join(process.cwd(), "data", "youtube-sessions", cacheKey);
  const client = Innertube.create({
    cache: new UniversalCache(true, cacheDirectory),
    enable_session_cache: true
  });

  youtubeClients.set(cacheKey, client);
  return client;
}

export function forgetYoutubeClient(profileId: string) {
  youtubeClients.delete(profileId);
}
