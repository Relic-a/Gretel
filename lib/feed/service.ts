import { createQueries } from "./input";
import {
  addPoolNodes,
  createFeedPoolKey,
  getFeedPoolState,
  getVisitedVideoIds,
  listPoolNodes,
  markPoolExpanded,
  markRootDiscovered,
  prunePool,
  updatePoolSimilarities
} from "./pool-store";
import { getGretelConfig } from "./config";
import { createEmbeddingInput, getEmbeddingProvider } from "./embeddings";
import { createEmbeddingInputWithTranscript, fetchTranscriptIntroduction } from "./transcription";
import { applyEngagement } from "./engagement";
import {
  createCandidatePoolFeed,
  describePoolHealth,
  describeServingScore,
  relatedBudgetForSeed,
  selectExpansionSeeds,
  selectUpNextCandidates
} from "./pool";
import { recommendVideosFromSeeds } from "./recommendations";
import type { ChannelSort, FeedObservation, FeedVideo } from "./types";
import { fetchChannelVideos, searchVideos } from "./youtube";
import {
  getProfile,
  getVideoImpressionCounts,
  getVideoInteractions,
  getWatchedVideoIds
} from "../profile-store";
import { logInfo } from "../logger";
import { createFeedObservation, logFeedObservation, observeOperation } from "./observation";
import {
  getCentroid,
  getRetainedEmbedding,
  retainVideoEmbeddings,
  saveCentroid
} from "./algorithm-store";
import { averageNormalizedVectors, cosineSimilarity } from "./vector-math";
import { hydrateChannelAvatars } from "./channel-avatar-cache";

export type CreateFeedOptions = {
  expectedProfileUpdatedAt?: number;
  servingOnly?: boolean;
  readOnlyPool?: boolean;
  watchedVideoIds?: string[];
  excludeVideoIds?: string[];
};

export type ServeFeedPageOptions = {
  sessionId?: string;
  watchedVideoIds?: string[];
  servedVideoIds?: string[];
};

type FeedServingSession = {
  id: string;
  profileId: string;
  poolKey: string;
  servedVideoIds: Set<string>;
  createdAt: number;
  updatedAt: number;
};

const feedServingSessions = getGlobalServingSessions();
const feedServingSessionTtlMs = 1000 * 60 * 60 * 6;
const preemptiveExpansionInFlight = getGlobalPreemptiveExpansionState();
const preemptiveExpansionFreshRatioThreshold = 0.4;

export class FeedProfileStaleError extends Error {
  constructor() {
    super("The active profile changed before feed generation finished.");
    this.name = "FeedProfileStaleError";
  }
}

