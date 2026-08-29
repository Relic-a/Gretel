import { getProfile, listHistoryVideos } from "../../../lib/profile-store";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";

    if (!getProfile(profileId)) {
      return Response.json({ error: "Select a profile first." }, { status: 400 });
    }

    return Response.json({ videos: listHistoryVideos(profileId) });
  } catch (error) {
    return Response.json({ error: "Could not load history." }, { status: 500 });
  }
}
