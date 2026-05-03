import type { FeedVideo } from "../../../lib/feed/types";
import {
  getLikedVideoIds,
  getProfile,
  likeVideo,
  unlikeVideo
} from "../../../lib/profile-store";
import { updateCentroidsForPositiveEngagement } from "../../../lib/feed/centroid-drift";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") || "";

  if (!getProfile(profileId)) {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }

  return Response.json({ likedVideoIds: getLikedVideoIds(profileId) });
}

export async function POST(request: Request) {
  const body = await request.json();
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const action = body.action === "unlike" ? "unlike" : "like";
  const video = body.video && typeof body.video === "object" ? body.video : null;
  const videoId =
    typeof body.videoId === "string"
      ? body.videoId
      : video && "id" in video && typeof video.id === "string"
        ? video.id
        : "";

  if (!getProfile(profileId) || !videoId) {
    return Response.json({ error: "Could not update liked videos." }, { status: 400 });
  }

  if (action === "unlike") {
    unlikeVideo(profileId, videoId);
  } else if (video && "id" in video && typeof video.id === "string") {
    likeVideo(profileId, video as FeedVideo);
    await updateCentroidsForPositiveEngagement(profileId, {
      ...(video as FeedVideo),
      liked: true
    });
  } else {
    return Response.json({ error: "Choose a video to like." }, { status: 400 });
  }

  return Response.json({ likedVideoIds: getLikedVideoIds(profileId) });
}
