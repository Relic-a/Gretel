import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "config-smoke-test");
const configDir = path.join(os.tmpdir(), `gretel-config-smoke-${process.pid}`);
const originalLogFile = process.env.GRETEL_LOG_FILE;

process.env.GRETEL_LOG_FILE = path.join(configDir, "gretel-test.log");

function compileConfigModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
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
      "app/api/feed/build/route.ts",
      "app/api/impressions/route.ts",
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

function loadLoggerModule() {
  const require = createRequire(import.meta.url);
  const modulePath = path.join(buildDir, "lib", "logger.js");
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function loadRuntimeModules(fakeYoutubeClient) {
  const require = createRequire(import.meta.url);
  const youtubeClientPath = path.join(buildDir, "lib", "feed", "youtube-client.js");
  const routePaths = [
    path.join(buildDir, "app", "api", "feed", "route.js"),
    path.join(buildDir, "app", "api", "feed", "build", "route.js"),
    path.join(buildDir, "app", "api", "profiles", "route.js"),
    path.join(buildDir, "app", "api", "watch-events", "route.js"),
    path.join(buildDir, "lib", "profile-store.js")
  ];

  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(buildDir)) {
      delete require.cache[modulePath];
    }
  }

  const fakeModule = new Module(youtubeClientPath);
  fakeModule.filename = youtubeClientPath;
  fakeModule.loaded = true;
  fakeModule.exports = {
    getYoutubeClient: async () => fakeYoutubeClient,
    forgetYoutubeClient: () => {}
  };
  require.cache[youtubeClientPath] = fakeModule;

  return {
    feedRoute: require(routePaths[0]),
    feedBuildRoute: require(routePaths[1]),
    profilesRoute: require(routePaths[2]),
    watchEventsRoute: require(routePaths[3]),
    profileStore: require(routePaths[4])
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
        subscriptionRefreshMinutes: 60,
        recommendationSeeds: 2,
        minVideosPerQuery: 4,
        minVideosPerChannel: 4,
        ...overrides.feed
      },
      learning: {
        watchSaveThreshold: 0.25,
        ...overrides.learning
      },
      expansion: {
        minDelayBetweenFetchesMs: 0,
        cycleCooldownMs: 0,
        ...overrides.expansion
      },
      client: {
        watchProgressPollMs: 250,
        ...overrides.client
      },
      embeddings: {
        provider: "mock",
        dimensions: 2,
        batchSize: 8,
        ...overrides.embeddings
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
    videoSearch: 0,
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

      assert.equal(options.type, "video");
      calls.videoSearch += 1;

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
        get watch_next_feed() {
          return Array.from({ length: 4 }, (_, index) =>
            fakeVideo(
              `related-${seedId}-${index}`,
              index % 2 === 0 ? "Related One" : "Related Two"
            )
          );
        },
        async getTranscript() {
          return {
            transcript: {
              content: {
                body: {
                  initial_segments: []
                }
              }
            }
          };
        }
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

after(async () => {
  try {
    await loadLoggerModule().flushLogFileWrites();
  } catch {}

  if (originalLogFile === undefined) {
    delete process.env.GRETEL_LOG_FILE;
  } else {
    process.env.GRETEL_LOG_FILE = originalLogFile;
  }

  rmSync(buildDir, { force: true, recursive: true });
  rmSync(configDir, { force: true, recursive: true });
});

test("writes structured logs to the configured log file", async () => {
  const logFilePath = path.join(configDir, "logs", "structured.log");
  const previousLogFile = process.env.GRETEL_LOG_FILE;
  process.env.GRETEL_LOG_FILE = logFilePath;
  const { flushLogFileWrites, logError, logInfo, logWarn } = loadLoggerModule();

  try {
    captureConfigLogs(() => {
      logInfo("logger.info", { requestId: "req-1" });
      logWarn("logger.warn", { attempts: 2 });
      logError("logger.error", { reason: "failed" });
    });
    await flushLogFileWrites();

    const lines = readFileSync(logFilePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.deepEqual(
      lines.map((line) => line.level),
      ["info", "warn", "error"]
    );
    assert.deepEqual(
      lines.map((line) => line.event),
      ["logger.info", "logger.warn", "logger.error"]
    );
    assert.equal(lines[0].requestId, "req-1");
    assert.equal(lines[1].attempts, 2);
    assert.equal(lines[2].reason, "failed");
    assert.ok(lines.every((line) => typeof line.at === "string"));
  } finally {
    process.env.GRETEL_LOG_FILE = previousLogFile;
  }
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
        poolSizeCap: -1,
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
    assert.equal(config.feed.poolSizeCap, 1);
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

test("config accepts openrouter embeddings and falls back from invalid providers", () => {
  const openRouterConfigPath = writeConfig(
    "openrouter-embeddings.json",
    JSON.stringify({
      embeddings: {
        provider: "openrouter",
        model: "qwen/qwen3-embedding-8b",
        dimensions: 4096
      }
    })
  );
  const invalidConfigPath = writeConfig(
    "invalid-embedding-provider.json",
    JSON.stringify({
      embeddings: {
        provider: "bad-provider"
      }
    })
  );
  const { getGretelConfig, getPublicGretelConfig } = loadConfigModule();

  process.env.GRETEL_CONFIG = openRouterConfigPath;
  const openRouterConfig = getGretelConfig();
  const publicConfig = getPublicGretelConfig();

  assert.equal(openRouterConfig.embeddings.provider, "openrouter");
  assert.equal(openRouterConfig.embeddings.model, "qwen/qwen3-embedding-8b");
  assert.equal(openRouterConfig.embeddings.dimensions, 4096);
  assert.equal(publicConfig.embeddings.provider, "openrouter");

  process.env.GRETEL_CONFIG = invalidConfigPath;
  assert.equal(getGretelConfig().embeddings.provider, "openrouter");
});

test("config loads OPENROUTER_API_KEY from .env", () => {
  const envDir = mkdtempSync(path.join(os.tmpdir(), "gretel-env-load-"));
  const configModulePath = path.join(buildDir, "lib", "feed", "config.js");
  const childEnv = { ...process.env };
  delete childEnv.OPENROUTER_API_KEY;

  writeFileSync(path.join(envDir, ".env"), "OPENROUTER_API_KEY=from_dot_env\n");

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const { getGretelConfig } = require(process.argv[1]);
        getGretelConfig();
        if (process.env.OPENROUTER_API_KEY !== "from_dot_env") {
          process.exit(17);
        }
      `,
      configModulePath
    ],
    {
      cwd: envDir,
      env: childEnv,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("runtime feed flow initializes roots with early expansion, serves fast lane, and records engagement", async () => {
  const normalConfig = writeRuntimeConfig("runtime-normal.json");
  const fakeYoutubeClient = createFakeYoutubeClient();
  const { feedRoute, feedBuildRoute, profilesRoute, watchEventsRoute, profileStore } =
    loadRuntimeModules(fakeYoutubeClient);
  let profileId = "";

  try {
    const { value: flow, logs } = await captureLogs(async () => {
      process.env.GRETEL_CONFIG = normalConfig;
      const created = await postJson(profilesRoute, { name: "Config Smoke Profile" });
      assert.equal(created.status, 200);
      profileId = created.body.profileId;
      assert.ok(profileStore.getProfile(profileId));

      const firstFeed = await postJson(feedBuildRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest"
      });
      assert.equal(firstFeed.status, 200);
      assert.equal(firstFeed.body.queries.length, 1);
      assert.equal(firstFeed.body.pool.status, "initialized");
      assert.equal(firstFeed.body.pool.initializedRoot, true);
      assert.equal(firstFeed.body.pool.expandedPool, true);
      assert.equal(
        firstFeed.body.videos.some(
          (video) => video.sourceNodeId === "tagSearch" && !/alpha/i.test(video.title)
        ),
        false
      );

      const firstCounts = { ...fakeYoutubeClient.calls };
      assert.equal(firstCounts.getChannel, 1);
      const secondFeed = await postJson(feedRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest"
      });
      assert.equal(secondFeed.status, 200);
      assert.equal(secondFeed.body.pool.status, "served");
      assert.equal(secondFeed.body.pool.initializedRoot, false);
      assert.equal(secondFeed.body.pool.expandedPool, false);
      assert.equal(fakeYoutubeClient.calls.videoSearch, firstCounts.videoSearch);

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
        servingOnly: true
      });
      assert.equal(afterWatchFeed.status, 200);
      assert.equal(afterWatchFeed.body.pool.status, "served");
      assert.equal(afterWatchFeed.body.pool.initializedRoot, false);
      assert.equal(afterWatchFeed.body.pool.expandedPool, false);
      assert.equal(fakeYoutubeClient.calls.videoSearch, countsBeforeCacheRefresh.videoSearch);
      assert.equal(
        afterWatchFeed.body.videos.some((video) => video.id === watchedVideo.id),
        false
      );
      assert.equal(
        afterWatchFeed.body.videos.some((video) => video.engagementScore > 0),
        false
      );

      const afterWatchFetch = await postJson(feedBuildRoute, {
        profileId,
        tags: "alpha, beta",
        channels: "Creator One",
        channelSort: "latest",
        resetFeed: true
      });
      assert.equal(afterWatchFetch.status, 200);
      assert.equal(afterWatchFetch.body.pool.initializedRoot, false);
      assert.equal(afterWatchFetch.body.pool.expandedPool, false);
      assert.equal(fakeYoutubeClient.calls.videoSearch, firstCounts.videoSearch);

      return {
        firstFeed: firstFeed.body,
        secondFeed: secondFeed.body,
        afterWatchFeed: afterWatchFeed.body,
        afterWatchFetch: afterWatchFetch.body
      };
    });

    const feedLogs = logs.filter((log) => log.line.event === "feed.request");
    const watchLogs = logs.filter((log) => log.line.event === "watch_event.saved");
    const profileLogs = logs.filter((log) => String(log.line.event).startsWith("profile."));

    assert.equal(feedLogs.length, 4);
    assert.equal(watchLogs.length, 1);
    assert.equal(profileLogs.length, 0);
    assert.equal(feedLogs[0].line.summary.poolStatus, "initialized");
    assert.equal(feedLogs[0].line.summary.expandedPool, true);
    assert.equal(feedLogs[1].line.summary.poolStatus, "served");
    assert.equal(feedLogs[3].line.summary.expandedPool, false);

    assert.ok(flow.firstFeed.pool.videos <= flow.firstFeed.pool.targetVideos);
    assert.ok(flow.afterWatchFetch.pool.videos <= flow.afterWatchFetch.pool.targetVideos);
  } finally {
    if (profileId) {
      profileStore.resetProfile(profileId);
      profileStore.deleteProfile(profileId);
    }
  }
});

test("runtime feed builds one combined root pool across all tags", async () => {
  const tagConfig = writeRuntimeConfig("runtime-combined-root.json", {
    feed: {
      maxQueries: 2
    }
  });
  const fakeYoutubeClient = createFakeYoutubeClient();
  const { feedBuildRoute, profilesRoute, profileStore } = loadRuntimeModules(fakeYoutubeClient);
  let profileId = "";

  try {
    await captureLogs(async () => {
      process.env.GRETEL_CONFIG = tagConfig;
      const created = await postJson(profilesRoute, { name: "Tag Tabs Profile" });
      assert.equal(created.status, 200);
      profileId = created.body.profileId;

      const response = await postJson(feedBuildRoute, {
        profileId,
        tags: "alpha, beta"
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.videos.length > 0, true);
      assert.equal(
        response.body.videos
          .filter((video) => video.sourceNodeId === "tagSearch")
          .every((video) => /alpha|beta/i.test(video.title)),
        true
      );
      assert.equal(fakeYoutubeClient.calls.videoSearch, 2);
    });
  } finally {
    if (profileId) {
      profileStore.deleteProfile(profileId);
    }
  }
});