export async function serveFeedPage(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation,
  options: ServeFeedPageOptions = {}
) {
  const queries = createQueries(tags);
  const config = getGretelConfig();
  const poolKey = createFeedPoolKey({ tags: queries, channels, channelSort });
  const poolState = getFeedPoolState(profileId, poolKey);

  if (!poolState) {
    throw new Error("This feed has not been built yet.");
  }

  const session = getOrCreateServingSession(options.sessionId, profileId, poolKey, options.servedVideoIds);
  const watchedVideoIds = new Set(options.watchedVideoIds || []);
  const interactions = getVideoInteractions(profileId);
  let poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
  recordScoringObservation(observation, profileId, poolVideos, "serving");
  let poolHealth = describePoolHealth({
    videos: poolVideos,
    watchedVideoIds,
    excludeVideoIds: session.servedVideoIds,
    interactions,
    config
  });
  const isLoadMoreRequest = Boolean(options.sessionId) || session.servedVideoIds.size > 0;

  if (isLoadMoreRequest && poolHealth.needsExpansion) {
    try {
      await expandPool(profileId, poolKey, poolVideos, observation, undefined, { bypassCooldown: true });
      poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
      prunePool(profileId, poolKey, poolVideos, config.feed.poolSizeCap);
      poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
      recordScoringObservation(observation, profileId, poolVideos, "loadMoreExpansion");
      poolHealth = describePoolHealth({
        videos: poolVideos,
        watchedVideoIds,
        excludeVideoIds: session.servedVideoIds,
        interactions,
        config
      });
    } catch (expansionError) {
      observation.operations.push({
        name: "feed.phase2.expansion_failed",
        durationMs: 0,
        status: "error",
        error: expansionError instanceof Error ? expansionError.message : String(expansionError)
      });
    }
  }

  const candidates = createCandidatePoolFeed({
    rootVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch"),
    channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos"),
    relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos"),
    watchedVideoIds,
    excludeVideoIds: session.servedVideoIds,
    interactions,
    config
  });
  const videos = hydrateChannelAvatars(candidates.videos).slice(0, config.feed.maxVideos);

  for (const video of videos) {
    session.servedVideoIds.add(video.id);
  }
  session.updatedAt = Date.now();

  await retainReadyQueueEmbeddings(profileId, videos, observation);
  const upNextByVideoId = buildUpNextByVideoId(profileId, videos);
  poolHealth = describePoolHealth({
    videos: poolVideos,
    watchedVideoIds,
    excludeVideoIds: session.servedVideoIds,
    interactions,
    config
  });

  if (poolHealth.freshRatio < preemptiveExpansionFreshRatioThreshold) {
    schedulePreemptiveExpansion(profileId, poolKey);
  }

  observation.operations.push({
    name: "feed.phase5.serving",
    durationMs: 0,
    status: "ok",
    input: {
      maxVideos: config.feed.maxVideos,
      sessionServedVideos: session.servedVideoIds.size
    },
    output: {
      poolVideos: videos.length,
      finalVideos: videos.length,
      upNextLists: Object.keys(upNextByVideoId).length,
      poolHealth
    }
  });

  return {
    queries,
    videos,
    nodes: candidates.nodes,
    searchVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch").length,
    channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos").length,
    relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos").length,
    pool: {
      key: poolKey,
      videos: poolVideos.length,
      targetVideos: config.feed.poolSizeCap,
      health: poolHealth,
      rootDiscoveredAt: poolState.rootDiscoveredAt,
      maxVideos: config.feed.maxVideos,
      initializedRoot: false,
      expandedPool: false,
      status: "served"
    },
    sessionId: session.id,
    upNextByVideoId
  };
}

export function startFeedServingSession(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  servedVideoIds: string[] = []
) {
  const queries = createQueries(tags);
  const poolKey = createFeedPoolKey({ tags: queries, channels, channelSort });
  const session = getOrCreateServingSession(undefined, profileId, poolKey);

  for (const videoId of servedVideoIds) {
    session.servedVideoIds.add(videoId);
  }
  session.updatedAt = Date.now();

  return session.id;
}

