import { createQueries } from "./input";
import {
  addPoolNodes,
  createFeedPoolKey,
  getFeedPoolState,
  getPoolVideoIds,
  listPoolNodes,
  markPoolNodesServed,
  markRootDiscovered,
  prunePool,
  updatePoolSimilarities
} from "./pool-store";
import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { applyEngagement } from "./engagement";
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
  forceExpansion?: boolean;
  servingOnly?: boolean;
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
  const poolKey = createFeedPoolKey({ tags: queries, channels, channelSort });
  const watchedVideoIds = new Set(networkOptions.watchedVideoIds || []);
  const initializedRoot = await initializePoolOnce(
    profileId,
    poolKey,
    queries,
    channels,
    channelSort,
    observation
  );

  let poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
  let readyPreview = createCandidatePoolFeed({
    rootVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch"),
    channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos"),
    relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos"),
    watchedVideos: poolVideos.filter((video) => video.sourceNodeId === "watchedVideos"),
    watchedVideoIds,
    interactions: getVideoInteractions(profileId),
    config
  });
  const expandedPool =
    !options.servingOnly &&
    (options.forceExpansion || readyPreview.videos.length <= config.feed.readyQueueLowWaterMark);

  if (expandedPool) {
    await expandPool(profileId, poolKey, poolVideos, observation);
    poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
    readyPreview = createCandidatePoolFeed({
      rootVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch"),
      channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos"),
      relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos"),
      watchedVideos: poolVideos.filter((video) => video.sourceNodeId === "watchedVideos"),
      watchedVideoIds,
      interactions: getVideoInteractions(profileId),
      config
    });
  }

  prunePool(profileId, poolKey, poolVideos, config.feed.poolSizeCap);

  const fastLaneVideos = await getSubscriptionFastLaneVideos(
    channels,
    channelSort,
    observation,
    profileId,
    watchedVideoIds
  );
  const poolRecommendations = readyPreview.videos.slice(0, config.feed.maxVideos);
  const videos = [...fastLaneVideos, ...poolRecommendations].slice(0, config.feed.maxVideos);

  await retainReadyQueueEmbeddings(profileId, poolRecommendations);
  markPoolNodesServed(profileId, poolKey, poolRecommendations);

  const poolState = getFeedPoolState(profileId, poolKey);
  const pool = {
    key: poolKey,
    videos: poolState?.poolVideos || poolVideos.length,
    targetVideos: config.feed.poolSizeCap,
    rootDiscoveredAt: poolState?.rootDiscoveredAt || Date.now(),
    maxVideos: config.feed.maxVideos,
    initializedRoot,
    expandedPool,
    status: initializedRoot ? "initialized" : expandedPool ? "expanded" : "served"
  };

  return {
    queries,
    videos,
    nodes: readyPreview.nodes,
    searchVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch").length,
    channelVideos: fastLaneVideos.length,
    relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos").length,
    watchedVideos: latestWatchedVideos.length,
    pool
  };
}

async function initializePoolOnce(
  profileId: string,
  poolKey: string,
  queries: string[],
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation
) {
  const existingState = getFeedPoolState(profileId, poolKey);
  const existingCentroid = getCentroid(profileId, poolKey);

  if (existingState && existingCentroid) {
    return false;
  }

  const timestamp = Date.now();
  const rootVideos = queries.length > 0 ? await searchVideos(queries, observation, profileId) : [];
  const rootEmbeddings = await embedVideos(rootVideos);
  const originalCentroid = averageNormalizedVectors(
    rootVideos.flatMap((video) => {
      const embedding = rootEmbeddings.get(video.id);
      return embedding ? [embedding] : [];
    })
  );
  const scoredRoots = scoreByCentroid(rootVideos, rootEmbeddings, originalCentroid, "tagSearch");

  markRootDiscovered(profileId, poolKey, timestamp);
  saveCentroid(profileId, poolKey, originalCentroid, originalCentroid);
  retainVideoEmbeddings(profileId, scoredRoots, rootEmbeddings);
  addPoolNodes(profileId, poolKey, "tagSearch", scoredRoots, timestamp);

  const channelCandidates = channels.length > 0
    ? await fetchChannelVideos(channels, channelSort, observation, profileId)
    : [];
  const channelEmbeddings = await embedVideos(channelCandidates);
  const channelPoolVideos = scoreByCentroid(
    channelCandidates,
    channelEmbeddings,
    originalCentroid,
    "channelVideos"
  ).filter((video) => (video.similarityScore || 0) >= getGretelConfig().feed.similarityThreshold);

  addPoolNodes(profileId, poolKey, "channelVideos", channelPoolVideos, timestamp);

  return true;
}

