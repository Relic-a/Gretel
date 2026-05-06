import { logInfo, logWarn } from "../../../lib/logger";
import { recordVideoImpressions } from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const videoIds = Array.isArray(body.videoIds)
    ? body.videoIds.filter((videoId: unknown) => typeof videoId === "string")
    : [];

  if (!profileId || videoIds.length === 0) {
    logWarn("impressions.invalid", {
      hasProfileId: Boolean(profileId),
      videoIds: videoIds.length
    });
    return Response.json({ error: "Invalid impression event." }, { status: 400 });
  }

  const recorded = recordVideoImpressions(profileId, videoIds);

  logInfo("impressions.recorded", {
    profileId,
    requested: videoIds.length,
    recorded
  });

  return Response.json({ recorded });
}