export async function createFeed(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation,
  options: CreateFeedOptions = {}
) {
  ensureProfileCurrent(profileId, options.expectedProfileUpdatedAt);

  const queries = createQueries(tags);
  const config = getGretelConfig();
  const poolKey = createFeedPoolKey({ tags: queries, channels, channelSort });
  const watchedVideoIds = new Set(options.watchedVideoIds || []);
  const excludeVideoIds = new Set(options.excludeVideoIds || []);
  const initializedRoot = options.readOnlyPool
    ? false
    : await initializePoolOnce(
        profileId,
        poolKey,
        queries,
        channels,
        channelSort,
        observation,
        options.expectedProfileUpdatedAt
      );

  let poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
  recordScoringObservation(observation, profileId, poolVideos, "initial");
  let readyPreview = createCandidatePoolFeed({
    rootVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch"),
    channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos"),
    relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos"),
    watchedVideoIds,
    excludeVideoIds,
    interactions: getVideoInteractions(profileId),
    config
  });
  let poolHealth = describePoolHealth({
    videos: poolVideos,
    watchedVideoIds,
    excludeVideoIds,
    interactions: getVideoInteractions(profileId),
    config
  });
  const expandedPool = false;

  const prunedVideos = options.readOnlyPool
    ? []
    : prunePool(profileId, poolKey, poolVideos, config.feed.poolSizeCap);

  observation.operations.push({
    name: "feed.phase6.pruning",
    durationMs: 0,
    status: "ok",
    input: { poolVideos: poolVideos.length, poolSizeCap: config.feed.poolSizeCap },
    output: { prunedVideos: prunedVideos.length }
  });

  if (prunedVideos.length > 0) {
    poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
    recordScoringObservation(observation, profileId, poolVideos, "afterPruning");
    readyPreview = createCandidatePoolFeed({
      rootVideos: poolVideos.filter((video) => video.sourceNodeId === "tagSearch"),
      channelVideos: poolVideos.filter((video) => video.sourceNodeId === "channelVideos"),
      relatedVideos: poolVideos.filter((video) => video.sourceNodeId === "relatedVideos"),
      watchedVideoIds,
      excludeVideoIds,
      interactions: getVideoInteractions(profileId),
      config
    });
    poolHealth = describePoolHealth({
      videos: poolVideos,
      watchedVideoIds,
      excludeVideoIds,
      interactions: getVideoInteractions(profileId),
      config
    });
  }

  if (!options.readOnlyPool && poolHealth.freshRatio < preemptiveExpansionFreshRatioThreshold) {
    schedulePreemptiveExpansion(profileId, poolKey);
  }

  logTopServingItems(profileId, poolKey, readyPreview.videos, config, observation.requestId);

  const fastLaneVideos = options.readOnlyPool
    ? []
    : await getSubscriptionFastLaneVideos(
        channels,
        channelSort,
        observation,
        profileId,
        watchedVideoIds
      );
  const poolRecommendations = hydrateChannelAvatars(readyPreview.videos).slice(0, config.feed.maxVideos);
  const videos = hydrateChannelAvatars([...fastLaneVideos, ...poolRecommendations]).slice(0, config.feed.maxVideos);

  await retainReadyQueueEmbeddings(profileId, videos, observation, options.expectedProfileUpdatedAt);
  ensureProfileCurrent(profileId, options.expectedProfileUpdatedAt);
  const upNextByVideoId = buildUpNextByVideoId(profileId, videos);

  observation.operations.push({
    name: "feed.phase5.serving",
    durationMs: 0,
    status: "ok",
    input: {
      maxVideos: config.feed.maxVideos,
      excludedClientVideos: excludeVideoIds.size
    },
    output: {
      fastLaneVideos: fastLaneVideos.length,
      poolVideos: poolRecommendations.length,
      finalVideos: videos.length,
      upNextLists: Object.keys(upNextByVideoId).length,
      poolHealth
    }
  });

  const poolState = getFeedPoolState(profileId, poolKey);
  const pool = {
    key: poolKey,
    videos: poolState?.poolVideos || poolVideos.length,
    targetVideos: config.feed.poolSizeCap,
    health: poolHealth,
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
    pool,
    upNextByVideoId
  };
}

export async function expandFeedPoolForImpressions(
  profileId: string,
  tags: string[],
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation,
  options: Pick<CreateFeedOptions, "expectedProfileUpdatedAt" | "watchedVideoIds"> = {}
) {
  ensureProfileCurrent(profileId, options.expectedProfileUpdatedAt);

  const queries = createQueries(tags);
  const config = getGretelConfig();
  const poolKey = createFeedPoolKey({ tags: queries, channels, channelSort });
  const poolState = getFeedPoolState(profileId, poolKey);
  const watchedVideoIds = new Set(options.watchedVideoIds || []);

  if (!poolState) {
    observation.operations.push({
      name: "feed.phase2.expansion_skipped",
      durationMs: 0,
      status: "ok",
      input: { poolVideos: 0 },
      output: { reason: "missing_pool" }
    });
    return { expandedPool: false, poolKey, poolVideos: 0 };
  }

  let poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
  recordScoringObservation(observation, profileId, poolVideos, "impressionTrigger");
  const poolHealth = describePoolHealth({
    videos: poolVideos,
    watchedVideoIds,
    excludeVideoIds: new Set(),
    interactions: getVideoInteractions(profileId),
    config
  });

  if (!poolHealth.needsExpansion) {
    observation.operations.push({
      name: "feed.phase2.expansion_skipped",
      durationMs: 0,
      status: "ok",
      input: {
        poolVideos: poolVideos.length,
        freshRatio: poolHealth.freshRatio
      },
      output: { reason: "healthy_pool" }
    });
    return { expandedPool: false, poolKey, poolVideos: poolVideos.length };
  }

  const expandedPool = await expandPool(
    profileId,
    poolKey,
    poolVideos,
    observation,
    options.expectedProfileUpdatedAt,
    { bypassCooldown: true }
  );

  if (expandedPool) {
    poolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
    prunePool(profileId, poolKey, poolVideos, config.feed.poolSizeCap);
  }

  return { expandedPool, poolKey, poolVideos: poolVideos.length };
}

