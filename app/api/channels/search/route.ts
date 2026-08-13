import { searchChannels } from "../../../../lib/feed/youtube";
import { getProfile, listProfiles } from "../../../../lib/profile-store";
import { errorFields, logWarn, requestFields } from "../../../../lib/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  const requestedProfileId = url.searchParams.get("profileId") || "";
  let profile;
  if (requestedProfileId) {
     profile = getProfile(requestedProfileId);
  }
  if (!profile) {
     profile = listProfiles()[0];
  }

  if (query.length < 2) {
    return Response.json({ channels: [] });
  }

  try {
    const channels = await searchChannels(query, profile?.id || "setup");
    return Response.json({ channels });
  } catch (error) {
    logWarn("channels.search_failed", requestFields(request, {
      profileId: profile?.id || "",
      queryLength: query.length,
      ...errorFields(error)
    }));
    return Response.json({ channels: [] });
  }
}
