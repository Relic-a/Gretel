import { createQueries } from "./input";
import {
  createFeedCacheKey,
  getCachedFeedVideos,
  getFeedCacheState,
  markFeedVideosRecommended,
  saveFeedCacheVideos
} from "./cache";
import {
  FEED_CACHE_REFRESH_HOURS,
  FEED_CACHE_TARGET_VIDEOS,
  MAX_VIDEOS,
  SUBSCRIPTION_REFRESH_MINUTES
} from "./config";
import { createWeightedFeed, type FeedNetworkNode, type FeedNetworkOptions } from "./network";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedNodeWeights, FeedObservation, FeedVideo } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";

export type CreateFeedOptions = {
  forceRefresh?: boolean;
};

export async function createFeed(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  prompt: string,
  weights: FeedNodeWeights,
  observation: FeedObservation,
  networkOptions: FeedNetworkOptions,
  latestWatchedVideos: FeedVideo[] = [],
  options: CreateFeedOptions = {}
) {
  const queries = createQueries(tags);
  const cacheKey = createFeedCacheKey({
    tags: queries,
    channels,
    channelSort,
    prompt,
    latestWatchedVideoIds: latestWatchedVideos.map((video) => video.id)
  });
  const now = Date.now();
  const cachedState = getFeedCacheState(profileId, cacheKey);
  const baseRefreshMs = FEED_CACHE_REFRESH_HOURS * 60 * 60 * 1000;
  const subscriptionRefreshMs = SUBSCRIPTION_REFRESH_MINUTES * 60 * 1000;
  const shouldRefreshBase =
    options.forceRefresh ||
    !cachedState ||
    cachedState.cachedVideos === 0 ||
    now - cachedState.baseRefreshedAt >= baseRefreshMs;
  const shouldRefreshSubscriptions =
    channels.length > 0 &&
    (options.forceRefresh ||
      !cachedState ||
      now - cachedState.subscriptionRefreshedAt >= subscriptionRefreshMs);

  if (shouldRefreshBase) {
    const freshNodes = await fetchFreshFeedNodes(
      profileId,
      queries,
      channels,
      channelSort,
      prompt,
      weights,
      observation,
      latestWatchedVideos
    );
    saveFeedCacheVideos(profileId, cacheKey, freshNodes, now, true, channels.length > 0);
  } else if (shouldRefreshSubscriptions) {
    const channelVideos = await fetchChannelVideos(channels, channelSort, prompt, observation, profileId);
    saveFeedCacheVideos(
      profileId,
      cacheKey,
      { channelVideos },
      now,
      false,
      true
    );
  }

  const tagSearchVideos = getCachedFeedVideos(profileId, cacheKey, "tagSearch", MAX_VIDEOS * 3);
  const channelVideos = getCachedFeedVideos(profileId, cacheKey, "channelVideos", MAX_VIDEOS * 3);
  const naturalLanguageVideos = getCachedFeedVideos(
    profileId,
    cacheKey,
    "naturalLanguage",
    MAX_VIDEOS * 3
  );
  const relatedVideos = getCachedFeedVideos(profileId, cacheKey, "relatedVideos", MAX_VIDEOS * 3);
  const watchedVideos = getCachedFeedVideos(profileId, cacheKey, "watchedVideos", MAX_VIDEOS * 3);
  const state = getFeedCacheState(profileId, cacheKey);
  const cache = {
    key: cacheKey,
    videos: state?.cachedVideos || 0,
    targetVideos: FEED_CACHE_TARGET_VIDEOS,
    refreshedAt: state?.baseRefreshedAt || now,
    subscriptionRefreshedAt: state?.subscriptionRefreshedAt || 0,
    refreshHours: FEED_CACHE_REFRESH_HOURS,
    subscriptionRefreshMinutes: SUBSCRIPTION_REFRESH_MINUTES,
    forced: Boolean(options.forceRefresh)
  };
  const networkNodes = createFeedNetworkNodes(
    weights,
    tagSearchVideos,
    channelVideos,
    naturalLanguageVideos,
    relatedVideos,
    watchedVideos
  );
  const feed = createWeightedFeed(networkNodes, networkOptions);
  markFeedVideosRecommended(profileId, cacheKey, feed.videos);

  return {
    queries,
    videos: feed.videos,
    nodes: feed.nodes,
    searchVideos: tagSearchVideos.length + naturalLanguageVideos.length,
    channelVideos: channelVideos.length,
    watchedVideos: watchedVideos.length,
    cache
  };
}

async function fetchFreshFeedNodes(
  profileId: string,
  queries: string[],
  channels: string[],
  channelSort: ChannelSort,
  prompt: string,
  weights: FeedNodeWeights,
  observation: FeedObservation,
  latestWatchedVideos: FeedVideo[]
) {
  const tagSearchVideos =
    queries.length > 0 ? await searchVideos(queries, prompt, observation, profileId) : [];
  const naturalLanguageVideos =
    prompt.length > 0 ? await searchVideos([prompt], prompt, observation, profileId) : [];
  const channelVideos =
    channels.length > 0
      ? await fetchChannelVideos(channels, channelSort, prompt, observation, profileId)
      : [];
  const seedVideos = [...tagSearchVideos, ...naturalLanguageVideos, ...channelVideos];
  const relatedVideos =
    weights.relatedVideos > 0
      ? await recommendVideosFromSeeds(seedVideos, prompt, observation, profileId)
      : [];
  const watchedVideos =
    weights.watchedVideos > 0 && latestWatchedVideos.length > 0
      ? await recommendVideosFromSeeds(
          latestWatchedVideos,
          prompt,
          observation,
          profileId,
          "Watched-neighbor from"
        )
      : [];

  return {
    tagSearch: tagSearchVideos,
    channelVideos,
    naturalLanguage: naturalLanguageVideos,
    relatedVideos,
    watchedVideos
  };
}

function createFeedNetworkNodes(
  weights: FeedNodeWeights,
  tagSearchVideos: FeedVideo[],
  channelVideos: FeedVideo[],
  naturalLanguageVideos: FeedVideo[],
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
      id: "naturalLanguage",
      label: "Natural language search",
      weight: weights.naturalLanguage,
      videos: naturalLanguageVideos
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
