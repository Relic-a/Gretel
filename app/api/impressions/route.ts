import { logInfo, logWarn } from "../../../lib/logger";
import { parseChannelSort, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { expandFeedPoolForImpressions } from "../../../lib/feed/service";
import { getProfile, getWatchedVideoIds, recordVideoImpressions } from "../../../lib/profile-store";
import { withManagedAuth } from "../../../lib/managed-auth-context";
import { verifyApiToken } from "../../../lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withManagedAuth(request, () => handlePost(request));
}

async function handlePost(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);
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
    const profile = getProfile(profileId);
    let expandedPool = false;

    if (profile && recorded > 0 && (tags.length > 0 || channels.length > 0)) {
      const observation = createFeedObservation("feed.exhaustion_expansion", {
        profileId: profile.id
      });
      try {
        const expansion = await expandFeedPoolForImpressions(
          profile.id,
          tags,
          channels,
          channelSort,
          observation,
          {
            watchedVideoIds: getWatchedVideoIds(profile.id),
            expectedProfileUpdatedAt: profile.updatedAt
          }
        );
        expandedPool = expansion.expandedPool;

        logFeedObservation(observation, {
          tags: tags.length,
          channels: channels.length,
          channelSort,
          queries: tags.length,
          searchVideos: 0,
          channelVideos: 0,
          relatedVideos: 0,
          finalVideos: 0,
          activeNodes: 0,
          watchedExcluded: getWatchedVideoIds(profile.id).length,
          clientExcluded: 0,
          poolVideos: expansion.poolVideos,
          poolStatus: expandedPool ? "expanded" : "served",
          initializedRoot: false,
          expandedPool,
          configuredMaxVideos: 0
        });
      } catch (error) {
        // Impressions have already been persisted. Optional recommendation expansion
        // must not turn a successful recording into a failed request.
        const message = error instanceof Error ? error.message : String(error);
        logWarn("impressions.expansion_failed", { profileId, error: message });
        logFeedObservation(observation, { error: message });
      }
    }

    logInfo("impressions.recorded", {
      profileId,
      requested: videoIds.length,
      recorded,
      expandedPool
    });

    return Response.json({ recorded, expandedPool });
  } catch (error) {
    return Response.json({ error: "Could not record impressions." }, { status: 500 });
  }
}
