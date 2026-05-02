import { searchChannels } from "../../../../lib/feed/youtube";
import { getProfile, listProfiles } from "../../../../lib/profile-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  const requestedProfileId = url.searchParams.get("profileId") || "";
  const profile = getProfile(requestedProfileId) || listProfiles()[0];

  if (query.length < 2) {
    return Response.json({ channels: [] });
  }

  const channels = await searchChannels(query, profile.id);
  return Response.json({ channels });
}
