import { createQueries } from "./input";
import {
  createFeedCacheKey,
  getCachedFeedVideos,
  getFeedCacheState,
  markFeedVideosRecommended,
  saveFeedCacheVideos
} from "./cache";
import {
  getGretelConfig
} from "./config";
import { createWeightedFeed, type FeedNetworkNode, type FeedNetworkOptions } from "./network";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedNodeWeights, FeedObservation, FeedVideo } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";

export type CreateFeedOptions = {
  forceRefresh?: boolean;
  cacheOnly?: boolean;
};

export async function createFeed(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  weights: FeedNodeWeights,
  observation: FeedObservation,
  networkOptions: FeedNetworkOptions,
  latestWatchedVideos: FeedVideo[] = [],
  options: CreateFeedOptions = {}
) {
  const queries = createQueries(tags);
  const config = getGretelConfig();
  const cacheKey = createFeedCacheKey({
    tags: queries,
    channels,
    channelSort
  });
  const now = Date.now();
  const cachedState = getFeedCacheState(profileId, cacheKey);
  const baseRefreshMs = config.feed.cacheRefreshHours * 60 * 60 * 1000;
  const subscriptionRefreshMs = config.feed.subscriptionRefreshMinutes * 60 * 1000;
  const useCachedVideosOnly = Boolean(
    options.cacheOnly && !options.forceRefresh && cachedState && cachedState.cachedVideos > 0
  );
  const shouldRefreshBase =
    !useCachedVideosOnly &&
    (options.forceRefresh ||
      !cachedState ||
      cachedState.cachedVideos === 0 ||
      now - cachedState.baseRefreshedAt >= baseRefreshMs);
  const shouldRefreshSubscriptions =
    channels.length > 0 &&
    !useCachedVideosOnly &&
    (options.forceRefresh ||
      !cachedState ||
      now - cachedState.subscriptionRefreshedAt >= subscriptionRefreshMs);
  const cacheStatus = !cachedState
    ? "miss"
    : shouldRefreshBase || shouldRefreshSubscriptions
      ? "stale"
      : "hit";

  if (shouldRefreshBase) {
    const freshNodes = await fetchFreshFeedNodes(
      profileId,
      queries,
      channels,
      channelSort,
      weights,
      observation,
      latestWatchedVideos
    );
    saveFeedCacheVideos(
      profileId,
      cacheKey,
      freshNodes,
      now,
      true,
      channels.length > 0,
      config.feed.cacheTargetVideos
    );
  } else if (shouldRefreshSubscriptions) {
    const channelVideos = await fetchChannelVideos(channels, channelSort, observation, profileId);
    saveFeedCacheVideos(
      profileId,
      cacheKey,
      { channelVideos },
      now,
      false,
      true,
      config.feed.cacheTargetVideos
    );
  }

  const cacheReadLimit = Math.ceil(config.feed.maxVideos * config.feed.cacheReadMultiplier);
  const watchedVideoIds = networkOptions.watchedVideoIds || [];
  const tagSearchVideos = getCachedFeedVideos(
    profileId,
    cacheKey,
    "tagSearch",
    cacheReadLimit,
    watchedVideoIds
  );
  const channelVideos = getCachedFeedVideos(
    profileId,
    cacheKey,
    "channelVideos",
    cacheReadLimit,
    watchedVideoIds
  );
  const relatedVideos = getCachedFeedVideos(
    profileId,
    cacheKey,
    "relatedVideos",
    cacheReadLimit,
    watchedVideoIds
  );
  const watchedVideos = getCachedFeedVideos(
    profileId,
    cacheKey,
    "watchedVideos",
    cacheReadLimit,
    watchedVideoIds
  );
  const state = getFeedCacheState(profileId, cacheKey);
  const cache = {
    key: cacheKey,
    videos: state?.cachedVideos || 0,
    targetVideos: config.feed.cacheTargetVideos,
    refreshedAt: state?.baseRefreshedAt || now,
    subscriptionRefreshedAt: state?.subscriptionRefreshedAt || 0,
    refreshHours: config.feed.cacheRefreshHours,
    subscriptionRefreshMinutes: config.feed.subscriptionRefreshMinutes,
    cacheReadMultiplier: config.feed.cacheReadMultiplier,
    maxVideos: config.feed.maxVideos,
    forced: Boolean(options.forceRefresh),
    status: cacheStatus,
    refreshedBase: shouldRefreshBase,
    refreshedSubscriptions: shouldRefreshSubscriptions
  };
  const networkNodes = createFeedNetworkNodes(
    weights,
    tagSearchVideos,
    channelVideos,
    relatedVideos,
    watchedVideos
  );
  const feed = createWeightedFeed(networkNodes, networkOptions);
  markFeedVideosRecommended(profileId, cacheKey, feed.videos);

  return {
    queries,
    videos: feed.videos,
    nodes: feed.nodes,
    searchVideos: tagSearchVideos.length,
    channelVideos: channelVideos.length,
    relatedVideos: relatedVideos.length,
    watchedVideos: watchedVideos.length,
    cache
  };
}

async function fetchFreshFeedNodes(
  profileId: string,
  queries: string[],
  channels: string[],
  channelSort: ChannelSort,
  weights: FeedNodeWeights,
  observation: FeedObservation,
  latestWatchedVideos: FeedVideo[]
) {
  const tagSearchVideos =
    queries.length > 0 ? await searchVideos(queries, observation, profileId) : [];
  const channelVideos =
    channels.length > 0
      ? await fetchChannelVideos(channels, channelSort, observation, profileId)
      : [];
  const seedVideos = [...tagSearchVideos, ...channelVideos];
  const relatedVideos =
    weights.relatedVideos > 0
      ? await recommendVideosFromSeeds(seedVideos, observation, profileId)
      : [];
  const watchedVideos =
    weights.watchedVideos > 0 && latestWatchedVideos.length > 0
      ? await recommendVideosFromSeeds(
          latestWatchedVideos,
          observation,
          profileId,
          "Watched-neighbor from"
        )
      : [];

  return {
    tagSearch: tagSearchVideos,
    channelVideos,
    relatedVideos,
    watchedVideos
  };
}

function createFeedNetworkNodes(
  weights: FeedNodeWeights,
  tagSearchVideos: FeedVideo[],
  channelVideos: FeedVideo[],
  relatedVideos: FeedVideo[],
  watchedVideos: FeedVideo[]
) {
  return [
    {
      id: "tagSearch",
      label: "Tag search",
      weight: weights.tagSearch,
      videos: tagSearchVideos
    },
    {
      id: "channelVideos",
      label: "Subscription videos",
      weight: weights.channelVideos,
      videos: channelVideos
    },
    {
      id: "relatedVideos",
      label: "Related videos",
      weight: weights.relatedVideos,
      videos: relatedVideos
    },
    {
      id: "watchedVideos",
      label: "Watched video neighbors",
      weight: weights.watchedVideos,
      videos: watchedVideos
    }
  ] satisfies FeedNetworkNode[];
}
