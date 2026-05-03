import { parseChannelSort, parseFeedNodeWeights, parseTags } from "../../../lib/feed/input";
import { createFeedObservation, logFeedObservation } from "../../../lib/feed/observation";
import { createFeed } from "../../../lib/feed/service";
import { getGretelConfig } from "../../../lib/feed/config";
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
    const forceRefresh = body.forceRefresh === true;
    const cacheOnly = body.cacheOnly === true;
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

    if (Object.values(weights).every((weight) => weight === 0)) {
      return Response.json(
        { error: "Set at least one network weight above zero." },
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
    const tagFeeds = await Promise.all(
      (tags.length > 0 ? tags : [""]).map(async (tag) => ({
        tag,
        feed: await createFeed(
          profile.id,
          tag ? [tag] : [],
          channels,
          channelSort,
          weights,
          observation,
          networkOptions,
          latestWatchedVideos,
          { forceRefresh, cacheOnly }
        )
      }))
    );
    const feed = tagFeeds[0].feed;
    const feedTabs =
      tagFeeds.length > 1
        ? [
            {
              key: "all",
              label: "All",
              videos: mixFeedsRandomly(tagFeeds.flatMap((entry) => entry.feed.videos))
            },
            ...tagFeeds.map((entry) => ({
              key: entry.tag,
              label: entry.tag,
              videos: entry.feed.videos
            }))
          ]
        : undefined;

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
      videos: feedTabs?.[0].videos || feed.videos,
      feedTabs
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

function mixFeedsRandomly(videos: Awaited<ReturnType<typeof createFeed>>["videos"]) {
  const seen = new Set<string>();
  const uniqueVideos = videos.filter((video) => {
    if (seen.has(video.id)) {
      return false;
    }

    seen.add(video.id);
    return true;
  });

  for (let index = uniqueVideos.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [uniqueVideos[index], uniqueVideos[swapIndex]] = [uniqueVideos[swapIndex], uniqueVideos[index]];
  }

  return uniqueVideos.slice(0, getGretelConfig().feed.maxVideos);
}
