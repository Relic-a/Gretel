import { parseChannelSort, parseFeedNodeWeights, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { createFeed } from "../../../lib/feed/service";
import { errorFields } from "../../../lib/logger";
import {
  getChannelBoosts,
  getLatestWatchedVideos,
  getNodeBoosts,
  getProfile,
  getWatchedVideoIds,
  listProfiles
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
    const forceRefresh = body.forceRefresh === true;
    const cacheOnly = body.cacheOnly === true;
    const requestedProfileId = typeof body.profileId === "string" ? body.profileId : "";
    const profile = getProfile(requestedProfileId) || listProfiles()[0];

    if (!profile) {
      return Response.json({ error: "Create a profile before building a feed." }, { status: 400 });
    }

    if (tags.length === 0 && channels.length === 0) {
      return Response.json(
        { error: "Enter at least one tag or subscription to build a feed." },
        { status: 400 }
      );
    }

    if (Object.values(weights).every((weight) => weight === 0)) {
      return Response.json(
        { error: "Set at least one network weight above zero." },
        { status: 400 }
      );
    }

    const watchedVideoIds = getWatchedVideoIds(profile.id);
    const latestWatchedVideos = getLatestWatchedVideos(profile.id);
    const feed = await createFeed(
      profile.id,
      tags,
      channels,
      channelSort,
      weights,
      observation,
      {
        watchedVideoIds,
        nodeBoosts: getNodeBoosts(profile.id),
        channelBoosts: getChannelBoosts(profile.id)
      },
      latestWatchedVideos,
      { forceRefresh, cacheOnly }
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
      cacheVideos: feed.cache.videos,
      cacheStatus: feed.cache.status,
      refreshedBase: feed.cache.refreshedBase,
      refreshedSubscriptions: feed.cache.refreshedSubscriptions,
      cacheReadMultiplier: feed.cache.cacheReadMultiplier,
      configuredMaxVideos: feed.cache.maxVideos,
      forcedRefresh: forceRefresh,
      cacheOnly
    });

    return Response.json({
      tags,
      channels,
      channelSort,
      profile,
      weights,
      queries: feed.queries,
      nodes: feed.nodes,
      cache: feed.cache,
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