async function expandPool(
  profileId: string,
  poolKey: string,
  poolVideos: FeedVideo[],
  observation: FeedObservation
) {
  const config = getGretelConfig();
  const interactions = getVideoInteractions(profileId);
  const centroid = getCentroid(profileId, poolKey)?.current || [];
  const scoredPool = poolVideos.map((video) => applyEngagement(video, interactions, config));
  const seeds = selectExpansionSeeds({ videos: scoredPool, interactions, config });

  if (seeds.length === 0) {
    return;
  }

  const rawRelatedVideos = await recommendVideosFromSeeds(
    seeds,
    observation,
    profileId,
    "Recommended from",
    (seed, seedVideos) =>
      relatedBudgetForSeed(
        seed,
        seedVideos,
        config,
        interactions.size >= config.feed.coldStartInteractionThreshold
      )
  );
  const visitedVideoIds = getPoolVideoIds(profileId, poolKey);
  const newCandidates = rawRelatedVideos.filter((video) => !visitedVideoIds.has(video.id));
  const embeddings = await embedVideos(newCandidates);
  const parentScores = new Map(seeds.map((seed) => [seed.id, seed.engagementScore || 0]));
  const relatedVideos = scoreByCentroid(newCandidates, embeddings, centroid, "relatedVideos")
    .map((video) => ({
      ...video,
      parentEngagementScore: parentScores.get(video.parent_video_id || "") || 0
    }))
    .filter((video) => (video.similarityScore || 0) >= config.feed.similarityThreshold);

  addPoolNodes(profileId, poolKey, "relatedVideos", relatedVideos, Date.now());
}

async function getSubscriptionFastLaneVideos(
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation,
  profileId: string,
  watchedVideoIds: Set<string>
) {
  const config = getGretelConfig();

  if (channels.length === 0 || config.feed.subscriptionFastLanePerSession === 0) {
    return [];
  }

  const videos = await fetchChannelVideos(channels, channelSort, observation, profileId);

  return videos
    .filter((video) => !watchedVideoIds.has(video.id))
    .slice(0, config.feed.subscriptionFastLanePerSession)
    .map((video) => ({
      ...video,
      sourceNodeId: "channelVideos" as const,
      sourceNodeLabel: "Subscription fast lane"
    }));
}

function scorePoolVideos(profileId: string, poolKey: string, videos: FeedVideo[]) {
  const config = getGretelConfig();
  const centroid = getCentroid(profileId, poolKey)?.current || [];
  const interactions = getVideoInteractions(profileId);
  const rescored = rescoreCachedVideos(profileId, videos, centroid).map((video) =>
    applyEngagement(video, interactions, config)
  );

  updatePoolSimilarities(profileId, poolKey, rescored);

  return rescored;
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

async function retainReadyQueueEmbeddings(profileId: string, videos: FeedVideo[]) {
  const missingVideos = videos.filter((video) => !getRetainedEmbedding(profileId, video.id));

  if (missingVideos.length === 0) {
    return;
  }

  const embeddings = await embedVideos(missingVideos);
  retainVideoEmbeddings(profileId, missingVideos, embeddings);
}
