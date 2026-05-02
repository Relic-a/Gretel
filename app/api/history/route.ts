import { getProfile, listHistoryVideos } from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") || "";

  if (!getProfile(profileId)) {
    return Response.json({ error: "Select a profile first." }, { status: 400 });
  }

  return Response.json({ videos: listHistoryVideos(profileId) });
}
