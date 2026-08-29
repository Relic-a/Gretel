import { parseChannelSort, parseTags } from "../../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../../lib/feed/observation";
import {
  createFeed,
  FeedProfileStaleError,
  startFeedServingSession
} from "../../../../lib/feed/service";
import { errorFields } from "../../../../lib/logger";
import {
  getProfile,
  getWatchedVideoIds,
  saveProfileFeedPreferences
} from "../../../../lib/profile-store";
import { verifyApiToken } from "../../../../lib/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyApiToken(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const observation = createFeedObservation("feed.initial_build");

  try {
    const body = await request.json();
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);
    const requestedProfileId = typeof body.profileId === "string" ? body.profileId : "";
    const profile = requestedProfileId ? getProfile(requestedProfileId) : null;
    observation.profileId = profile?.id;

    if (!profile) {
      return Response.json({ error: "Create a profile before building a feed." }, { status: 400 });
    }

    if (tags.length === 0 && channels.length === 0) {
      return Response.json(
        { error: "Enter at least one tag or subscription to build a feed." },
        { status: 400 }
      );
    }

    saveProfileFeedPreferences(profile.id, tags, channels);

    const watchedVideoIds = getWatchedVideoIds(profile.id);
    const feed = await createFeed(
      profile.id,
      tags,
      channels,
      channelSort,
      observation,
      {
        watchedVideoIds,
        expectedProfileUpdatedAt: profile.updatedAt
      }
    );
    const sessionId = startFeedServingSession(
      profile.id,
      tags,
      channels,
      channelSort,
      feed.videos.map((video) => video.id)
    );

    logFeedObservation(observation, {
      tags: tags.length,
      channels: channels.length,
      channelSort,
      queries: feed.queries.length,
      searchVideos: feed.searchVideos,
      channelVideos: feed.channelVideos,
      relatedVideos: feed.relatedVideos,
      finalVideos: feed.videos.length,
      activeNodes: feed.nodes.filter((node) => node.weight > 0).length,
      watchedExcluded: watchedVideoIds.length,
      clientExcluded: 0,
      poolVideos: feed.pool.videos,
      poolStatus: feed.pool.status,
      initializedRoot: feed.pool.initializedRoot,
      expandedPool: feed.pool.expandedPool,
      configuredMaxVideos: feed.pool.maxVideos,
      resetFeed: true,
      servingOnly: false
    });

    return Response.json({
      tags,
      channels,
      channelSort,
      profile,
      queries: feed.queries,
      nodes: feed.nodes,
      pool: feed.pool,
      sessionId,
      upNextByVideoId: feed.upNextByVideoId,
      videos: feed.videos
    });
  } catch (error) {
    if (error instanceof FeedProfileStaleError || isForeignKeyConstraintError(error)) {
      return Response.json(
        { error: "The active profile changed before feed generation finished." },
        { status: 409 }
      );
    }

    logFeedObservation(observation, {
      ...errorFields(error, { stack: true })
    });
    return Response.json(
      { error: "Feed generation failed. Check your API key and network access." },
      { status: 500 }
    );
  }
}

function isForeignKeyConstraintError(error: unknown) {
  return error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_FOREIGNKEY";
}
