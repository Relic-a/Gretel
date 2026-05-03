import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "config-smoke-test");
const configDir = path.join(os.tmpdir(), `gretel-config-smoke-${process.pid}`);

function compileConfigModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const result = spawnSync(
    path.join(root, "node_modules", ".bin", "tsc"),
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
      "lib/logger.ts",
      "lib/feed/config.ts",
      "lib/feed/config-defaults.ts",
      "lib/feed/youtube-client.ts",
      "lib/feed/types.ts",
      "app/api/feed/route.ts",
      "app/api/profiles/route.ts",
      "app/api/watch-events/route.ts"
    ],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function writeConfig(name, contents) {
  mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, name);
  writeFileSync(configPath, contents);
  return configPath;
}

function captureConfigLogs(work) {
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
    work(logs);
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }

  return logs;
}

async function captureLogs(work) {
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
    const value = await work(logs);
    return { value, logs };
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function loadConfigModule() {
  const require = createRequire(import.meta.url);
  const modulePath = path.join(buildDir, "lib", "feed", "config.js");
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function loadRuntimeModules(fakeYoutubeClient) {
  const require = createRequire(import.meta.url);
  const youtubeClientPath = path.join(buildDir, "lib", "feed", "youtube-client.js");
  const fakeModule = new Module(youtubeClientPath);
  fakeModule.filename = youtubeClientPath;
  fakeModule.loaded = true;
  fakeModule.exports = {
    getYoutubeClient: async () => fakeYoutubeClient,
    forgetYoutubeClient: () => {}
  };
  require.cache[youtubeClientPath] = fakeModule;

  return {
    feedRoute: require(path.join(buildDir, "app", "api", "feed", "route.js")),
    profilesRoute: require(path.join(buildDir, "app", "api", "profiles", "route.js")),
    watchEventsRoute: require(path.join(buildDir, "app", "api", "watch-events", "route.js")),
    profileStore: require(path.join(buildDir, "lib", "profile-store.js"))
  };
}

async function postJson(route, body) {
  const response = await route.POST(
    new Request("http://gretel.test", {
      method: "POST",
      body: JSON.stringify(body)
    })
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

function writeRuntimeConfig(name, overrides = {}) {
  return writeConfig(
    name,
    JSON.stringify({
      feed: {
        maxQueries: 1,
        maxVideos: 6,
        cacheTargetVideos: 16,
        cacheRefreshHours: 24,
        subscriptionRefreshMinutes: 60,
        recommendationSeeds: 2,
        watchedRecommendationSeeds: 1,
        maxNodeWeight: 5,
        cacheReadMultiplier: 2,
        minVideosPerQuery: 4,
        minVideosPerChannel: 4,
        maxSharePerNode: 0.5,
        maxSharePerChannel: 1,
        defaultNodeWeights: {
          tagSearch: 1,
          channelVideos: 1,
          relatedVideos: 0,
          watchedVideos: 1
        },
        ...overrides.feed
      },
      learning: {
        watchSaveThreshold: 0.25,
        nodeAffinityStep: 0.5,
        channelAffinityStep: 0.5,
        maxAffinityBoost: 2,
        ...overrides.learning
      },
      client: {
        watchProgressPollMs: 250,
        ...overrides.client
      },
      youtube: {
        language: "en",
        ...overrides.youtube
      }
    })
  );
}

function createFakeYoutubeClient() {
  const calls = {
    search: 0,
    getChannel: 0,
    getInfo: 0
  };

  return {
    calls,
    async search(query, options = {}) {
      calls.search += 1;

      if (options.type === "channel") {
        return { channels: [{ id: `UC-${slug(query)}` }] };
      }

      return {
        videos: Array.from({ length: 10 }, (_, index) =>
          fakeVideo(
            `search-${slug(query)}-${index}`,
            index % 2 === 0 ? "Search One" : "Search Two",
            index % 2 === 0 ? `Video about ${query}` : "Completely unrelated"
          )
        )
      };
    },
    async getChannel(channelId) {
      calls.getChannel += 1;
      const callNumber = calls.getChannel;

      return {
        async getVideos() {
          return channelPage(channelId, callNumber, "latest");
        }
      };
    },
    async getInfo(seedId) {
      calls.getInfo += 1;

      return {
        watch_next_feed: Array.from({ length: 4 }, (_, index) =>
          fakeVideo(
            `related-${seedId}-${index}`,
            index % 2 === 0 ? "Related One" : "Related Two"
          )
        )
      };
    }
  };
}

function channelPage(channelId, callNumber, sort) {
  return {
    sort_filters: ["Latest", "Popular"],
    videos: Array.from({ length: 10 }, (_, index) =>
      fakeVideo(`channel-${slug(channelId)}-${callNumber}-${sort}-${index}`, "Creator One")
    ),
    async applySort(selectedSort) {
      return channelPage(channelId, callNumber, selectedSort.toLowerCase());
    }
  };
}

function fakeVideo(id, author, title = `Video ${id}`) {
  return {
    id,
    title,
    author: { name: author },
    duration: { text: "10:00" },
    view_count: { text: "100 views" }
  };
}

function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

compileConfigModules();

after(() => {
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(configDir, { force: true, recursive: true });
});

test("logs every active config path even when two paths resolve to default values", () => {
  const missingPath = path.join(configDir, "missing.json");
  const explicitDefaultPath = writeConfig(
    "explicit-default.json",
    JSON.stringify({
      feed: {},
      learning: {},
      client: {}
    })
  );
  const { getGretelConfig } = loadConfigModule();

  const logs = captureConfigLogs(() => {
    process.env.GRETEL_CONFIG = missingPath;
    getGretelConfig();

    process.env.GRETEL_CONFIG = explicitDefaultPath;
    getGretelConfig();
  });

  const appliedPaths = logs
    .filter((log) => log.line.event === "config.applied")
    .map((log) => log.line.path);

  assert.deepEqual(appliedPaths, [missingPath, explicitDefaultPath]);
});

test("logs parse failures for each bad config path", () => {
  const badPathA = writeConfig("bad-a.json", "{");
  const badPathB = writeConfig("bad-b.json", "{");
  const { getGretelConfig } = loadConfigModule();

  const logs = captureConfigLogs(() => {
    process.env.GRETEL_CONFIG = badPathA;
    getGretelConfig();

    process.env.GRETEL_CONFIG = badPathB;
    getGretelConfig();
  });

  const warningPaths = logs
    .filter((log) => log.line.event === "config.read_failed")
    .map((log) => log.line.path);

  assert.deepEqual(warningPaths, [badPathA, badPathB]);
});

test("clamps and rounds out-of-range config values before logging applied config", () => {
  const configPath = writeConfig(
    "odd-values.json",
    JSON.stringify({
      feed: {
        maxQueries: "2.4",
        maxVideos: 9999,
        maxNodeWeight: 2,
        maxSharePerNode: -1,
        maxSharePerChannel: 2,
        defaultNodeWeights: {
          tagSearch: 99,
          channelVideos: -3
        }
      },
      learning: {
        watchSaveThreshold: "0.75"
      },
      client: {
        watchProgressPollMs: 99
      },
      youtube: {
        language: " fr "
      }
    })
  );
  const { getGretelConfig } = loadConfigModule();

  const logs = captureConfigLogs(() => {
    process.env.GRETEL_CONFIG = configPath;
    const config = getGretelConfig();

    assert.equal(config.feed.maxQueries, 2);
    assert.equal(config.feed.maxVideos, 200);
    assert.equal(config.feed.maxSharePerNode, 0);
    assert.equal(config.feed.maxSharePerChannel, 1);
    assert.equal(config.feed.defaultNodeWeights.tagSearch, 2);
    assert.equal(config.feed.defaultNodeWeights.channelVideos, 0);
    assert.equal(config.learning.watchSaveThreshold, 0.75);
    assert.equal(config.client.watchProgressPollMs, 250);
    assert.equal(config.youtube.language, "fr");
  });

  const applied = logs.find((log) => log.line.event === "config.applied");

  assert.equal(applied?.stream, "info");
  assert.equal(applied?.line.path, configPath);
  assert.equal(applied?.line.feed.maxVideos, 200);
  assert.equal(applied?.line.youtube.language, "fr");
});

test("runtime feed flow logs cache, subscription refresh, profile, and affinity behavior under config changes", async () => {
  const normalConfig = writeRuntimeConfig("runtime-normal.json");
  const shortSubscriptionConfig = writeRuntimeConfig("runtime-short-subscription.json", {
    feed: {
      subscriptionRefreshMinutes: 0
    }
  });
  const fakeYoutubeClient = createFakeYoutubeClient();
  const { feedRoute, profilesRoute, watchEventsRoute, profileStore } =
    loadRuntimeModules(fakeYoutubeClient);
  let profileId = "";

  try {
    const { value: flow, logs } = await captureLogs(async () => {
      process.env.GRETEL_CONFIG = normalConfig;
      const created = await postJson(profilesRoute, { name: "Config Smoke Profile" });
      assert.equal(created.status, 200);
      profileId = created.body.profileId;
      assert.ok(profileStore.getProfile(profileId));

      const firstFeed = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest"
      });
      assert.equal(firstFeed.status, 200);
      assert.equal(firstFeed.body.queries.length, 1);
      assert.equal(firstFeed.body.cache.status, "miss");
      assert.equal(firstFeed.body.cache.refreshedBase, true);
      assert.equal(firstFeed.body.cache.refreshedSubscriptions, true);
      assert.equal(
        firstFeed.body.videos.some(
          (video) => video.sourceNodeId === "tagSearch" && !/alpha/i.test(video.title)
        ),
        false
      );

      const firstCounts = { ...fakeYoutubeClient.calls };
      const secondFeed = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest"
      });
      assert.equal(secondFeed.status, 200);
      assert.equal(secondFeed.body.cache.status, "hit");
      assert.deepEqual(fakeYoutubeClient.calls, firstCounts);

      process.env.GRETEL_CONFIG = shortSubscriptionConfig;
      const subscriptionRefreshFeed = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest"
      });
      assert.equal(subscriptionRefreshFeed.status, 200);
      assert.equal(subscriptionRefreshFeed.body.cache.status, "stale");
      assert.equal(subscriptionRefreshFeed.body.cache.refreshedBase, false);
      assert.equal(subscriptionRefreshFeed.body.cache.refreshedSubscriptions, true);
      assert.equal(fakeYoutubeClient.calls.getChannel, firstCounts.getChannel + 1);

      const watchedVideo = firstFeed.body.videos.find(
        (video) => video.sourceNodeId === "channelVideos"
      );
      assert.ok(watchedVideo);

      const watched = await postJson(watchEventsRoute, {
        profileId,
        video: watchedVideo,
        watchedSeconds: 80,
        durationSeconds: 100
      });
      assert.equal(watched.status, 200);
      assert.equal(watched.body.saved, true);

      const countsBeforeCacheRefresh = { ...fakeYoutubeClient.calls };
      const afterWatchFeed = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest",
        cacheOnly: true
      });
      assert.equal(afterWatchFeed.status, 200);
      assert.equal(afterWatchFeed.body.cache.status, "hit");
      assert.equal(afterWatchFeed.body.cache.refreshedBase, false);
      assert.equal(afterWatchFeed.body.cache.refreshedSubscriptions, false);
      assert.deepEqual(fakeYoutubeClient.calls, countsBeforeCacheRefresh);
      assert.equal(
        afterWatchFeed.body.videos.some((video) => video.id === watchedVideo.id),
        false
      );
      assert.equal(
        afterWatchFeed.body.nodes.find((node) => node.id === "channelVideos").effectiveWeight,
        1.5
      );

      const afterWatchFetch = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest",
        forceRefresh: true
      });
      assert.equal(afterWatchFetch.status, 200);
      assert.equal(afterWatchFetch.body.cache.refreshedBase, true);
      assert.equal(
        afterWatchFetch.body.nodes.find((node) => node.id === "watchedVideos").inputVideos,
        4
      );

      return {
        firstFeed: firstFeed.body,
        secondFeed: secondFeed.body,
        subscriptionRefreshFeed: subscriptionRefreshFeed.body,
        afterWatchFeed: afterWatchFeed.body,
        afterWatchFetch: afterWatchFetch.body
      };
    });

    const feedLogs = logs.filter((log) => log.line.event === "feed.request");
    const watchLogs = logs.filter((log) => log.line.event === "watch_event.saved");
    const profileLogs = logs.filter((log) => String(log.line.event).startsWith("profile."));

    assert.equal(feedLogs.length, 5);
    assert.equal(watchLogs.length, 1);
    assert.equal(profileLogs.length, 0);
    assert.equal(feedLogs[0].line.summary.cacheStatus, "miss");
    assert.equal(feedLogs[1].line.summary.cacheStatus, "hit");
    assert.equal(feedLogs[2].line.summary.refreshedSubscriptions, true);
    assert.equal(feedLogs[3].line.summary.watchedSeeds, 1);
    assert.equal(feedLogs[4].line.summary.forcedRefresh, true);

    assert.ok(flow.firstFeed.cache.videos <= flow.firstFeed.cache.targetVideos);
    assert.ok(flow.subscriptionRefreshFeed.cache.videos <= flow.subscriptionRefreshFeed.cache.targetVideos);
    assert.ok(flow.afterWatchFetch.cache.videos <= flow.afterWatchFetch.cache.targetVideos);
  } finally {
    if (profileId) {
      profileStore.resetProfile(profileId);
      profileStore.deleteProfile(profileId);
    }
  }
});

