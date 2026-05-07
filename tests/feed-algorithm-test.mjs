import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, ".tmp", "feed-algorithm-test");
const workDir = path.join(os.tmpdir(), `gretel-feed-algorithm-${process.pid}`);
const configDir = path.join(workDir, "config");
const require = createRequire(import.meta.url);
let profileStoreForCleanup = null;
let originalCwd = process.cwd();

before(() => {
  compileModules();
  mkdirSync(configDir, { recursive: true });
  process.chdir(workDir);
});

after(() => {
  process.chdir(originalCwd);
  try {
    profileStoreForCleanup?.getDatabase?.().close?.();
  } catch {}
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(workDir, { force: true, recursive: true });
});

test("root discovery filters titles, stores a unit centroid, and gates channel videos by centroid similarity", async () => {
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchResults: [
        rawVideo("root-alpha-1", "alpha root one", "Search"),
        rawVideo("root-alpha-outlier", "alpha soap update", "Search"),
        { type: "Channel", id: "channel-card", title: "alpha channel card" },
        rawVideo("root-no-match", "unrelated cooking", "Search"),
        rawVideo("root-alpha-2", "second alpha root", "Search")
      ],
      channelVideos: [
        rawVideo("channel-above", "channel above", "Creator One"),
        rawVideo("channel-below", "channel below", "Creator One")
      ]
    }),
    embeddingForText: rootDiscoveryEmbedding
  });
  const profile = modules.profileStore.createProfile("Root Discovery");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("root-discovery.json", {
      feed: {
        maxQueries: 1,
        maxVideos: 8,
        minVideosPerQuery: 2,
        minVideosPerChannel: 2,
        similarityThreshold: 0.75,
        readyQueueLowWaterMark: 0,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    const feed = await modules.service.createFeed(
      profile.id,
      ["alpha"],
      ["Creator One"],
      "mixed",
      observation(),
      { servingOnly: true }
    );
    const poolKey = modules.poolStore.createFeedPoolKey({
      tags: feed.queries,
      channels: ["Creator One"],
      channelSort: "mixed"
    });
    const nodes = modules.poolStore.listPoolNodes(profile.id, poolKey);
    const roots = nodes.filter((video) => video.sourceNodeId === "tagSearch");
    const channels = nodes.filter((video) => video.sourceNodeId === "channelVideos");
    const centroid = modules.algorithmStore.getCentroid(profile.id, poolKey).current;

    assert.equal(roots.length, 2);
    assert.equal(roots.every((video) => /alpha/i.test(video.title)), true);
    assert.equal(roots.some((video) => video.id === "root-alpha-outlier"), false);
    assert.equal(magnitude(centroid), 1);
    assert.deepEqual(channels.map((video) => video.id), ["channel-above"]);
    assert.equal(
      channels[0].similarityScore,
      modules.vectorMath.cosineSimilarity(rootDiscoveryEmbedding("channel above"), centroid)
    );
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("pool expansion budgets by score, skips visited videos, enforces threshold, and records parent IDs", async () => {
  const config = testConfig({
    feed: {
      maxRelatedVideosPerSeed: 8,
      minRelatedVideosPerSeed: 1,
      similarityThreshold: 0.75
    }
  });
  const { relatedBudgetForSeed } = require(path.join(buildDir, "lib", "feed", "pool.js"));
  const seeds = [
    video("high", { engagementScore: 1 }),
    video("mid", { engagementScore: 0.5 }),
    video("low", { engagementScore: 0.1 })
  ];

  assert.deepEqual(
    seeds.map((seed) => relatedBudgetForSeed(seed, seeds, config, true)),
    [8, 4, 1]
  );

  const calls = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: [rawVideo("root-alpha", "alpha root", "Search")],
      infoForSeed(seedId) {
        calls.push(seedId);
        return [
          rawVideo("root-alpha", "duplicate above threshold", "Related"),
          rawVideo("related-above", "related above", "Related"),
          rawVideo("related-below", "related below", "Related")
        ];
      }
    }),
    embeddingForText(text) {
      if (/below/i.test(text)) {
        return [0, 1];
      }
      return [1, 0];
    }
  });
  const profile = modules.profileStore.createProfile("Expansion");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("expansion.json", {
      feed: {
        maxQueries: 1,
        maxVideos: 8,
        minVideosPerQuery: 1,
        similarityThreshold: 0.75,
        readyQueueLowWaterMark: 20,
        recommendationSeeds: 1,
        expansionSeedCount: 1,
        minRelatedVideosPerSeed: 3,
        maxRelatedVideosPerSeed: 3,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    const feed = await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      forceExpansion: true
    });
    const poolKey = modules.poolStore.createFeedPoolKey({
      tags: feed.queries,
      channels: [],
      channelSort: "mixed"
    });
    const related = modules.poolStore
      .listPoolNodes(profile.id, poolKey)
      .filter((node) => node.sourceNodeId === "relatedVideos");

    assert.deepEqual(calls, ["root-alpha"]);
    assert.equal(related.some((node) => node.id === "root-alpha"), false);
    assert.deepEqual(related.map((node) => node.id), ["related-above"]);
    assert.equal(related[0].parent_video_id, "root-alpha");
    assert.deepEqual(modules.algorithmStore.getRetainedEmbedding(profile.id, "related-above"), [1, 0]);
    assert.equal(modules.algorithmStore.getRetainedEmbedding(profile.id, "related-below"), null);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("stale expansion stops when the profile is deleted before related videos are stored", async () => {
  let modules;
  let profile;
  const client = createFakeYoutubeClient({
    searchVideos: [rawVideo("root-alpha", "alpha root", "Search")],
    infoForSeed(seedId) {
      if (seedId === "root-alpha") {
        modules.profileStore.deleteProfile(profile.id);
        return [rawVideo("related-alpha", "related alpha", "Related")];
      }

      return [];
    }
  });
  modules = loadRuntimeModules({
    youtubeClient: client,
    embeddingForText: () => [1, 0]
  });
  profile = modules.profileStore.createProfile("Deleted During Expansion");
  profileStoreForCleanup = modules.profileStore;

  process.env.GRETEL_CONFIG = writeConfig("deleted-during-expansion.json", {
    feed: {
      maxQueries: 1,
      maxVideos: 8,
      minVideosPerQuery: 1,
      similarityThreshold: 0.75,
      readyQueueLowWaterMark: 20,
      recommendationSeeds: 1,
      expansionSeedCount: 1,
      minRelatedVideosPerSeed: 1,
      maxRelatedVideosPerSeed: 1,
      subscriptionFastLanePerSession: 0
    },
    embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
  });

  await assert.rejects(
    modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      forceExpansion: true
    }),
    modules.service.FeedProfileStaleError
  );
  assert.equal(modules.profileStore.getProfile(profile.id), null);
});

