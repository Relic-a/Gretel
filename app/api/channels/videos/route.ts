import { verifyApiToken } from "../../../../lib/api-auth";
import { withManagedAuth } from "../../../../lib/managed-auth-context";
import { getProfile } from "../../../../lib/profile-store";
import { browseChannel } from "../../../../lib/feed/channel-browser";
import { filterChannelPage } from "../../../../lib/feed/service";
import { createFeedObservation, logFeedObservation } from "../../../../lib/feed/observation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return withManagedAuth(request, async () => {
    if (!verifyApiToken(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const observation = createFeedObservation("channel.browse");
    try {
      const body = await request.json();
      if (typeof body.profileId !== "string" || !getProfile(body.profileId) || typeof body.channel !== "string" || !body.channel.trim() || body.channel.length > 300 || (body.sort != null && typeof body.sort !== "string") || (body.filter != null && typeof body.filter !== "boolean") || (body.refresh != null && typeof body.refresh !== "boolean")) {
        return Response.json({ error: "Invalid channel request." }, { status: 400 });
      }
      if (body.cursor != null && (typeof body.cursor.session !== "string" || !Number.isSafeInteger(body.cursor.page) || body.cursor.page < 1)) {
        return Response.json({ error: "Invalid channel cursor." }, { status: 400 });
      }
      observation.profileId = body.profileId;
      const result = await browseChannel(body.profileId, body.channel.trim(), body.sort || "", body.cursor, body.refresh === true);
      const videos = body.filter ? await filterChannelPage(body.profileId, result.videos, observation) : result.videos;
      logFeedObservation(observation, { finalVideos: videos.length });
      return Response.json({ ...result, videos });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load channel videos.";
      logFeedObservation(observation, { error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
