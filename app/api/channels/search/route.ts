import { searchChannels } from "../../../../lib/feed/youtube";
import { getProfile, listProfiles } from "../../../../lib/profile-store";
import { errorFields, logWarn, requestFields } from "../../../../lib/logger";
import { verifyApiToken } from "../../../../lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return Response.json({ channels }, {
      headers: {
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    logWarn("channels.search_failed", requestFields(request, {
      profileId: profile?.id || "",
      queryLength: query.length,
      ...errorFields(error)
    }));
    return Response.json({ channels: [] });
  }
}
