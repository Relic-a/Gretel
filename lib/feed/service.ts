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
import { getEmbeddingProvider, createEmbeddingInput } from "./embeddings";
import { computeEngagementScore } from "./engagement";
import { createCandidatePoolFeed, relatedBudgetForSeed, selectExpansionSeeds } from "./pool";
import type { FeedNetworkOptions } from "./network";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedNodeWeights, FeedObservation, FeedVideo } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";
import { getVideoInteractions } from "../profile-store";
import {
  getCentroid,
  getRetainedEmbedding,
  retainVideoEmbeddings,
  saveCentroid
} from "./algorithm-store";
import { averageNormalizedVectors, cosineSimilarity } from "./vector-math";

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
      cachedState.cachedVideos <= config.feed.readyQueueLowWaterMark ||
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
  const activeCentroid = getCentroid(profileId, cacheKey)?.current || [];
  const networkNodes = createFeedNetworkNodes(
    rescoreCachedVideos(profileId, tagSearchVideos, activeCentroid),
    channelVideos,
    rescoreCachedVideos(profileId, relatedVideos, activeCentroid),
    watchedVideos
  );
  const interactions = getVideoInteractions(profileId);
  const feed = createCandidatePoolFeed({
    rootVideos: networkNodes.tagSearch,
    channelVideos: networkNodes.channelVideos.slice(0, config.feed.subscriptionFastLanePerSession),
    relatedVideos: networkNodes.relatedVideos,
    watchedVideos: networkNodes.watchedVideos,
    watchedVideoIds: new Set(watchedVideoIds),
    interactions,
    config
  });
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
  const embeddings = await embedVideos(tagSearchVideos);
  const rootEmbeddings = tagSearchVideos.flatMap((video) => {
    const embedding = embeddings.get(video.id);
    return embedding ? [embedding] : [];
  });
  const originalCentroid = averageNormalizedVectors(rootEmbeddings);
  const storedCentroid = getCentroid(
    profileId,
    createFeedCacheKey({ tags: queries, channels, channelSort })
  );
  const currentCentroid = storedCentroid?.current.length ? storedCentroid.current : originalCentroid;
  const scoredRoots = scoreByCentroid(tagSearchVideos, embeddings, currentCentroid, "tagSearch");
  saveCentroid(
    profileId,
    createFeedCacheKey({ tags: queries, channels, channelSort }),
    originalCentroid,
    currentCentroid
  );
  retainVideoEmbeddings(profileId, scoredRoots, embeddings);

  const rawChannelVideos =
    channels.length > 0
      ? await fetchChannelVideos(channels, channelSort, observation, profileId)
      : [];
  const channelEmbeddings = await embedVideos(rawChannelVideos);
  const scoredChannelVideos = scoreByCentroid(
    rawChannelVideos,
    channelEmbeddings,
    currentCentroid,
    "channelVideos"
  ).filter((video) => (video.similarityScore || 0) >= getGretelConfig().feed.similarityThreshold);
  const interactions = getVideoInteractions(profileId);
  const seedPool = [...scoredRoots, ...scoredChannelVideos].map((video) => {
    const interaction = interactions.get(video.id);

    return {
      ...video,
      engagementScore: interaction
        ? computeEngagementScore(interaction, getGretelConfig().learning)
        : video.similarityScore || 0
    };
  });
  const seedVideos = selectExpansionSeeds({
    videos: seedPool,
    interactions,
    config: getGretelConfig()
  });
  const rawRelatedVideos =
    weights.relatedVideos > 0
      ? await recommendVideosFromSeeds(
          seedVideos,
          observation,
          profileId,
          "Recommended from",
          (seed, seeds) => relatedBudgetForSeed(seed, seeds, getGretelConfig())
        )
      : [];
  const relatedEmbeddings = await embedVideos(rawRelatedVideos);
  const relatedVideos = scoreByCentroid(
    rawRelatedVideos,
    relatedEmbeddings,
    currentCentroid,
    "relatedVideos"
  )
    .map((video) => ({
      ...video,
      parentEngagementScore: seedPool.find((seed) => seed.id === video.parent_video_id)?.engagementScore || 0
    }))
    .filter((video) => (video.similarityScore || 0) >= getGretelConfig().feed.similarityThreshold);
  retainVideoEmbeddings(profileId, relatedVideos, relatedEmbeddings);

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
    tagSearch: scoredRoots,
    channelVideos: rawChannelVideos.map((video) => ({ ...video, sourceNodeId: "channelVideos" as const })),
    relatedVideos,
    watchedVideos
  };
}

function createFeedNetworkNodes(
  tagSearchVideos: FeedVideo[],
  channelVideos: FeedVideo[],
  relatedVideos: FeedVideo[],
  watchedVideos: FeedVideo[]
) {
  return {
    tagSearch: tagSearchVideos,
    channelVideos,
    relatedVideos,
    watchedVideos
  };
}

async function embedVideos(videos: FeedVideo[]) {
  const config = getGretelConfig();
  const provider = getEmbeddingProvider(config);
  const embeddings = new Map<string, number[]>();

  for (let index = 0; index < videos.length; index += config.embeddings.batchSize) {
    const batch = videos.slice(index, index + config.embeddings.batchSize);
    const vectors = await provider.embedTexts(batch.map(createEmbeddingInput));

    for (let vectorIndex = 0; vectorIndex < batch.length; vectorIndex += 1) {
      const vector = vectors[vectorIndex];

      if (vector?.length) {
        embeddings.set(batch[vectorIndex].id, vector);
      }
    }
  }

  return embeddings;
}

function scoreByCentroid(
  videos: FeedVideo[],
  embeddings: Map<string, number[]>,
  centroid: number[],
  sourceNodeId: FeedVideo["sourceNodeId"]
) {
  return videos.map((video) => {
    const embedding = embeddings.get(video.id);
    const similarityScore = embedding && centroid.length ? cosineSimilarity(embedding, centroid) : 0;

    return {
      ...video,
      sourceNodeId,
      similarityScore
    };
  });
}

function rescoreCachedVideos(profileId: string, videos: FeedVideo[], centroid: number[]) {
  if (centroid.length === 0) {
    return videos;
  }

  return videos.map((video) => {
    const embedding = getRetainedEmbedding(profileId, video.id);

    if (!embedding) {
      return video;
    }

    return {
      ...video,
      similarityScore: cosineSimilarity(embedding, centroid)
    };
  });
}
