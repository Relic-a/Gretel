import { parseChannelSort, parseFeedNodeWeights, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { createFeed } from "../../../lib/feed/service";
import { errorFields } from "../../../lib/logger";
import {
  getChannelBoosts,
  getLatestWatchedVideos,
  getNodeBoosts,
  getProfile,
  getWatchedVideoIds
} from "../../../lib/profile-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const observation = createFeedObservation();

  try {
    const body = await request.json();
    const tags = parseTags(body.tags);
    const channels = parseTags(body.channels);
    const channelSort = parseChannelSort(body.channelSort);
    const weights = parseFeedNodeWeights(body.weights);
    const forceExpansion = body.forceExpansion === true || body.forceRefresh === true;
    const servingOnly = body.servingOnly === true || body.cacheOnly === true;
    const requestedProfileId = typeof body.profileId === "string" ? body.profileId : "";
    const profile = requestedProfileId ? getProfile(requestedProfileId) : null;

    if (!profile) {
      return Response.json({ error: "Create a profile before building a feed." }, { status: 400 });
    }

    if (tags.length === 0 && channels.length === 0) {
      return Response.json(
        { error: "Enter at least one tag or subscription to build a feed." },
        { status: 400 }
      );
    }

    const watchedVideoIds = getWatchedVideoIds(profile.id);
    const latestWatchedVideos = getLatestWatchedVideos(profile.id);
    const networkOptions = {
      watchedVideoIds,
      nodeBoosts: getNodeBoosts(profile.id),
      channelBoosts: getChannelBoosts(profile.id)
    };
    const feed = await createFeed(
      profile.id,
      tags,
      channels,
      channelSort,
      weights,
      observation,
      networkOptions,
      latestWatchedVideos,
      { forceExpansion, servingOnly }
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
      usedRecommendations: weights.relatedVideos > 0,
      watchedSeeds: latestWatchedVideos.length,
      watchedExcluded: watchedVideoIds.length,
      poolVideos: feed.pool.videos,
      poolStatus: feed.pool.status,
      initializedRoot: feed.pool.initializedRoot,
      expandedPool: feed.pool.expandedPool,
      configuredMaxVideos: feed.pool.maxVideos,
      forceExpansion,
      servingOnly
    });

    return Response.json({
      tags,
      channels,
      channelSort,
      profile,
      weights,
      queries: feed.queries,
      nodes: feed.nodes,
      pool: feed.pool,
      videos: feed.videos
    });
  } catch (error) {
    logFeedObservation(observation, {
      ...errorFields(error, { stack: true })
    });
    return Response.json(
      { error: "Feed generation failed. Check your API key and network access." },
      { status: 500 }
    );
  }
}