test("initial pool build uses configurable fetch size instead of serving page size", async () => {
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: Array.from({ length: 10 }, (_, index) =>
        rawVideo(`root-alpha-${index}`, `alpha root ${index}`, "Search")
      )
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Initial Fetch Size");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("initial-fetch-size.json", {
      expansion: {
        initialFetchSize: 5,
        servedMajorityThreshold: 1
      },
      feed: {
        maxQueries: 1,
        maxVideos: 2,
        minVideosPerQuery: 1,
        readyQueueLowWaterMark: 0,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    const feed = await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      servingOnly: true
    });
    const poolKey = modules.poolStore.createFeedPoolKey({
      tags: feed.queries,
      channels: [],
      channelSort: "mixed"
    });
    const roots = modules.poolStore
      .listPoolNodes(profile.id, poolKey)
      .filter((node) => node.sourceNodeId === "tagSearch");

    assert.equal(roots.length, 5);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("reactive expansion fires when served majority threshold is crossed", async () => {
  const infoSeeds = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: Array.from({ length: 4 }, (_, index) =>
        rawVideo(`root-alpha-${index}`, `alpha root ${index}`, "Search")
      ),
      infoForSeed(seedId) {
        infoSeeds.push(seedId);
        return [rawVideo(`related-${seedId}`, "related alpha", "Related")];
      }
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Reactive Expansion");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("reactive-expansion.json", {
      expansion: {
        initialFetchSize: 4,
        minDelayBetweenFetchesMs: 0,
        maxFetchCallsPerCycle: 1,
        cycleCooldownMs: 0,
        servedMajorityThreshold: 0.4
      },
      feed: {
        maxQueries: 1,
        maxVideos: 2,
        minVideosPerQuery: 1,
        recommendationSeeds: 1,
        expansionSeedCount: 1,
        readyQueueLowWaterMark: 0,
        subscriptionFastLanePerSession: 0,
        similarityThreshold: 0.75
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    const feed = await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      servingOnly: true
    });
    const poolKey = modules.poolStore.createFeedPoolKey({
      tags: feed.queries,
      channels: [],
      channelSort: "mixed"
    });
    const related = modules.poolStore
      .listPoolNodes(profile.id, poolKey)
      .filter((node) => node.sourceNodeId === "relatedVideos");

    assert.equal(feed.pool.expandedPool, true);
    assert.equal(infoSeeds.length, 1);
    assert.equal(related.length, 1);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("expansion caps fetch calls per cycle", async () => {
  const infoSeeds = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      infoForSeed(seedId) {
        infoSeeds.push(seedId);
        return [rawVideo(`related-${seedId}`, "related alpha", "Related")];
      }
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Expansion Fetch Cap");
  profileStoreForCleanup = modules.profileStore;
  const poolKey = modules.poolStore.createFeedPoolKey({
    tags: [],
    channels: [],
    channelSort: "mixed"
  });

  try {
    process.env.GRETEL_CONFIG = writeConfig("fetch-cap.json", {
      expansion: {
        minDelayBetweenFetchesMs: 0,
        maxFetchCallsPerCycle: 2,
        cycleCooldownMs: 0,
        servedMajorityThreshold: 1
      },
      feed: {
        maxVideos: 12,
        recommendationSeeds: 4,
        expansionSeedCount: 4,
        readyQueueLowWaterMark: 20,
        subscriptionFastLanePerSession: 0,
        similarityThreshold: 0.75
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });
    modules.poolStore.markRootDiscovered(profile.id, poolKey, Date.now());
    modules.algorithmStore.saveCentroid(profile.id, poolKey, [1, 0], [1, 0]);
    modules.poolStore.addPoolNodes(
      profile.id,
      poolKey,
      "tagSearch",
      [
        video("seed-1", { similarityScore: 1, engagementScore: 1 }),
        video("seed-2", { similarityScore: 1, engagementScore: 0.9 }),
        video("seed-3", { similarityScore: 1, engagementScore: 0.8 }),
        video("seed-4", { similarityScore: 1, engagementScore: 0.7 })
      ],
      Date.now()
    );

    await modules.service.createFeed(profile.id, [], [], "mixed", observation(), {
      forceExpansion: true
    });

    assert.deepEqual(infoSeeds, ["seed-1", "seed-2"]);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("embedding input includes configured transcript introduction when available", async () => {
  const embeddedTexts = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: [rawVideo("root-alpha", "alpha root", "Search")],
      transcriptForVideo() {
        return "intro context should influence embedding ignored tail";
      }
    }),
    embeddingForText(text) {
      embeddedTexts.push(text);
      return text.includes("intro context") ? [1, 0] : [0, 1];
    }
  });
  const profile = modules.profileStore.createProfile("Transcript Embedding");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("transcript-embedding.json", {
      transcription: {
        introductionPercentage: 0.5,
        maxCharacters: 30
      },
      expansion: {
        servedMajorityThreshold: 1
      },
      feed: {
        maxQueries: 1,
        maxVideos: 1,
        minVideosPerQuery: 1,
        readyQueueLowWaterMark: 0,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      servingOnly: true
    });

    assert.equal(embeddedTexts.some((text) => text.includes("intro context")), true);
    assert.deepEqual(modules.algorithmStore.getRetainedEmbedding(profile.id, "root-alpha"), [1, 0]);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("scoring computes engagement, nonlinear ignore decay, accumulated interactions, and cold/warm ordering", () => {
  const { computeEngagementScore, applyEngagement } = require(path.join(
    buildDir,
    "lib",
    "feed",
    "engagement.js"
  ));
  const { createCandidatePoolFeed, selectExpansionSeeds } = require(path.join(
    buildDir,
    "lib",
    "feed",
    "pool.js"
  ));
  const config = testConfig({
    feed: {
      coldStartInteractionThreshold: 2,
      readyQueueTargetSize: 10,
      expansionSeedCount: 10,
      coldStartParentEngagementWeight: 0.5
    },
    learning: {
      watchTimeWeight: 0.5,
      likedWeight: 0.3,
      clickedWeight: 0.2,
      ignorePenaltyBase: 0.2,
      ignorePenaltyGrowth: 1.8
    }
  });

  assert.equal(
    computeEngagementScore(
      { watchTimeRatio: 0.5, liked: true, clicked: true, ignoreCount: 2 },
      config.learning
    ),
    0.5 * 0.5 + 0.3 + 0.2 - 0.2 * 1.8
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((ignoreCount) =>
      computeEngagementScore({ watchTimeRatio: 0, liked: false, clicked: false, ignoreCount }, config.learning)
    ),
    [1, 2, 3, 4, 5, 6].map((ignoreCount) => -(0.2 * 1.8 ** (ignoreCount - 1)))
  );
  assert.equal(
    applyEngagement(
      video("interacted"),
      new Map([
        ["interacted", { videoId: "interacted", watchTimeRatio: 0.4, liked: true, clicked: true, ignoreCount: 1 }]
      ]),
      config
    ).engagementScore,
    0.4 * 0.5 + 0.3 + 0.2 - 0.2
  );

  const pool = [
    video("centroid-best", { similarityScore: 0.95, engagementScore: 0.1 }),
    video("engagement-best", { similarityScore: 0.2, engagementScore: 1.2 })
  ];
  assert.deepEqual(
    selectExpansionSeeds({ videos: pool, interactions: new Map(), config }).map((node) => node.id),
    ["centroid-best", "engagement-best"]
  );
  assert.deepEqual(
    selectExpansionSeeds({
      videos: pool,
      interactions: new Map([
        ["a", { videoId: "a", watchTimeRatio: 1, liked: false, clicked: false, ignoreCount: 0 }],
        ["b", { videoId: "b", watchTimeRatio: 1, liked: false, clicked: false, ignoreCount: 0 }]
      ]),
      config
    }).map((node) => node.id),
    ["engagement-best", "centroid-best"]
  );

  const feed = createCandidatePoolFeed({
    rootVideos: pool,
    channelVideos: [],
    relatedVideos: [],
    watchedVideoIds: new Set(),
    interactions: new Map(),
    config
  });
  assert.deepEqual(feed.videos.map((node) => node.id), ["centroid-best", "engagement-best"]);

  const warmFeed = createCandidatePoolFeed({
    rootVideos: [
      video("already-seen", { similarityScore: 1, parentEngagementScore: 1, impressionCount: 1 }),
      video("semantic-boost", { similarityScore: 1, parentEngagementScore: 0.5 }),
      video("low-semantic", { similarityScore: 0, parentEngagementScore: 0.6 })
    ],
    channelVideos: [],
    relatedVideos: [],
    watchedVideoIds: new Set(),
    interactions: new Map([
      ["a", { videoId: "a", watchTimeRatio: 1, liked: false, clicked: false, ignoreCount: 0 }],
      ["b", { videoId: "b", watchTimeRatio: 1, liked: false, clicked: false, ignoreCount: 0 }]
    ]),
    config: testConfig({
      serving: {
        servedPenaltyFactor: 1,
        warmSemanticWeight: 0.5
      },
      feed: {
        coldStartInteractionThreshold: 2,
        readyQueueTargetSize: 10
      }
    })
  });
  assert.deepEqual(
    warmFeed.videos.map((node) => node.id),
    ["semantic-boost", "already-seen", "low-semantic"]
  );
});

test("logs the top serving items with score breakdown and serving parameters", async () => {
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: [
        rawVideo("root-a", "alpha one", "Search"),
        rawVideo("root-b", "alpha two", "Search"),
        rawVideo("root-c", "alpha three", "Search")
      ]
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Top Serving Items");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("top-serving-items.json", {
      serving: {
        servedPenaltyFactor: 0.2,
        warmSemanticWeight: 0.25
      },
      expansion: {
        initialFetchSize: 3,
        minDelayBetweenFetchesMs: 0,
        maxFetchCallsPerCycle: 1,
        cycleCooldownMs: 0,
        servedMajorityThreshold: 1
      },
      feed: {
        maxQueries: 1,
        maxVideos: 1,
        readyQueueTargetSize: 10,
        coldStartInteractionThreshold: 1,
        similarityThreshold: 0.1,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });

    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("root-a"),
      watchedSeconds: 30,
      durationSeconds: 60
    });
    modules.profileStore.likeVideo(profile.id, video("root-a"));
    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("root-b"),
      watchedSeconds: 48,
      durationSeconds: 60
    });
    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("root-c"),
      watchedSeconds: 12,
      durationSeconds: 60
    });
    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("warmup"),
      watchedSeconds: 60,
      durationSeconds: 60
    });

    await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      servingOnly: true
    });
    modules.profileStore.recordVideoImpressions(profile.id, ["root-a"]);

    const logs = await captureConsoleLogs(async () => {
      await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
        servingOnly: true
      });
    });
    const topItemsLog = logs.find((log) => log.line.event === "feed.top_items")?.line;

    assert.ok(topItemsLog);
    assert.equal(topItemsLog.coldStart, false);
    assert.equal(topItemsLog.parameters.warmSemanticWeight, 0.25);
    assert.equal(topItemsLog.parameters.servedPenaltyFactor, 0.2);
    assert.equal(topItemsLog.parameters.fastLaneImpressionPenaltyFactor, 0.08);
    assert.equal(topItemsLog.parameters.coldStartInteractionThreshold, 1);
    assert.equal(topItemsLog.topItems.length, 3);
    assert.equal(topItemsLog.topItems[0].id, "root-a");
    assert.equal(topItemsLog.topItems[0].impressionCount, 1);
    assert.equal(topItemsLog.topItems[0].semanticScore, 1);
    assert.equal(topItemsLog.topItems[0].engagementScore, 0.55);
    assert.equal(topItemsLog.topItems[0].baseScore, 0.8);
    assert.equal(topItemsLog.topItems[0].servedPenalty, 0.2);
    assert.ok(Math.abs(topItemsLog.topItems[0].score - (0.8 / 1.2)) < 1e-9);
    assert.equal(topItemsLog.topItems[0].weights.semanticWeight, 0.25);
    assert.equal(topItemsLog.topItems[0].weights.servedPenaltyFactor, 0.2);
    assert.equal(topItemsLog.topItems[0].mode, "warm");
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("centroid drift is bounded and pool similarities can be recomputed after a valid update", async () => {
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient(),
    embeddingForText(text) {
      if (/like/i.test(text)) {
        return [0, 1];
      }
      if (/far/i.test(text)) {
        return [-1, 0];
      }
      return [1, 0];
    }
  });
  const profile = modules.profileStore.createProfile("Drift");
  profileStoreForCleanup = modules.profileStore;
  const poolKey = "drift-pool";
  const configPath = writeConfig("drift.json", {
    feed: { coldStartInteractionThreshold: 1 },
    learning: { centroidLearningRate: 0.2, maxCentroidDrift: 0.03 },
    embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
  });
  process.env.GRETEL_CONFIG = configPath;

  try {
    modules.algorithmStore.saveCentroid(profile.id, poolKey, [1, 0], [1, 0]);
    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("warmup"),
      watchedSeconds: 100,
      durationSeconds: 100
    });
    modules.algorithmStore.retainEmbedding(profile.id, "skip-video", [0, 1]);
    await modules.centroidDrift.updateCentroidsForPositiveEngagement(
      profile.id,
      video("skip-video", { ignoreCount: 1, watchTimeRatio: 0, liked: false, clicked: false })
    );
    assert.deepEqual(modules.algorithmStore.getCentroid(profile.id, poolKey).current, [1, 0]);

    modules.algorithmStore.retainEmbedding(profile.id, "far-video", [-1, 0]);
    await modules.centroidDrift.updateCentroidsForPositiveEngagement(
      profile.id,
      video("far-video", { liked: true })
    );
    assert.deepEqual(modules.algorithmStore.getCentroid(profile.id, poolKey).current, [1, 0]);

    process.env.GRETEL_CONFIG = writeConfig("drift-valid.json", {
      feed: { coldStartInteractionThreshold: 1 },
      learning: { centroidLearningRate: 0.2, maxCentroidDrift: 0.25 },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });
    modules.poolStore.markRootDiscovered(profile.id, poolKey, Date.now());
    modules.poolStore.addPoolNodes(
      profile.id,
      poolKey,
      "tagSearch",
      [video("pool-node", { similarityScore: 1 })],
      Date.now()
    );
    modules.algorithmStore.retainEmbedding(profile.id, "pool-node", [1, 0]);
    modules.algorithmStore.retainEmbedding(profile.id, "like-video", [0, 1]);
    await modules.centroidDrift.updateCentroidsForPositiveEngagement(
      profile.id,
      video("like-video", { liked: true })
    );
    const current = modules.algorithmStore.getCentroid(profile.id, poolKey).current;
    assert.ok(current[0] < 1);
    assert.ok(current[1] > 0);

    assert.notEqual(modules.poolStore.listPoolNodes(profile.id, poolKey)[0].similarityScore, 1);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("embedding rows are isolated by provider, model, and dimensions", () => {
  const modules = loadRuntimeModules({ youtubeClient: createFakeYoutubeClient() });
  const profile = modules.profileStore.createProfile("Embedding Stores");
  profileStoreForCleanup = modules.profileStore;
  const qwenConfigPath = writeConfig("embedding-store-qwen.json", {
    embeddings: {
      provider: "openrouter",
      model: "qwen/qwen3-embedding-8b",
      dimensions: 4096
    }
  });
  const localConfigPath = writeConfig("embedding-store-local.json", {
    embeddings: {
      provider: "local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384
    }
  });

  try {
    process.env.GRETEL_CONFIG = qwenConfigPath;
    assert.equal(
      modules.algorithmStore.createEmbeddingStoreName(),
      "openrouter_qwen_qwen3_embedding_8b_4096"
    );
    modules.algorithmStore.saveCentroid(profile.id, "pool", [1, 0], [1, 0]);
    modules.algorithmStore.retainEmbedding(profile.id, "video", [1, 0]);

    assert.deepEqual(modules.algorithmStore.getCentroid(profile.id, "pool").current, [1, 0]);
    assert.deepEqual(modules.algorithmStore.getRetainedEmbedding(profile.id, "video"), [1, 0]);

    process.env.GRETEL_CONFIG = localConfigPath;
    assert.equal(modules.algorithmStore.getCentroid(profile.id, "pool"), null);
    assert.equal(modules.algorithmStore.getRetainedEmbedding(profile.id, "video"), null);

    modules.algorithmStore.saveCentroid(profile.id, "pool", [0, 1], [0, 1]);
    modules.algorithmStore.retainEmbedding(profile.id, "video", [0, 1]);

    assert.deepEqual(modules.algorithmStore.getCentroid(profile.id, "pool").current, [0, 1]);
    assert.deepEqual(modules.algorithmStore.getRetainedEmbedding(profile.id, "video"), [0, 1]);
    assert.deepEqual(
      modules.algorithmStore.listFeedAlgorithmTableNames(),
      ["feed_centroids", "feed_video_embeddings"]
    );

    const storeKeys = modules.profileStore
      .getDatabase()
      .prepare("SELECT DISTINCT store_key FROM feed_video_embeddings ORDER BY store_key ASC")
      .all()
      .map((row) => row.store_key);

    assert.deepEqual(storeKeys, [
      "local_xenova_all_minilm_l6_v2_384",
      "openrouter_qwen_qwen3_embedding_8b_4096"
    ]);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("serving excludes completed watched nodes and orders unserved nodes by parent score", () => {
  const { createCandidatePoolFeed } = require(path.join(buildDir, "lib", "feed", "pool.js"));
  const config = testConfig({
    feed: { coldStartInteractionThreshold: 1, readyQueueTargetSize: 10 },
    learning: { watchCompletionThreshold: 0.9 }
  });
  const interactions = new Map([
    ["done", { videoId: "done", watchTimeRatio: 0.95, liked: false, clicked: false, ignoreCount: 0 }],
    ["warm", { videoId: "warm", watchTimeRatio: 0.1, liked: false, clicked: false, ignoreCount: 0 }]
  ]);
  const result = createCandidatePoolFeed({
    rootVideos: [
      video("done", { watchTimeRatio: 0.95 }),
      video("low-parent", { similarityScore: 0.8, parentEngagementScore: 0.1 }),
      video("high-parent", { similarityScore: 0.8, parentEngagementScore: 0.9 })
    ],
    channelVideos: [],
    relatedVideos: [],
    watchedVideoIds: new Set(),
    interactions,
    config
  });

  assert.equal(result.videos.some((node) => node.id === "done"), false);
  assert.deepEqual(result.videos.slice(0, 2).map((node) => node.id), ["high-parent", "low-parent"]);
});

test("up next selects by similarity to the current video, not engagement score", () => {
  const { selectUpNextCandidates } = require(path.join(buildDir, "lib", "feed", "pool.js"));
  const candidates = [
    video("highest-engagement", { engagementScore: 10 }),
    video("nearest", { engagementScore: 0.1 })
  ];
  const embeddings = new Map([
    ["current", [1, 0]],
    ["highest-engagement", [0, 1]],
    ["nearest", [0.9, 0.1]]
  ]);

  assert.deepEqual(
    selectUpNextCandidates({
      currentVideo: video("current"),
      candidates,
      embeddings
    }).map((node) => node.id),
    ["nearest", "highest-engagement"]
  );
});

test("pruning removes lowest scoring nodes first and lets a high-scoring child survive its parent", () => {
  const modules = loadRuntimeModules({ youtubeClient: createFakeYoutubeClient() });
  const profile = modules.profileStore.createProfile("Pruning");
  profileStoreForCleanup = modules.profileStore;
  const poolKey = "pruning";

  try {
    modules.poolStore.markRootDiscovered(profile.id, poolKey, Date.now());
    modules.poolStore.addPoolNodes(
      profile.id,
      poolKey,
      "relatedVideos",
      [
        video("parent", { engagementScore: -2, similarityScore: 0.1 }),
        video("child", { engagementScore: 0.9, similarityScore: 0.9, parent_video_id: "parent" }),
        video("middle", { engagementScore: 0.2, similarityScore: 0.2 })
      ],
      Date.now()
    );
    const scored = modules.poolStore.listPoolNodes(profile.id, poolKey).map((node) => ({
      ...node,
      engagementScore: node.id === "parent" ? -2 : node.id === "child" ? 0.9 : 0.2
    }));

    modules.poolStore.prunePool(profile.id, poolKey, scored, 2);
    const remaining = modules.poolStore.listPoolNodes(profile.id, poolKey).map((node) => node.id).sort();
    assert.deepEqual(remaining, ["child", "middle"]);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("pruning cleans non-engaged embeddings and pruned videos are not re-admitted", async () => {
  const infoSeeds = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      infoForSeed(seedId) {
        infoSeeds.push(seedId);
        return [
          rawVideo("stale-related", "stale related", "Related"),
          rawVideo("watched-related", "watched related", "Related"),
          rawVideo("fresh-related", "fresh related", "Related")
        ];
      }
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Visited Prune");
  profileStoreForCleanup = modules.profileStore;
  const poolKey = modules.poolStore.createFeedPoolKey({
    tags: ["alpha"],
    channels: [],
    channelSort: "mixed"
  });

  try {
    process.env.GRETEL_CONFIG = writeConfig("visited-prune.json", {
      feed: {
        maxQueries: 1,
        maxVideos: 8,
        similarityThreshold: 0.75,
        readyQueueLowWaterMark: 20,
        recommendationSeeds: 1,
        expansionSeedCount: 1,
        minRelatedVideosPerSeed: 3,
        maxRelatedVideosPerSeed: 3,
        subscriptionFastLanePerSession: 0
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });
    modules.poolStore.markRootDiscovered(profile.id, poolKey, Date.now());
    modules.algorithmStore.saveCentroid(profile.id, poolKey, [1, 0], [1, 0]);
    modules.poolStore.addPoolNodes(
      profile.id,
      poolKey,
      "tagSearch",
      [
        video("seed", { similarityScore: 1, engagementScore: 1 }),
        video("stale-related", { similarityScore: 1, engagementScore: -5 })
      ],
      Date.now()
    );
    modules.algorithmStore.retainEmbedding(profile.id, "stale-related", [1, 0]);
    modules.poolStore.prunePool(
      profile.id,
      poolKey,
      [
        video("seed", { similarityScore: 1, engagementScore: 1 }),
        video("stale-related", { similarityScore: 1, engagementScore: -5 })
      ],
      1
    );
    modules.profileStore.saveWatchedVideo({
      profileId: profile.id,
      video: video("watched-related"),
      watchedSeconds: 100,
      durationSeconds: 100
    });

    assert.equal(modules.algorithmStore.getRetainedEmbedding(profile.id, "stale-related"), null);

    await modules.service.createFeed(profile.id, ["alpha"], [], "mixed", observation(), {
      forceExpansion: true
    });
    const relatedIds = modules.poolStore
      .listPoolNodes(profile.id, poolKey)
      .filter((node) => node.sourceNodeId === "relatedVideos")
      .map((node) => node.id);

    assert.deepEqual(infoSeeds, ["seed"]);
    assert.deepEqual(relatedIds, ["fresh-related"]);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

test("subscription fast lane is served up to cap, never pooled, and never used as expansion seeds", async () => {
  const infoSeeds = [];
  const modules = loadRuntimeModules({
    youtubeClient: createFakeYoutubeClient({
      searchVideos: [rawVideo("root-alpha", "alpha root", "Search")],
      channelVideos: [
        rawVideo("fast-1", "fast one", "Creator One"),
        rawVideo("fast-2", "fast two", "Creator One"),
        rawVideo("fast-3", "fast three", "Creator One")
      ],
      infoForSeed(seedId) {
        infoSeeds.push(seedId);
        return [rawVideo(`related-${seedId}`, "related above", "Related")];
      }
    }),
    embeddingForText: () => [1, 0]
  });
  const profile = modules.profileStore.createProfile("Fast Lane");
  profileStoreForCleanup = modules.profileStore;

  try {
    process.env.GRETEL_CONFIG = writeConfig("fast-lane.json", {
      feed: {
        maxQueries: 1,
        maxVideos: 10,
        minVideosPerQuery: 1,
        minVideosPerChannel: 3,
        subscriptionFastLanePerSession: 2,
        similarityThreshold: 0.99,
        readyQueueLowWaterMark: 20,
        recommendationSeeds: 4
      },
      serving: {
        fastLaneImpressionPenaltyFactor: 1
      },
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });
    modules.profileStore.recordVideoImpressions(profile.id, ["fast-1"]);
    modules.profileStore.recordVideoImpressions(profile.id, ["fast-1"]);
    modules.profileStore.recordVideoImpressions(profile.id, ["fast-1"]);
    const feed = await modules.service.createFeed(
      profile.id,
      ["alpha"],
      ["Creator One"],
      "mixed",
      observation(),
      { forceExpansion: true }
    );
    const poolKey = modules.poolStore.createFeedPoolKey({
      tags: feed.queries,
      channels: ["Creator One"],
      channelSort: "mixed"
    });
    const poolIds = new Set(modules.poolStore.listPoolNodes(profile.id, poolKey).map((node) => node.id));
    const servedFastLaneIds = feed.videos
      .filter((node) => node.sourceNodeLabel === "Subscription fast lane")
      .map((node) => node.id);

    assert.equal(servedFastLaneIds.length, 2);
    assert.deepEqual(servedFastLaneIds, ["fast-2", "fast-3"]);
    assert.equal(servedFastLaneIds.some((id) => poolIds.has(id)), false);
    assert.equal(infoSeeds.some((id) => servedFastLaneIds.includes(id)), false);
  } finally {
    modules.profileStore.deleteProfile(profile.id);
  }
});

function compileModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const files = [
    ...listTsFiles(path.join(repoRoot, "lib")),
    path.join(repoRoot, "app", "api", "feed", "route.ts"),
    path.join(repoRoot, "app", "api", "impressions", "route.ts"),
    path.join(repoRoot, "app", "api", "profiles", "route.ts"),
    path.join(repoRoot, "app", "api", "watch-events", "route.ts")
  ].map((file) => path.relative(repoRoot, file));
  const result = spawnSync(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    [
      "--outDir",
      buildDir,
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--target",
      "ES2022",
      "--ignoreConfig",
      "--ignoreDeprecations",
      "6.0",
      "--skipLibCheck",
      "--types",
      "node",
      "--esModuleInterop",
      ...files
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function listTsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    return statSync(fullPath).isDirectory() ? listTsFiles(fullPath) : fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

function loadRuntimeModules({ youtubeClient, embeddingForText = () => [1, 0] } = {}) {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(buildDir)) {
      delete require.cache[modulePath];
    }
  }

  const youtubeClientPath = path.join(buildDir, "lib", "feed", "youtube-client.js");
  const fakeYoutubeModule = new Module(youtubeClientPath);
  fakeYoutubeModule.filename = youtubeClientPath;
  fakeYoutubeModule.loaded = true;
  fakeYoutubeModule.exports = {
    getYoutubeClient: async () => youtubeClient,
    forgetYoutubeClient: () => {}
  };
  require.cache[youtubeClientPath] = fakeYoutubeModule;

  const embeddingsPath = path.join(buildDir, "lib", "feed", "embeddings.js");
  const fakeEmbeddingsModule = new Module(embeddingsPath);
  fakeEmbeddingsModule.filename = embeddingsPath;
  fakeEmbeddingsModule.loaded = true;
  fakeEmbeddingsModule.exports = {
    createEmbeddingInput(video) {
      return [video.title, video.author, video.query].filter(Boolean).join("\n");
    },
    getEmbeddingProvider() {
      return {
        async embedTexts(texts) {
          return texts.map((text) => normalize(embeddingForText(text)));
        }
      };
    }
  };
  require.cache[embeddingsPath] = fakeEmbeddingsModule;

  return {
    service: require(path.join(buildDir, "lib", "feed", "service.js")),
    poolStore: require(path.join(buildDir, "lib", "feed", "pool-store.js")),
    algorithmStore: require(path.join(buildDir, "lib", "feed", "algorithm-store.js")),
    centroidDrift: require(path.join(buildDir, "lib", "feed", "centroid-drift.js")),
    vectorMath: require(path.join(buildDir, "lib", "feed", "vector-math.js")),
    profileStore: require(path.join(buildDir, "lib", "profile-store.js"))
  };
}

function createFakeYoutubeClient({
  searchVideos = [],
  searchResults = null,
  channelVideos = [],
  infoForSeed = () => [],
  transcriptForVideo = () => ""
} = {}) {
  return {
    async search(_query, options = {}) {
      if (options.type === "channel") {
        return { channels: [{ id: "UC-creator-one" }] };
      }

      if (searchResults) {
        return { results: searchResults };
      }

      return { videos: searchVideos };
    },
    async getChannel() {
      return {
        async getVideos() {
          return { videos: channelVideos };
        }
      };
    },
    async getInfo(videoId) {
      return {
        get watch_next_feed() {
          return infoForSeed(videoId);
        },
        async getTranscript() {
          const transcript = transcriptForVideo(videoId);

          return {
            transcript: {
              content: {
                body: {
                  initial_segments: transcript
                    ? transcript.split(/\s+/).map((word) => ({ snippet: word }))
                    : []
                }
              }
            }
          };
        }
      };
    }
  };
}

function writeConfig(name, overrides = {}) {
  mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, name);
  writeFileSync(configPath, JSON.stringify(overrides));
  return configPath;
}

function testConfig(overrides = {}) {
  const { DEFAULT_GRETEL_CONFIG } = require(path.join(buildDir, "lib", "feed", "config-defaults.js"));

  return {
    ...DEFAULT_GRETEL_CONFIG,
    serving: { ...DEFAULT_GRETEL_CONFIG.serving, ...(overrides.serving || {}) },
    expansion: { ...DEFAULT_GRETEL_CONFIG.expansion, ...(overrides.expansion || {}) },
    transcription: { ...DEFAULT_GRETEL_CONFIG.transcription, ...(overrides.transcription || {}) },
    feed: { ...DEFAULT_GRETEL_CONFIG.feed, ...(overrides.feed || {}) },
    learning: { ...DEFAULT_GRETEL_CONFIG.learning, ...(overrides.learning || {}) },
    embeddings: { ...DEFAULT_GRETEL_CONFIG.embeddings, ...(overrides.embeddings || {}) },
    client: { ...DEFAULT_GRETEL_CONFIG.client, ...(overrides.client || {}) },
    youtube: { ...DEFAULT_GRETEL_CONFIG.youtube, ...(overrides.youtube || {}) }
  };
}

function rootDiscoveryEmbedding(text) {
  if (/alpha soap update/i.test(text)) {
    return [0, 1];
  }

  if (/channel below/i.test(text)) {
    return [0.6, 0.8];
  }

  return [1, 0];
}

function rawVideo(id, title, author) {
  return {
    type: "Video",
    id,
    title,
    author: { name: author },
    duration: { text: "10:00" },
    view_count: { text: "100 views" }
  };
}

function video(id, fields = {}) {
  return {
    id,
    title: id,
    author: "Author",
    duration: "10:00",
    query: "query",
    ...fields
  };
}

function observation() {
  return { requestId: crypto.randomUUID(), startedAt: Date.now(), operations: [] };
}

async function captureConsoleLogs(work) {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];

  const capture = (stream) => (line) => {
    logs.push({ stream, line: JSON.parse(String(line)) });
  };

  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");

  try {
    await work();
    return logs;
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function normalize(vector) {
  const size = magnitude(vector);
  return size === 0 ? vector : vector.map((value) => value / size);
}
