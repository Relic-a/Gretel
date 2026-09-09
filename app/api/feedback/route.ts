import {
  applyContentFeedback,
  getContentFeedback,
  getProfile,
  type ContentFeedbackInput
} from "../../../lib/profile-store";
import {
  parseFeedbackAction,
  toContentFeedbackSnapshot
} from "../../../lib/feed/feedback";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!getProfile(profileId)) {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }

  return Response.json({ feedback: toContentFeedbackSnapshot(getContentFeedback(profileId)) });
}

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
    const action = parseFeedbackAction(body.action);
    const video = body.video && typeof body.video === "object" ? body.video : null;
    const videoId = typeof body.videoId === "string"
      ? body.videoId
      : video && typeof video.id === "string"
        ? video.id
        : "";
    const channelId = typeof body.channelId === "string"
      ? body.channelId
      : video && typeof video.channelId === "string"
        ? video.channelId
        : "";
    const channelKey = typeof body.channelKey === "string"
      ? body.channelKey
      : video && typeof video.channelKey === "string"
        ? video.channelKey
        : "";
    const channelName = typeof body.channelName === "string"
      ? body.channelName
      : video && typeof video.author === "string"
        ? video.author
        : "";

    if (!profileId || !action) {
      return Response.json({ error: "Choose a valid feedback action." }, { status: 400 });
    }

    const input: ContentFeedbackInput = {
      action,
      ...(videoId ? { videoId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(channelKey ? { channelKey } : {}),
      ...(channelName ? { channelName } : {})
    };
    const saved = applyContentFeedback(profileId, input);

    if (!saved) {
      return Response.json({ error: "Choose a video or channel for feedback." }, { status: 400 });
    }

    return Response.json({ action, feedback: toContentFeedbackSnapshot(getContentFeedback(profileId)) });
  } catch {
    return Response.json({ error: "Could not save feedback." }, { status: 500 });
  }
}
