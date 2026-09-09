import type { FeedVideo } from "../../../lib/feed/types";
import {
  advancePlaybackQueue,
  clearPlaybackQueue,
  enqueueQueueVideos,
  getPlaybackQueue,
  handlePlaybackQueueEnded,
  removeQueueVideo,
  reorderQueueVideo,
  setQueueAutoplay,
  setQueueCurrentVideo
} from "../../../lib/queue-store";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";
    return Response.json(getPlaybackQueue(profileId));
  } catch (error) {
    return queueError(error, "Could not load the playback queue.");
  }
}

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!profileId) {
      return Response.json({ error: "Select a profile first." }, { status: 400 });
    }

    switch (action) {
      case "enqueue": {
        const candidates = Array.isArray(body.videos) ? body.videos : [body.video];
        const videos = candidates.flatMap((value: unknown) => {
          const video = parseQueueVideo(value);
          return video ? [video] : [];
        });
        if (videos.length === 0) {
          return Response.json({ error: "Choose at least one video to queue." }, { status: 400 });
        }
        return Response.json(enqueueQueueVideos(profileId, videos));
      }
      case "remove": {
        const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
        if (!videoId) return Response.json({ error: "Choose a queued video to remove." }, { status: 400 });
        return Response.json(removeQueueVideo(profileId, videoId));
      }
      case "reorder": {
        const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
        const toIndex = Number(body.toIndex);
        if (!videoId || !Number.isInteger(toIndex)) {
          return Response.json({ error: "Provide a queued video and destination index." }, { status: 400 });
        }
        return Response.json(reorderQueueVideo(profileId, videoId, toIndex));
      }
      case "clear":
        return Response.json(clearPlaybackQueue(profileId));
      case "current": {
        const videoId = body.videoId === null ? null : typeof body.videoId === "string" ? body.videoId : "";
        if (videoId === "") return Response.json({ error: "Choose a current video." }, { status: 400 });
        return Response.json(setQueueCurrentVideo(profileId, videoId));
      }
      case "autoplay":
        if (typeof body.enabled !== "boolean") {
          return Response.json({ error: "Autoplay enabled must be a boolean." }, { status: 400 });
        }
        return Response.json(setQueueAutoplay(profileId, body.enabled));
      case "next": {
        const transition = advancePlaybackQueue(profileId);
        return Response.json({ ...transition, transition: transition.kind });
      }
      case "ended": {
        const transition = handlePlaybackQueueEnded(profileId);
        return Response.json({ ...transition, transition: transition.kind });
      }
      default:
        return Response.json({ error: "Unknown queue action." }, { status: 400 });
    }
  } catch (error) {
    return queueError(error, "Could not update the playback queue.");
  }
}

function parseQueueVideo(value: unknown): FeedVideo | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !input.id.trim()) return null;

  return {
    ...input,
    id: input.id.trim(),
    title: typeof input.title === "string" ? input.title : "Queued video",
    author: typeof input.author === "string" ? input.author : "Unknown channel",
    duration: typeof input.duration === "string" ? input.duration : "",
    query: typeof input.query === "string" ? input.query : "Queue"
  } as FeedVideo;
}

function queueError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Profile not found.") {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }
  return Response.json({ error: fallback }, { status: 500 });
}
