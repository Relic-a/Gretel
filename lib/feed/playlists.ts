import { getCentroid, getTopicCentroids } from "./algorithm-store";
import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { getYoutubeClient } from "./youtube-client";
import type { FeedVideo } from "./types";
import {
  getAuthor, getAuthorChannelId, getDuration, getPlaylistVideoCount, getPublishedAt,
  getPublishedText, getThumbnailUrl, getTitle, getVideoId, getViewCount
} from "./video-utils";
import { cosineSimilarity } from "./vector-math";
import { normalizeChannelKey } from "../profile-store";
import { rememberPlaylistVideoEligibility } from "./playlist-store";

const PLAYLIST_SAMPLE_SIZE = 6;

export function toPlaylistCard(value: unknown, query: string, position = 0): FeedVideo {
  const source = value as Record<string, unknown>;
  const id = String(source.content_id || source.playlist_id || source.id || "");
  return {
    itemType: "playlist",
    id,
    playlistId: id,
    title: getTitle(value).replace(/Untitled video$/, "Untitled playlist"),
    author: getAuthor(value),
    duration: "",
    query,
    thumbnailUrl: getThumbnailUrl(value),
    playlistVideoCount: getPlaylistVideoCount(value),
    playlistPosition: position,
    channelKey: normalizeChannelKey(getAuthor(value)),
    channelId: getAuthorChannelId(value)
  };
}

export async function fetchPlaylistVideos(profileId: string, playlistId: string, maxPages = Number.POSITIVE_INFINITY) {
  const youtube = await getYoutubeClient(profileId);
  let page: unknown = await youtube.getPlaylist(playlistId);
  const rawItems: unknown[] = [];
  const seen = new Set<string>();
  let pages = 0;
  for (;;) {
    rawItems.push(...getPlaylistPageItems(page));
    pages += 1;
    if (pages >= maxPages) break;
    const source = page as Record<string, unknown>;
    if (source.has_continuation && typeof source.getContinuation === "function") {
      page = await (source.getContinuation as () => Promise<unknown>)();
      continue;
    }
    const continuation = getMemo(page)?.get("ContinuationItemView")?.[0] as
      | { endpoint?: { call?: (actions: unknown, options: unknown) => Promise<unknown> } }
      | undefined;
    const actions = source.actions;
    if (!continuation?.endpoint?.call || !actions) break;
    page = await continuation.endpoint.call(actions, { parse: true });
  }
  return rawItems.flatMap((item, index) => {
    const id = getVideoId(item);
    if (!id || id.startsWith("PL") || seen.has(id)) return [];
    seen.add(id);
    const author = getAuthor(item);
    return [{
      itemType: "video" as const,
      id,
      title: getTitle(item),
      author,
      duration: getDuration(item),
      query: `Playlist: ${playlistId}`,
      thumbnailUrl: getThumbnailUrl(item, id),
      thumbnailCacheUrl: `/api/thumbnails/${id}`,
      publishedText: getPublishedText(item),
      publishedAt: getPublishedAt(item),
      viewCount: getViewCount(item),
      channelKey: normalizeChannelKey(author),
      channelId: getAuthorChannelId(item),
      playlistId,
      playlistPosition: index
    } satisfies FeedVideo];
  });
}

function getPlaylistPageItems(page: unknown): unknown[] {
  if (!page || typeof page !== "object") return [];
  const source = page as Record<string, unknown>;
  if (Array.isArray(source.items) && source.items.length > 0) return source.items;
  return (getMemo(page)?.get("LockupView") || []).filter((item: unknown) =>
    item && typeof item === "object" && (item as Record<string, unknown>).content_type === "VIDEO"
  );
}

function getMemo(page: unknown): Map<string, unknown[]> | undefined {
  if (!page || typeof page !== "object") return undefined;
  const source = page as Record<string, unknown>;
  const memo = source.memo || source.on_response_received_actions_memo;
  return memo instanceof Map ? memo as Map<string, unknown[]> : undefined;
}

export function samplePlaylistVideos(videos: FeedVideo[], size = PLAYLIST_SAMPLE_SIZE) {
  if (videos.length <= size) return videos;
  return Array.from({ length: size }, (_, index) =>
    videos[Math.round(index * (videos.length - 1) / (size - 1))]
  );
}

async function scoreVideos(profileId: string, poolKey: string, videos: FeedVideo[]) {
  const config = getGretelConfig();
  const topics = getTopicCentroids(profileId, poolKey);
  const legacy = getCentroid(profileId, poolKey)?.current || [];
  const centroids = topics.length > 0 ? topics.map((topic) => topic.current) : legacy.length ? [legacy] : [];
  if (centroids.length === 0) return videos.map((video) => ({ ...video, similarityScore: 1, centroidEligible: true }));
  const vectors = await getEmbeddingProvider(config).embedTexts(videos.map(createEmbeddingInput));
  return videos.map((video, index) => {
    const vector = vectors[index] || [];
    const similarityScore = Math.max(0, ...centroids.map((centroid) => cosineSimilarity(vector, centroid)));
    return { ...video, similarityScore, centroidEligible: similarityScore >= config.feed.similarityThreshold };
  });
}

export async function evaluatePlaylist(profileId: string, poolKey: string, playlist: FeedVideo) {
  // One page is enough to make an admission decision; opening the playlist fetches all pages.
  const videos = await fetchPlaylistVideos(profileId, playlist.id, 1);
  const sample = await scoreVideos(profileId, poolKey, samplePlaylistVideos(videos));
  const passing = sample.filter((video) => video.centroidEligible).length;
  const admitted = sample.length > 0 && passing / sample.length > 0.5;
  const similarityScore = sample.length
    ? sample.reduce((sum, video) => sum + (video.similarityScore || 0), 0) / sample.length
    : 0;
  rememberPlaylistVideoEligibility(profileId, playlist.id, sample);
  return {
    admitted,
    playlist: { ...playlist, similarityScore, playlistVideoCount: playlist.playlistVideoCount || videos.length },
    sampledVideos: sample.length,
    passingVideos: passing
  };
}

export async function getPlaylistDetails(profileId: string, poolKey: string, playlistId: string) {
  const videos = await scoreVideos(profileId, poolKey, await fetchPlaylistVideos(profileId, playlistId));
  rememberPlaylistVideoEligibility(profileId, playlistId, videos);
  return { playlistId, videos, autoplayVideoIds: videos.map((video) => video.id) };
}
