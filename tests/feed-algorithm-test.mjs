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
      searchVideos: [
        rawVideo("root-alpha-1", "alpha root one", "Search"),
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
      embeddings: { provider: "mock", dimensions: 2, batchSize: 8 }
    });
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

function createFakeYoutubeClient({ searchVideos = [], channelVideos = [], infoForSeed = () => [] } = {}) {
  return {
    async search(_query, options = {}) {
      if (options.type === "channel") {
        return { channels: [{ id: "UC-creator-one" }] };
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
    async getInfo(seedId) {
      return { watch_next_feed: infoForSeed(seedId) };
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
    feed: { ...DEFAULT_GRETEL_CONFIG.feed, ...(overrides.feed || {}) },
    learning: { ...DEFAULT_GRETEL_CONFIG.learning, ...(overrides.learning || {}) },
    embeddings: { ...DEFAULT_GRETEL_CONFIG.embeddings, ...(overrides.embeddings || {}) },
    client: { ...DEFAULT_GRETEL_CONFIG.client, ...(overrides.client || {}) },
    youtube: { ...DEFAULT_GRETEL_CONFIG.youtube, ...(overrides.youtube || {}) }
  };
}

function rootDiscoveryEmbedding(text) {
  if (/channel below/i.test(text)) {
    return [0.6, 0.8];
  }

  return [1, 0];
}

function rawVideo(id, title, author) {
  return {
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

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function normalize(vector) {
  const size = magnitude(vector);
  return size === 0 ? vector : vector.map((value) => value / size);
}
