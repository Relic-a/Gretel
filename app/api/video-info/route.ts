import { normalizeChannelKey } from "../../../lib/profile-store";
import { getYoutubeClient } from "../../../lib/feed/youtube-client";
import {
  getAuthor,
  getAuthorAvatarUrl,
  getAuthorChannelId,
  getChannelAvatarUrl,
  getDuration,
  getPublishedAt,
  getPublishedText,
  getThumbnailUrl,
  getTitle,
  getViewCount
} from "../../../lib/feed/video-utils";
import { resolveMissingChannelAvatars } from "../../../lib/feed/channel-avatar-cache";
import type { FeedVideo } from "../../../lib/feed/types";
import { errorFields, logError, requestFields } from "../../../lib/logger";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const thumbnailUrl = getThumbnailUrl(source, videoId);

    const channelId = getAuthorChannelId(source);
    const [video]: FeedVideo[] = await resolveMissingChannelAvatars([{
      id: videoId,
      title: getTitle(source),
      author,
      duration,
      query: "Watch",
      channelAvatarUrl: getAuthorAvatarUrl(source),
      thumbnailUrl,
      thumbnailCacheUrl: `/api/thumbnails/${videoId}`,
      publishedText: getPublishedText(source),
      publishedAt: getPublishedAt(source),
      viewCount: getViewCount(source),
      channelKey: normalizeChannelKey(author),
      channelId
    }], async (missingChannelId) => getChannelAvatarUrl(await youtube.getChannel(missingChannelId)));

    return Response.json({ video });
  } catch (error) {
    logError("video_info.failed", requestFields(request, {
      videoId,
      profileId,
      ...errorFields(error, { stack: true })
    }));
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
