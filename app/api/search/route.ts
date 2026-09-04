import { verifyApiToken } from "../../../lib/api-auth";
import { parseChannelSort, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { searchProfileVideoPage } from "../../../lib/feed/service";
import { errorFields } from "../../../lib/logger";
import { getProfile } from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const observation = createFeedObservation("search.videos");

  try {
    const body = await request.json();
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const query = typeof body.query === "string" ? body.query.replace(/\s+/g, " ").trim() : "";
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);
    const profile = profileId ? getProfile(profileId) : null;

    if (!profile) {
      return Response.json({ error: "Select a profile before searching." }, { status: 400 });
    }
    if (query.length < 2) {
      return Response.json({ error: "Enter at least two characters to search." }, { status: 400 });
    }

    observation.profileId = profile.id;
    const cursor = body.cursor;
    if (cursor != null && (typeof cursor.session !== "string" || !Number.isSafeInteger(cursor.page) || cursor.page < 1)) {
      return Response.json({ error: "Invalid search cursor." }, { status: 400 });
    }
    const result = await searchProfileVideoPage(
      profile.id,
      query,
      tags,
      channels,
      channelSort,
      observation,
      cursor
    );
    logFeedObservation(observation, { queryLength: query.length, finalVideos: result.videos.length });
    return Response.json({ query, ...result });
  } catch (error) {
    logFeedObservation(observation, { ...errorFields(error, { stack: true }) });
    return Response.json(
      { error: "Search failed. Check your API key and network access." },
      { status: 500 }
    );
  }
}
