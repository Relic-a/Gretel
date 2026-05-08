import { normalizeChannelKey } from "../../../lib/profile-store";
import { getYoutubeClient } from "../../../lib/feed/youtube-client";
import {
  getAuthor,
  getAuthorAvatarUrl,
  getDuration,
  getPublishedAt,
  getPublishedText,
  getThumbnailUrl,
  getTitle,
  getViewCount
} from "../../../lib/feed/video-utils";
import { hydrateChannelAvatar } from "../../../lib/feed/channel-avatar-cache";
import type { FeedVideo } from "../../../lib/feed/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId") || "";
  const profileId = searchParams.get("profileId") || "";

  if (!videoId || !profileId) {
    return Response.json({ error: "Missing videoId or profileId." }, { status: 400 });
  }

  try {
    const youtube = await getYoutubeClient(profileId);
    const info = await youtube.getInfo(videoId);
    const source = pickSourceNode(info, videoId);
    const author = getAuthor(source);
    const duration = getDuration(source) || durationFromNode(source) || durationFromInfo(info);
    const thumbnailUrl = getThumbnailUrl(source) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const video: FeedVideo = hydrateChannelAvatar({
      id: videoId,
      title: getTitle(source),
      author,
      duration,
      query: "Watch",
      channelAvatarUrl: getAuthorAvatarUrl(source),
      thumbnailUrl,
      thumbnailCacheUrl: `/api/thumbnails/${profileId}/${videoId}`,
      publishedText: getPublishedText(source),
      publishedAt: getPublishedAt(source),
      viewCount: getViewCount(source),
      channelKey: normalizeChannelKey(author)
    });

    return Response.json({ video });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not fetch video info." },
      { status: 500 }
    );
  }
}

function pickSourceNode(info: unknown, videoId: string) {
  if (!info || typeof info !== "object") {
    return { id: videoId };
  }

  const value = info as Record<string, unknown>;

  if (value.basic_info && typeof value.basic_info === "object") {
    return value.basic_info;
  }

  if (value.primary_info && typeof value.primary_info === "object") {
    return value.primary_info;
  }

  if (Array.isArray(value.watch_next_feed) && value.watch_next_feed.length > 0) {
    const matching = value.watch_next_feed.find(
      (item) => item && typeof item === "object" && "id" in item && String((item as Record<string, unknown>).id) === videoId
    );
    return matching || value.watch_next_feed[0];
  }

  return info;
}

function durationFromInfo(info: unknown) {
  if (!info || typeof info !== "object") {
    return "";
  }

  const value = info as Record<string, unknown>;
  const basic = value.basic_info && typeof value.basic_info === "object"
    ? value.basic_info as Record<string, unknown>
    : null;
  const secondsValue = basic?.duration_seconds;
  const seconds = typeof secondsValue === "number" ? secondsValue : Number(secondsValue);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  return secondsToDuration(seconds);
}

function durationFromNode(node: unknown) {
  if (!node || typeof node !== "object") {
    return "";
  }

  return durationFromRecord(node as Record<string, unknown>);
}

function durationFromRecord(value: Record<string, unknown>) {
  const candidates = [
    value.duration_seconds,
    value.durationSeconds,
    value.length_seconds,
    value.lengthSeconds
  ];

  for (const candidate of candidates) {
    const seconds = typeof candidate === "number" ? candidate : Number(candidate);

    if (Number.isFinite(seconds) && seconds > 0) {
      return secondsToDuration(seconds);
    }
  }

  return "";
}

function secondsToDuration(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