function getGlobalServingSessions() {
  const globalKey = "__gretelFeedServingSessions";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, FeedServingSession>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, FeedServingSession>();
  }

  return globalScope[globalKey];
}

function getGlobalPreemptiveExpansionState() {
  const globalKey = "__gretelPreemptiveExpansionInFlight";
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: Set<string>;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Set<string>();
  }

  return globalScope[globalKey];
}

function getOrCreateServingSession(
  sessionId: string | undefined,
  profileId: string,
  poolKey: string,
  servedVideoIds: string[] = []
) {
  pruneServingSessions();

  if (sessionId) {
    const existing = feedServingSessions.get(sessionId);

    if (existing && existing.profileId === profileId && existing.poolKey === poolKey) {
      return existing;
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const session: FeedServingSession = {
    id,
    profileId,
    poolKey,
    servedVideoIds: new Set(servedVideoIds),
    createdAt: now,
    updatedAt: now
  };

  feedServingSessions.set(id, session);
  return session;
}

function pruneServingSessions() {
  const cutoff = Date.now() - feedServingSessionTtlMs;

  for (const [sessionId, session] of feedServingSessions) {
    if (session.updatedAt < cutoff) {
      feedServingSessions.delete(sessionId);
    }
  }
}

async function initializePoolOnce(
  profileId: string,
  poolKey: string,
  queries: string[],
  channels: string[],
  channelSort: ChannelSort,
  observation: FeedObservation,
  expectedProfileUpdatedAt?: number
) {
  const existingState = getFeedPoolState(profileId, poolKey);
  const existingCentroid = getCentroid(profileId, poolKey);

  if (existingState && existingCentroid) {
    return false;
  }

  const timestamp = Date.now();
  const config = getGretelConfig();
  const discoveredRootVideos = queries.length > 0
    ? await searchVideos(queries, observation, profileId, config.expansion.initialFetchSize)
    : [];
  const discoveredRootEmbeddings = await embedVideos(profileId, discoveredRootVideos);
  const rootFilter = filterEmbeddingOutliers(discoveredRootVideos, discoveredRootEmbeddings);
  const rootVideos = rootFilter.videos;
  const rootEmbeddings = rootFilter.embeddings;
  const originalCentroid = averageNormalizedVectors(
    rootVideos.flatMap((video) => {
      const embedding = rootEmbeddings.get(video.id);
      return embedding ? [embedding] : [];
    })
  );
  const scoredRoots = scoreByCentroid(rootVideos, rootEmbeddings, originalCentroid, "tagSearch");

  observation.operations.push({
    name: "feed.phase1.roots",
    durationMs: 0,
    status: "ok",
    input: { queries: queries.length },
    output: {
      discoveredVideos: discoveredRootVideos.length,
      filteredByEmbeddingVariance: rootFilter.filteredVideos,
      filteredVideos: rootVideos.length,
      embeddedVideos: rootEmbeddings.size,
      centroidCompleted: originalCentroid.length > 0
    }
  });

  ensureProfileCurrent(profileId, expectedProfileUpdatedAt);
  markRootDiscovered(profileId, poolKey, timestamp);
  saveCentroid(profileId, poolKey, originalCentroid, originalCentroid);
  retainVideoEmbeddings(profileId, scoredRoots, rootEmbeddings);
  addPoolNodes(profileId, poolKey, "tagSearch", scoredRoots, timestamp);

  const channelCandidates = channels.length > 0
    ? await fetchChannelVideos(channels, channelSort, observation, profileId, config.expansion.initialFetchSize)
    : [];
  const channelEmbeddings = await embedVideos(profileId, channelCandidates);
  const channelPoolVideos = scoreByCentroid(
    persistentChannelCandidates(profileId, channelCandidates),
    channelEmbeddings,
    originalCentroid,
    "channelVideos"
  ).filter((video) => (video.similarityScore || 0) >= getGretelConfig().feed.similarityThreshold);

  observation.operations.push({
    name: "feed.phase1.channels",
    durationMs: 0,
    status: "ok",
    input: { channels: channels.length, candidates: channelCandidates.length },
    output: {
      embeddedVideos: channelEmbeddings.size,
      admittedVideos: channelPoolVideos.length,
      filteredByCentroid: channelCandidates.length - channelPoolVideos.length
    }
  });

  ensureProfileCurrent(profileId, expectedProfileUpdatedAt);
  addPoolNodes(profileId, poolKey, "channelVideos", channelPoolVideos, timestamp);

  return true;
}

function persistentChannelCandidates(profileId: string, videos: FeedVideo[]) {
  const config = getGretelConfig();
  const fastLaneCap = config.feed.subscriptionFastLanePerSession;

  if (fastLaneCap === 0) {
    return videos;
  }

  const fastLaneIds = new Set(
    selectSubscriptionFastLaneVideos(
      videos,
      profileId,
      new Set(getWatchedVideoIds(profileId)),
      config
    ).map((video) => video.id)
  );
  return videos.filter((video) => !fastLaneIds.has(video.id));
}

async function expandPool(
  profileId: string,
  poolKey: string,
  poolVideos: FeedVideo[],
  observation: FeedObservation,
  expectedProfileUpdatedAt?: number,
  options: { bypassCooldown?: boolean } = {}
) {
  const config = getGretelConfig();
  const poolState = getFeedPoolState(profileId, poolKey);
  const now = Date.now();

  if (!options.bypassCooldown && poolState && now - poolState.lastExpandedAt < config.expansion.cycleCooldownMs) {
    observation.operations.push({
      name: "feed.phase2.expansion_skipped",
      durationMs: 0,
      status: "ok",
      input: {
        poolVideos: poolVideos.length,
        cycleCooldownMs: config.expansion.cycleCooldownMs
      },
      output: { reason: "cooldown" }
    });
    return false;
  }

  const interactions = getVideoInteractions(profileId);
  const centroid = getCentroid(profileId, poolKey)?.current || [];
  const scoredPool = poolVideos.map((video) => applyEngagement(video, interactions, config));
  const seeds = selectExpansionSeeds({ videos: scoredPool, interactions, config });
  let admittedVideos = 0;

  if (seeds.length === 0) {
    return false;
  }

  await observeOperation(
    observation,
    "feed.phase2.expansion",
    {
      poolVideos: poolVideos.length,
      seeds: seeds.length,
      warmStart: interactions.size >= config.feed.coldStartInteractionThreshold
    },
    async () => {
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
      const visitedVideoIds = getVisitedVideoIds(profileId, poolKey);
      const newCandidates = rawRelatedVideos.filter((video) => !visitedVideoIds.has(video.id));
      const embeddings = await embedVideos(profileId, newCandidates);
      const parentScores = new Map(seeds.map((seed) => [seed.id, seed.engagementScore || 0]));
      const relatedVideos = scoreByCentroid(newCandidates, embeddings, centroid, "relatedVideos")
        .map((video) => ({
          ...video,
          parentEngagementScore: parentScores.get(video.parent_video_id || "") || 0
        }))
        .filter((video) => (video.similarityScore || 0) >= config.feed.similarityThreshold);
      admittedVideos = relatedVideos.length;

      ensureProfileCurrent(profileId, expectedProfileUpdatedAt);
      retainVideoEmbeddings(profileId, relatedVideos, embeddings);
      addPoolNodes(profileId, poolKey, "relatedVideos", relatedVideos, Date.now());
      markPoolExpanded(profileId, poolKey, Date.now());

      return {
        value: undefined,
        output: {
          fetchedCandidates: rawRelatedVideos.length,
          skippedVisited: rawRelatedVideos.length - newCandidates.length,
          embeddedCandidates: embeddings.size,
          retainedEmbeddings: relatedVideos.length,
          admittedVideos: relatedVideos.length,
          filteredByCentroid: newCandidates.length - relatedVideos.length
        }
      };
    }
  );

  return admittedVideos >= config.expansion.minExpansionYield;
}

function schedulePreemptiveExpansion(
  profileId: string,
  poolKey: string
) {
  const stateKey = `${profileId}:${poolKey}`;

  if (preemptiveExpansionInFlight.has(stateKey)) {
    return;
  }

  preemptiveExpansionInFlight.add(stateKey);

  void (async () => {
    const observation = createFeedObservation();

    try {
      const currentPoolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
      await expandPool(profileId, poolKey, currentPoolVideos, observation, undefined, {
        bypassCooldown: true
      });
      let rescoredPoolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
      prunePool(profileId, poolKey, rescoredPoolVideos, getGretelConfig().feed.poolSizeCap);
      rescoredPoolVideos = scorePoolVideos(profileId, poolKey, listPoolNodes(profileId, poolKey));
      recordScoringObservation(observation, profileId, rescoredPoolVideos, "preemptiveServingExpansion");
      logFeedObservation(observation, {
        trigger: "serve_feed_page_preemptive",
        profileId,
        poolKey,
        poolVideos: rescoredPoolVideos.length
      });
    } catch (expansionError) {
      logFeedObservation(observation, {
        trigger: "serve_feed_page_preemptive",
        profileId,
        poolKey,
        poolVideos: listPoolNodes(profileId, poolKey).length,
        errorMessage: expansionError instanceof Error ? expansionError.message : String(expansionError)
      });
    } finally {
      preemptiveExpansionInFlight.delete(stateKey);
    }
  })();
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

  return selectSubscriptionFastLaneVideos(videos, profileId, watchedVideoIds, config);
}

function selectSubscriptionFastLaneVideos(
  videos: FeedVideo[],
  profileId: string,
  watchedVideoIds: Set<string>,
  config: ReturnType<typeof getGretelConfig>
) {
  const impressionCounts = getVideoImpressionCounts(profileId);

  return videos
    .filter((video) => !watchedVideoIds.has(video.id))
    .map((video, index) => {
      const impressionCount = impressionCounts.get(video.id) || 0;
      const baseScore = videos.length - index;
      const penalty = impressionCount * config.serving.fastLaneImpressionPenaltyFactor;

      return {
        video,
        score: penalty === 0 ? baseScore : baseScore / (1 + penalty),
        impressionCount
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, config.feed.subscriptionFastLanePerSession)
    .map(({ video, impressionCount }) => ({
      ...video,
      impressionCount,
      sourceNodeId: "channelVideos" as const,
      sourceNodeLabel: "Subscription fast lane"
    }));
}

function scorePoolVideos(profileId: string, poolKey: string, videos: FeedVideo[]) {
  const config = getGretelConfig();
  const centroid = getCentroid(profileId, poolKey)?.current || [];
  const interactions = getVideoInteractions(profileId);
  const impressionCounts = getVideoImpressionCounts(profileId);
  const rescored = rescoreCachedVideos(profileId, videos, centroid).map((video) =>
    applyEngagement(
      {
        ...video,
        impressionCount: impressionCounts.get(video.id) || video.impressionCount || 0
      },
      interactions,
      config
    )
  );

  updatePoolSimilarities(profileId, poolKey, rescored);

  return hydrateChannelAvatars(rescored);
}

function recordScoringObservation(
  observation: FeedObservation,
  profileId: string,
  videos: FeedVideo[],
  reason: string
) {
  const config = getGretelConfig();
  const interactions = getVideoInteractions(profileId);
  const scoredVideos = videos.filter((video) => typeof video.engagementScore === "number");

  observation.operations.push({
    name: "feed.phase3.scoring",
    durationMs: 0,
    status: "ok",
    input: {
      reason,
      poolVideos: videos.length,
      interactions: interactions.size
    },
    output: {
      coldStart: interactions.size < config.feed.coldStartInteractionThreshold,
      scoredVideos: scoredVideos.length
    }
  });
}

function logTopServingItems(
  profileId: string,
  poolKey: string,
  videos: FeedVideo[],
  config: ReturnType<typeof getGretelConfig>,
  requestId: string
) {
  const interactions = getVideoInteractions(profileId);
  const isColdStart = interactions.size < config.feed.coldStartInteractionThreshold;

  logInfo("feed.top_items", {
    profileId,
    poolKey,
    requestId,
    coldStart: isColdStart,
    parameters: {
      coldStartInteractionThreshold: config.feed.coldStartInteractionThreshold,
      warmSemanticWeight: config.serving.warmSemanticWeight,
      impressionPenaltyFactor: config.serving.impressionPenaltyFactor,
      fastLaneImpressionPenaltyFactor: config.serving.fastLaneImpressionPenaltyFactor,
      coldStartParentEngagementWeight: config.feed.coldStartParentEngagementWeight
    },
    topItems: videos.slice(0, 10).map((video, index) => {
      const score = describeServingScore(video, config, isColdStart);

      return {
        rank: index + 1,
        id: video.id,
        title: video.title,
        author: video.author,
        sourceNodeId: video.sourceNodeId,
        score: score.score,
        baseScore: score.baseScore,
        semanticScore: score.semanticScore,
        semanticContribution: score.semanticContribution,
        engagementScore: score.engagementScore,
        engagementContribution: score.engagementContribution,
        parentEngagementScore: score.parentEngagementScore,
        impressionCount: score.impressionCount,
        impressionDecay: score.impressionDecay,
        weights: score.weights,
        mode: score.mode
      };
    })
  });
}

async function embedVideos(profileId: string, videos: FeedVideo[]) {
  const config = getGretelConfig();
  const provider = getEmbeddingProvider(config);
  const embeddings = new Map<string, number[]>();

  for (let index = 0; index < videos.length; index += config.embeddings.batchSize) {
    const batch = videos.slice(index, index + config.embeddings.batchSize);
    const texts = await Promise.all(
      batch.map(async (video) => {
        const transcriptIntroduction = await fetchTranscriptIntroduction(profileId, video.id, config);
        return transcriptIntroduction
          ? createEmbeddingInputWithTranscript(video, transcriptIntroduction)
          : createEmbeddingInput(video);
      })
    );
    const vectors = await provider.embedTexts(texts);

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

function filterEmbeddingOutliers(videos: FeedVideo[], embeddings: Map<string, number[]>) {
  if (videos.length < 3 || embeddings.size < 3) {
    return { videos, embeddings, filteredVideos: 0 };
  }

  const centroid = averageNormalizedVectors(
    videos.flatMap((video) => {
      const embedding = embeddings.get(video.id);
      return embedding ? [embedding] : [];
    })
  );

  if (centroid.length === 0) {
    return { videos, embeddings, filteredVideos: 0 };
  }

  const distances = videos.map((video) => {
    const embedding = embeddings.get(video.id);
    return embedding ? 1 - cosineSimilarity(embedding, centroid) : 1;
  });
  const mean = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  const variance = distances.reduce((sum, distance) => sum + (distance - mean) ** 2, 0) / distances.length;
  const maxDistance = mean + Math.sqrt(variance);
  const keptVideos = videos.filter((_video, index) => distances[index] <= maxDistance);
  const keptIds = new Set(keptVideos.map((video) => video.id));
  const keptEmbeddings = new Map(
    [...embeddings].filter(([videoId]) => keptIds.has(videoId))
  );

  return {
    videos: keptVideos,
    embeddings: keptEmbeddings,
    filteredVideos: videos.length - keptVideos.length
  };
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

async function retainReadyQueueEmbeddings(
  profileId: string,
  videos: FeedVideo[],
  observation: FeedObservation,
  expectedProfileUpdatedAt?: number
) {
  const missingVideos = videos.filter((video) => !getRetainedEmbedding(profileId, video.id));

  if (missingVideos.length === 0) {
    observation.operations.push({
      name: "feed.phase5.ready_embeddings",
      durationMs: 0,
      status: "ok",
      input: { readyVideos: videos.length },
      output: { embeddedVideos: 0, retainedEmbeddings: 0 }
    });
    return;
  }

  const embeddings = await embedVideos(profileId, missingVideos);
  ensureProfileCurrent(profileId, expectedProfileUpdatedAt);
  retainVideoEmbeddings(profileId, missingVideos, embeddings);
  observation.operations.push({
    name: "feed.phase5.ready_embeddings",
    durationMs: 0,
    status: "ok",
    input: { readyVideos: videos.length, missingEmbeddings: missingVideos.length },
    output: { embeddedVideos: embeddings.size, retainedEmbeddings: embeddings.size }
  });
}

function buildUpNextByVideoId(profileId: string, videos: FeedVideo[]) {
  const embeddings = new Map<string, number[]>();

  for (const video of videos) {
    const embedding = getRetainedEmbedding(profileId, video.id);

    if (embedding) {
      embeddings.set(video.id, embedding);
    }
  }

  return Object.fromEntries(
    videos.map((video) => [
      video.id,
      selectUpNextCandidates({
        currentVideo: video,
        candidates: videos.filter((candidate) => candidate.id !== video.id),
        embeddings
      }).map((candidate) => candidate.id)
    ])
  );
}

function ensureProfileCurrent(profileId: string, expectedUpdatedAt?: number) {
  const profile = getProfile(profileId);

  if (!profile || (expectedUpdatedAt !== undefined && profile.updatedAt !== expectedUpdatedAt)) {
    throw new FeedProfileStaleError();
  }
}