test("runtime feed returns isolated tag tabs with a random all feed", async () => {
  const tagConfig = writeRuntimeConfig("runtime-tag-tabs.json", {
    feed: {
      maxQueries: 2,
      defaultNodeWeights: {
        tagSearch: 1,
        channelVideos: 0,
        relatedVideos: 0,
        watchedVideos: 0
      }
    }
  });
  const fakeYoutubeClient = createFakeYoutubeClient();
  const { feedRoute, profilesRoute, profileStore } = loadRuntimeModules(fakeYoutubeClient);
  let profileId = "";

  try {
    await captureLogs(async () => {
      process.env.GRETEL_CONFIG = tagConfig;
      const created = await postJson(profilesRoute, { name: "Tag Tabs Profile" });
      assert.equal(created.status, 200);
      profileId = created.body.profileId;

      const response = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta"
      });
      assert.equal(response.status, 200);
      assert.deepEqual(
        response.body.feedTabs.map((tab) => tab.label),
        ["All", "alpha", "beta"]
      );

      const alphaTab = response.body.feedTabs.find((tab) => tab.key === "alpha");
      const betaTab = response.body.feedTabs.find((tab) => tab.key === "beta");
      const allTab = response.body.feedTabs.find((tab) => tab.key === "all");
      assert.ok(alphaTab);
      assert.ok(betaTab);
      assert.ok(allTab);
      assert.ok(alphaTab.videos.length > 0);
      assert.ok(betaTab.videos.length > 0);
      assert.equal(alphaTab.videos.every((video) => /alpha/i.test(video.title)), true);
      assert.equal(betaTab.videos.every((video) => /beta/i.test(video.title)), true);
      assert.equal(allTab.videos.length <= 6, true);
      assert.deepEqual(response.body.videos, allTab.videos);
    });
  } finally {
    if (profileId) {
      profileStore.deleteProfile(profileId);
    }
  }
});
