import { getProfile, getSavedVideoIds, listSavedVideos, saveVideo, unsaveVideo } from "../../../lib/profile-store";
import type { FeedVideo } from "../../../lib/feed/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") || "";

  if (!getProfile(profileId)) {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }

  return Response.json({
    videos: listSavedVideos(profileId),
    savedVideoIds: getSavedVideoIds(profileId)
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const action = body.action === "unsave" ? "unsave" : "save";
  const video = body.video && typeof body.video === "object" ? body.video : null;
  const videoId =
    typeof body.videoId === "string"
      ? body.videoId
      : video && "id" in video && typeof video.id === "string"
        ? video.id
        : "";

  if (!getProfile(profileId) || typeof videoId !== "string") {
    return Response.json({ error: "Could not update saved videos." }, { status: 400 });
  }

  if (action === "unsave") {
    unsaveVideo(profileId, videoId);
  } else if (video && "id" in video && typeof video.id === "string") {
    saveVideo(profileId, video as FeedVideo);
  } else {
    return Response.json({ error: "Choose a video to save." }, { status: 400 });
  }

  return Response.json({
    videos: listSavedVideos(profileId),
    savedVideoIds: getSavedVideoIds(profileId)
  });
}
