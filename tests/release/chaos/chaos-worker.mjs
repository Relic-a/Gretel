import { createRequire } from "node:module";
import { createServer } from "node:http";
import { copyFileSync, existsSync, chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const buildRoot = process.env.CHAOS_BUILD_DIR;
const caseDir = process.env.CHAOS_CASE_DIR;
const seed = Number(process.env.CHAOS_SEED || 1);
const resultPath = process.env.CHAOS_RESULT_FILE || path.join(caseDir || ".", "result.json");

function compiled(relativePath) {
  if (!buildRoot) throw new Error("CHAOS_BUILD_DIR is required");
  return require(path.join(buildRoot, relativePath.replace(/\.ts$/, ".js")));
}

function dbPath() {
  return path.join(process.env.GRETEL_DATA_DIR, "gretel.sqlite");
}

function writeBarrier(name, value = {}) {
  const barrierPath = path.join(caseDir, `${name}.barrier.json`);
  writeFileSync(barrierPath, JSON.stringify({ name, seed, at: Date.now(), ...value }) + "\n", { mode: 0o600 });
  return barrierPath;
}

function finish(value, exitCode = value.ok === false ? 1 : 0) {
  mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });
  writeFileSync(resultPath, JSON.stringify({ seed, ...value }) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: value.ok !== false, kind: value.kind || "worker" }) + "\n");
  process.exit(exitCode);
}

function video(id = `chaos-video-${seed}`) {
  return {
    id,
    title: `Synthetic video ${id}`,
    author: "Synthetic channel",
    duration: "1:00",
    query: "synthetic chaos",
    channelKey: "synthetic channel",
    thumbnailUrl: `https://provider.invalid/${id}.jpg`
  };
}

function profileSeed() {
  const store = compiled("lib/profile-store.ts");
  const pools = compiled("lib/feed/pool-store.ts");
  const profile = store.createProfile(`Chaos profile ${seed}`, ["synthetic chaos"], ["Synthetic channel"]);
  const item = video();
  const saved = store.saveWatchedVideo({ profileId: profile.id, video: item, watchedSeconds: 60, durationSeconds: 60 });
  const savedCopy = store.saveVideo(profile.id, item);
  const liked = store.likeVideo(profile.id, item);
  const interacted = store.recordVideoInteraction(profile.id, item.id, { clicked: true, ignoreCount: 1 });
  const impressions = store.recordVideoImpressions(profile.id, [item.id, `${item.id}-second`]);
  const poolKey = pools.createFeedPoolKey({ tags: profile.tags, channels: profile.channels, channelSort: "balanced" });
  pools.markRootDiscovered(profile.id, poolKey, Date.now());
  pools.addPoolNodes(profile.id, poolKey, "tagSearch", [item, video(`${item.id}-second`)], Date.now());
  writeBarrier("write-committed", { profileId: profile.id, videoId: item.id });
  if (process.env.CHAOS_HOLD === "1") {
    process.on("SIGTERM", () => finish({ ok: true, kind: "terminated-after-write" }));
    return new Promise(() => {});
  }
  finish({
    ok: saved && savedCopy && liked && interacted && impressions === 2,
    kind: "profile-seed",
    profileId: profile.id,
    videoId: item.id,
    poolKey,
    counts: { saved, savedCopy, liked, interacted, impressions }
  });
}

function profileVerify() {
  const store = compiled("lib/profile-store.ts");
  const database = store.getDatabase();
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeys = database.pragma("foreign_key_check");
  const profiles = store.listProfiles();
  const profile = profiles[0];
  const history = profile ? store.listHistoryVideos(profile.id) : [];
  const saved = profile ? store.listSavedVideos(profile.id) : [];
  const liked = profile ? store.getLikedVideoIds(profile.id) : [];
  const result = {
    ok: integrity === "ok" && foreignKeys.length === 0 && profiles.length === 1 && history.length === 1 && saved.length === 1 && liked.length === 1,
    kind: "profile-verify",
    integrity,
    foreignKeys: foreignKeys.length,
    profiles: profiles.length,
    history: history.length,
    saved: saved.length,
    liked: liked.length
  };
  finish(result);
}

async function createFixtureServer(mode) {
  let requestCount = 0;
  let firstRequestResolve;
  const firstRequest = new Promise((resolve) => { firstRequestResolve = resolve; });
  const server = createServer((request, response) => {
    requestCount += 1;
    if (firstRequestResolve) firstRequestResolve();
    process.stderr.write(`network.fixture.request ${mode}\n`);
    if (mode === "hold") return;
    if (mode === "reset") {
      request.socket.destroy();
      return;
    }
    if (mode === "timeout") return;
    if (mode === "429") {
      response.writeHead(429, { "Retry-After": "0" });
      response.end("rate limited");
      return;
    }
    if (mode === "500") {
      response.writeHead(500);
      response.end("upstream failure");
      return;
    }
    if (mode === "partial") {
      // Aborted HTTP stream: partial payload before socket destruction
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"data":[');
      request.socket.destroy();
      return;
    }
    if (mode === "malformed") {
      // Complete HTTP response containing invalid JSON
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"data": [ not-valid-json');
      return;
    }
    if (mode === "wrong-length") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }));
      return;
    }
    if (mode === "nan") {
      // Valid JSON containing the string "NaN": malformed vector component type, not numeric NaN.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ index: 0, embedding: ["NaN", 0, 0, 0] }] }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    firstRequest,
    url: `http://127.0.0.1:${server.address().port}`,
    get requestCount() { return requestCount; }
  };
}

function writeNetworkConfig(baseUrl) {
  const configPath = process.env.GRETEL_CONFIG;
  const config = {
    embeddings: {
      provider: "openrouter",
      openRouterApiKeyEnv: "CHAOS_PROVIDER_KEY",
      openRouterBaseUrl: baseUrl,
      model: "synthetic/embedding",
      dimensions: 4,
      requestTimeoutMs: 120,
      batchSize: 1,
      maxConcurrentRequests: 1
    }
  };
  writeFileSync(configPath, JSON.stringify(config) + "\n", { mode: 0o600 });
}

async function network(mode) {
  const fixture = await createFixtureServer(mode);
  process.stderr.write(`network.fixture.ready ${mode}\n`);
  writeNetworkConfig(fixture.url);
  process.env.CHAOS_PROVIDER_KEY = `synthetic-provider-key-${seed}`;
  const store = compiled("lib/profile-store.ts");
  const pools = compiled("lib/feed/pool-store.ts");
  const profile = store.createProfile(`Network profile ${seed}`, ["synthetic"], []);
  const poolKey = pools.createFeedPoolKey({ tags: profile.tags, channels: profile.channels, channelSort: "balanced" });
  pools.markRootDiscovered(profile.id, poolKey, Date.now());
  pools.addPoolNodes(profile.id, poolKey, "tagSearch", [video(`prior-${seed}`)], Date.now());
  try {
    const embeddings = compiled("lib/feed/embeddings.ts");
    const provider = embeddings.getEmbeddingProvider();
    process.stderr.write("network.provider.ready\n");
    let error = "";
    let vectors = [];
    try {
      const pending = provider.embedTexts(["synthetic chaos"]);
      process.stderr.write("network.embed.pending\n");
      vectors = await pending;
      process.stderr.write("network.embed.resolved\n");
    } catch (caught) {
      process.stderr.write(`network.embed.error ${caught instanceof Error ? caught.name : "unknown"}\n`);
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const expectedSuccess = mode === "success";
    const priorPoolPreserved = pools.listPoolNodes(profile.id, poolKey).length === 1;

    // For mode "nan": valid JSON was parsed, but vector components must be checked for finite numbers
    const hasNonFinite = vectors.length > 0 && vectors.some((v) => v.some((x) => !Number.isFinite(x)));
    let modeOk = expectedSuccess ? vectors.length === 1 && vectors[0].length === 4 : Boolean(error) && priorPoolPreserved;
    if (mode === "nan") {
      // If error is thrown on NaN vector, vector validation succeeded. If unvalidated NaN vector is returned, fail honestly.
      modeOk = Boolean(error) && !hasNonFinite && priorPoolPreserved;
    }

    finish({
      ok: modeOk,
      kind: "network",
      mode,
      requestCount: fixture.requestCount,
      bounded: fixture.requestCount <= 3,
      succeeded: vectors.length === 1,
      hasNonFinite,
      errorClass: error ? error.split(":")[0].slice(0, 80) : (hasNonFinite ? "Unvalidated non-finite vector produced" : ""),
      priorPoolPreserved
    });
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

async function networkHold() {
  const fixture = await createFixtureServer("hold");
  writeNetworkConfig(fixture.url);
  process.env.CHAOS_PROVIDER_KEY = `synthetic-provider-key-${seed}`;
  const store = compiled("lib/profile-store.ts");
  const pools = compiled("lib/feed/pool-store.ts");
  const profile = store.createProfile(`Network hold profile ${seed}`, ["synthetic"], []);
  const durableItem = video(`prior-hold-${seed}`);
  store.saveWatchedVideo({ profileId: profile.id, video: durableItem, watchedSeconds: 60, durationSeconds: 60 });
  store.saveVideo(profile.id, durableItem);
  store.likeVideo(profile.id, durableItem);
  const poolKey = pools.createFeedPoolKey({ tags: profile.tags, channels: profile.channels, channelSort: "balanced" });
  pools.markRootDiscovered(profile.id, poolKey, Date.now());
  pools.addPoolNodes(profile.id, poolKey, "tagSearch", [video(`prior-hold-${seed}`)], Date.now());
  const embeddings = compiled("lib/feed/embeddings.ts");
  const pending = embeddings.getEmbeddingProvider().embedTexts(["in-flight synthetic request"]);
  await fixture.firstRequest;
  writeBarrier("provider-in-flight", { requestCount: fixture.requestCount });
  if (process.env.CHAOS_HOLD === "1") {
    process.on("SIGTERM", () => finish({ ok: true, kind: "terminated-in-flight" }));
    await new Promise(() => {});
  }
  await pending.catch(() => {});
  await new Promise((resolve) => fixture.server.close(resolve));
  finish({ ok: true, kind: "network-hold", requestCount: fixture.requestCount });
}

async function thumbnailHold() {
  // Create fixture image server that delivers a valid JPEG
  const sampleJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    ...new Array(1024).fill(0x55),
    0xff, 0xd9
  ]);

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(sampleJpeg);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const videoId = `cache-in-flight-${seed}`;
  process.env.CHAOS_CACHE_VIDEO_ID = videoId;
  const thumbnails = compiled("lib/feed/thumbnails.ts");

  // Intercept the fs.promises.writeFile call on the thumbnail temp file to capture the real disk write boundary
  const nodeFs = require("node:fs");
  const origPromisesWriteFile = nodeFs.promises.writeFile;
  let barrierSet = false;
  nodeFs.promises.writeFile = async function(targetPath, ...args) {
    if (String(targetPath).includes(".tmp") && String(targetPath).includes(videoId)) {
      barrierSet = true;
      writeBarrier("thumbnail-write-in-flight", { tempPath: String(targetPath), videoId });
      if (process.env.CHAOS_HOLD === "1") {
        await new Promise(() => {}); // hold until SIGKILL
      }
    }
    return origPromisesWriteFile.apply(this, [targetPath, ...args]);
  };

  const port = server.address().port;
  const pending = thumbnails.getOrFetchThumbnail(videoId, `http://127.0.0.1:${port}/maxresdefault.jpg`);

  // Wait a short time for the fetch & write to trigger
  await new Promise((resolve) => setTimeout(resolve, 500));
  await pending.catch(() => null);
  await new Promise((resolve) => server.close(resolve));
  finish({ ok: barrierSet, kind: "thumbnail-hold" });
}

async function thumbnailVerify() {
  const thumbnails = compiled("lib/feed/thumbnails.ts");
  const cached = await thumbnails.getCachedThumbnail(process.env.CHAOS_CACHE_VIDEO_ID || `cache-in-flight-${seed}`);
  finish({ ok: cached === null, kind: "thumbnail-verify", partialCache: cached !== null });
}

function settingsHold(mode = "production") {
  const settings = compiled("lib/settings.ts");
  const settingsPath = path.join(process.env.GRETEL_DATA_DIR, "user-settings.json");
  mkdirSync(process.env.GRETEL_DATA_DIR, { recursive: true, mode: 0o700 });

  // 1. Persist known valid initial settings
  const initialSettings = {
    openRouterApiKey: `synthetic-initial-key-${seed}`,
    openRouterModel: "synthetic-initial-model",
    developerAnalytics: true
  };
  settings.setUserSettings(initialSettings);
  const readBack = settings.getUserSettings();
  if (readBack.openRouterApiKey !== initialSettings.openRouterApiKey) {
    finish({ ok: false, kind: "settings-hold", error: "Failed to persist initial settings" });
    return;
  }

  // 2. Arm write interceptor on node:fs
  const fsModule = require("node:fs");
  const origWriteFileSync = fsModule.writeFileSync;
  let armed = true;

  // One barrier handles final-file and temp-file writes. Match the synthetic
  // settings payload, rather than assuming the implementation's destination name.
  fsModule.writeFileSync = function(targetPath, data, options) {
    const payload = String(data);
    if (armed && payload.includes(`synthetic-updated-key-${seed}`) && path.dirname(String(targetPath)) === path.dirname(settingsPath)) {
      armed = false;
      const destination = mode === "atomic-fixture" && String(targetPath) === settingsPath ? `${settingsPath}.fixture.tmp` : targetPath;
      const fd = fsModule.openSync(destination, "w", 0o600);
      fsModule.writeSync(fd, payload.slice(0, 15));
      fsModule.closeSync(fd);
      writeBarrier("settings-write", {targetPath: destination, boundary: String(destination) === settingsPath ? "final-write-partial" : "temporary-write-partial"});
      if (process.env.CHAOS_HOLD === "1") while (true) {}
      origWriteFileSync.call(this, destination, data, options);
      if (destination !== targetPath && mode === "atomic-fixture") fsModule.renameSync(destination, targetPath);
      return;
    }
    return origWriteFileSync.apply(this, arguments);
  };

  // 3. Initiate second write
  const updatedSettings = {
    openRouterApiKey: `synthetic-updated-key-${seed}`,
    openRouterModel: "synthetic-updated-model",
    developerAnalytics: false
  };
  settings.setUserSettings(updatedSettings);

  finish({ ok: true, kind: "settings-hold", completedWithoutBarrier: true });
}

function settingsVerify() {
  const settings = compiled("lib/settings.ts");
  const recovered = settings.getUserSettings();
  const expectedOld = `synthetic-initial-key-${seed}`;
  const expectedNew = `synthetic-updated-key-${seed}`;
  const isValidOld = JSON.stringify(recovered) === JSON.stringify({openRouterApiKey:expectedOld, openRouterModel:"synthetic-initial-model", developerAnalytics:true});
  const isValidNew = JSON.stringify(recovered) === JSON.stringify({openRouterApiKey:expectedNew, openRouterModel:"synthetic-updated-model"});
  const ok = isValidOld || isValidNew;
  finish({
    ok,
    kind: "settings-verify",
    recovered,
    isValidOld,
    isValidNew,
    expectedOld,
    expectedNew
  });
}

function writeFeedChaosConfig() {
  const configPath = process.env.GRETEL_CONFIG;
  const config = {
    embeddings: {
      provider: "mock",
      model: "mock/hash-v1",
      dimensions: 4,
      mockSeed: seed
    },
    feed: {
      maxVideos: 12,
      poolSizeCap: 40,
      minFreshVideos: 0,
      minFreshRatio: 0,
      maxQueries: 5
    },
    expansion: {
      initialExpansionCycles: 0,
      maxFetchCallsPerCycle: 0,
      minFreshVideos: 0,
      minFreshRatio: 0,
      minExpansionYield: 0
    }
  };
  writeFileSync(configPath, JSON.stringify(config) + "\n", { mode: 0o600 });
}

function setupMockYouTubeAndFeed(fault = false) {
  const youtube = compiled("lib/feed/youtube.ts");
  youtube.searchVideos = async () => {
    if (fault) {
      throw new Error("Simulated deterministic YouTube provider 500 error");
    }
    return [
      video(`feed-${seed}-1`),
      video(`feed-${seed}-2`),
      video(`feed-${seed}-3`)
    ];
  };
}

async function feedRefreshSeed() {
  writeFeedChaosConfig();
  setupMockYouTubeAndFeed(false);
  const store = compiled("lib/profile-store.ts");
  const buildRoute = compiled("app/api/feed/build/route.ts");
  const feedRoute = compiled("app/api/feed/route.ts");

  const profile = store.createProfile(`Feed refresh profile ${seed}`, ["synthetic chaos"], []);
  process.env.GRETEL_API_TOKEN = `synthetic-token-${seed}`;

  // Build initial feed
  const buildRes = await buildRoute.POST(new Request("http://gretel.test/api/feed/build", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: profile.id, tags: ["synthetic chaos"], channels: [] })
  }));

  // Query feed page
  const feedRes = await feedRoute.POST(new Request("http://gretel.test/api/feed", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: profile.id, tags: ["synthetic chaos"], channels: [] })
  }));
  const feedData = await feedRes.json();
  const initialVideos = feedData.videos ? feedData.videos.map((v) => v.id) : [];

  // Save state file
  const statePath = path.join(caseDir, "seed-feed.json");
  writeFileSync(statePath, JSON.stringify({ profileId: profile.id, initialVideos, initialRecords:feedData.videos.map(stableVideo) }) + "\n", { mode: 0o600 });

  finish({
    ok: buildRes.status === 200 && initialVideos.length >= 2,
    kind: "feed-refresh-seed",
    profileId: profile.id,
    initialVideos,
    buildStatus: buildRes.status
  });
}

async function feedRefreshFault() {
  setupMockYouTubeAndFeed(true); // Fault injected at provider boundary
  const buildRoute = compiled("app/api/feed/build/route.ts");
  const feedRoute = compiled("app/api/feed/route.ts");

  const statePath = path.join(caseDir, "seed-feed.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  process.env.GRETEL_API_TOKEN = `synthetic-token-${seed}`;

  // Trigger refresh with new interest tag - triggers new pool initialization which fails at provider boundary
  const tagsWithNewInterest = ["synthetic chaos", "fault-topic"];
  let buildStatus = 500;
  try {
    const buildRes = await buildRoute.POST(new Request("http://gretel.test/api/feed/build", {
      method: "POST",
      headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
      body: JSON.stringify({ profileId: state.profileId, tags: tagsWithNewInterest, channels: [] })
    }));
    buildStatus = buildRes.status;
  } catch {
    buildStatus = 500;
  }

  // Verify prior feed is preserved without partial replacement
  const feedRes = await feedRoute.POST(new Request("http://gretel.test/api/feed", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: state.profileId, tags: ["synthetic chaos"], channels: [] })
  }));
  const feedData = await feedRes.json();
  const currentVideos = feedData.videos ? feedData.videos.map((v) => v.id) : [];

  const feedPreserved = currentVideos.length === state.initialVideos.length &&
    currentVideos.every((id, idx) => id === state.initialVideos[idx]) && JSON.stringify(feedData.videos.map(stableVideo)) === JSON.stringify(state.initialRecords);

  finish({
    ok: buildStatus >= 400 && feedPreserved && currentVideos.length > 0,
    kind: "feed-refresh-fault",
    buildStatus,
    feedPreserved,
    currentVideosCount: currentVideos.length,
    expectedVideosCount: state.initialVideos.length
  });
}

async function feedRefreshRecover() {
  writeFeedChaosConfig();
  const feedRoute = compiled("app/api/feed/route.ts");
  const buildRoute = compiled("app/api/feed/build/route.ts");

  const statePath = path.join(caseDir, "seed-feed.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  process.env.GRETEL_API_TOKEN = `synthetic-token-${seed}`;

  // Check that prior feed is still intact after simulated restart
  const restartFeedRes = await feedRoute.POST(new Request("http://gretel.test/api/feed", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: state.profileId, tags: ["synthetic chaos"], channels: [] })
  }));
  const restartFeedData = await restartFeedRes.json();
  const restartVideos = restartFeedData.videos ? restartFeedData.videos.map((v) => v.id) : [];
  const restartPreserved = JSON.stringify(restartVideos) === JSON.stringify(state.initialVideos) && JSON.stringify(restartFeedData.videos.map(stableVideo)) === JSON.stringify(state.initialRecords);

  // Restore healthy provider
  setupMockYouTubeAndFeed(false);

  // Trigger subsequent build with the new interest - must succeed
  const tagsWithNewInterest = ["synthetic chaos", "fault-topic"];
  const buildRes = await buildRoute.POST(new Request("http://gretel.test/api/feed/build", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: state.profileId, tags: tagsWithNewInterest, channels: [] })
  }));

  const newFeedRes = await feedRoute.POST(new Request("http://gretel.test/api/feed", {
    method: "POST",
    headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN },
    body: JSON.stringify({ profileId: state.profileId, tags: tagsWithNewInterest, channels: [] })
  }));
  const newFeedData = await newFeedRes.json();
  const subsequentBuildOk = buildRes.status === 200 && newFeedData.videos && newFeedData.videos.length > 0;

  finish({
    ok: restartPreserved && subsequentBuildOk,
    kind: "feed-refresh-recover",
    restartPreserved,
    subsequentBuildOk,
    buildStatus: buildRes.status
  });
}

async function samePoolFault() {
  const state = JSON.parse(readFileSync(path.join(caseDir,"seed-feed.json"),"utf8"));
  const config = JSON.parse(readFileSync(process.env.GRETEL_CONFIG,"utf8"));
  config.expansion.minFreshVideos = 100; config.expansion.minFreshRatio = 1; config.feed.expansionSeedCount = 2;
  writeFileSync(process.env.GRETEL_CONFIG,JSON.stringify(config));
  const pools = compiled("lib/feed/pool-store.ts");
  const key = pools.createFeedPoolKey({tags:["synthetic chaos"],channels:[],channelSort:"mixed"});
  const before = pools.listPoolNodes(state.profileId,key);
  let providerAcknowledged = false, embeddingAcknowledged = false;
  compiled("lib/feed/recommendations.ts").recommendVideosFromSeeds = async () => {
    providerAcknowledged = true;
    writeBarrier("same-pool-candidates",{count:1,poolKey:key});
    return [video(`partial-candidate-${seed}`)];
  };
  const embeddings = compiled("lib/feed/embeddings.ts");
  const originalProvider = embeddings.getEmbeddingProvider;
  embeddings.getEmbeddingProvider = () => ({...originalProvider(), embedTexts:async () => {embeddingAcknowledged=true;writeBarrier("same-pool-embedding-failure",{poolKey:key});throw Error("Synthetic embedding failure after candidate response");}});
  let failed = false;
  try { await compiled("lib/feed/service.ts").expandFeedPoolForImpressions(state.profileId,["synthetic chaos"],[],"mixed",compiled("lib/feed/observation.ts").createFeedObservation("chaos.same-pool"), {watchedVideoIds:before.map(v=>v.id)}); } catch {failed=true;}
  const after = pools.listPoolNodes(state.profileId,key);
  const preserved = JSON.stringify(before) === JSON.stringify(after);
  embeddings.getEmbeddingProvider = originalProvider;
  await compiled("lib/feed/service.ts").expandFeedPoolForImpressions(state.profileId,["synthetic chaos"],[],"mixed",compiled("lib/feed/observation.ts").createFeedObservation("chaos.same-pool-recovery"),{watchedVideoIds:before.map(v=>v.id)});
  const recovered = pools.listPoolNodes(state.profileId,key);
  const recoveryOk = recovered.some(v=>v.id===`partial-candidate-${seed}`) && before.every(v=>recovered.some(r=>r.id===v.id && r.title===v.title));
  config.expansion.minFreshRatio = 0; writeFileSync(process.env.GRETEL_CONFIG,JSON.stringify(config));
  finish({ok:failed && providerAcknowledged && embeddingAcknowledged && preserved && recoveryOk && before.length>0,kind:"same-pool-fault",failed,providerAcknowledged,embeddingAcknowledged,preserved,recoveryOk,before,after,recovered});
}

function configChaos(mode) {
  const configPath = process.env.GRETEL_CONFIG;
  if (mode === "malformed-config") writeFileSync(configPath, '{"serving":{"impressionPenaltyFactor":', { mode: 0o600 });
  if (mode === "invalid-types") writeFileSync(configPath, JSON.stringify({ serving: { impressionPenaltyFactor: "bad" }, embeddings: 123 }), { mode: 0o600 });
  if (mode === "absent-config" && existsSync(configPath)) unlinkSync(configPath);
  const settingsPath = path.join(process.env.GRETEL_DATA_DIR, "user-settings.json");
  if (mode === "malformed-settings") {
    mkdirSync(process.env.GRETEL_DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(settingsPath, "[broken", { mode: 0o600 });
  }
  if (mode === "corrupt-sqlite") {
    const Database = require("better-sqlite3");
    const backupPath = `${dbPath()}.operator-backup`;
    const checkpoint = new Database(dbPath());
    checkpoint.pragma("wal_checkpoint(TRUNCATE)");
    checkpoint.close();
    copyFileSync(dbPath(), backupPath);
    for (const sidecar of [`${dbPath()}-wal`, `${dbPath()}-shm`]) if (existsSync(sidecar)) unlinkSync(sidecar);
    writeFileSync(dbPath(), Buffer.from("this is not sqlite\n"), { mode: 0o600 });
    let rejected = false;
    try {
      compiled("lib/profile-store.ts").getDatabase();
    } catch {
      rejected = true;
    }
    copyFileSync(backupPath, dbPath());
    const restoredStore = compiled("lib/profile-store.ts");
    const integrity = restoredStore.getDatabase().pragma("integrity_check", { simple: true });
    const restoredProfiles = restoredStore.listProfiles().length;
    unlinkSync(backupPath);
    finish({ ok: rejected && integrity === "ok" && restoredProfiles > 0, kind: "config", mode, recoverable: rejected, restored: integrity === "ok" && restoredProfiles > 0, reason: rejected ? "Corrupt SQLite rejected explicitly and operator backup restored." : "corrupt SQLite was accepted" });
    return;
  }
  const config = compiled("lib/feed/config.ts");
  const settings = compiled("lib/settings.ts");
  const effective = config.getGretelConfig();
  const publicConfig = config.getPublicGretelConfig();
  const parsedSettings = settings.getUserSettings();
  let malformedPoolHandled = true;
  if (mode === "malformed-pool") {
    const store = compiled("lib/profile-store.ts");
    const profile = store.createProfile("Pool corruption fixture");
    const database = store.getDatabase();
    database.prepare("INSERT INTO saved_videos(profile_id, video_id, video_json, saved_at) VALUES (?, ?, ?, ?)").run(profile.id, "bad-video", "{broken", Date.now());
    malformedPoolHandled = store.listSavedVideos(profile.id).length === 0;
  }
  const safeDefaults = Number.isFinite(effective.serving.impressionPenaltyFactor) && typeof publicConfig.embeddings.provider === "string";
  finish({
    ok: safeDefaults && Object.keys(parsedSettings).length === 0 && malformedPoolHandled,
    kind: "config",
    mode,
    safeDefaults,
    malformedPoolHandled,
    publicConfigKeys: Object.keys(publicConfig)
  });
}

function runDatabaseFault(mode) {
  if (mode === "seed") {
    const store = compiled("lib/profile-store.ts");
    const profile = store.createProfile(`Fault profile ${seed}`);
    finish({ ok: true, kind: "database-fault-seed", profileId: profile.id });
    return;
  }
  if (mode === "readonly-check") {
    const files = [dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`].filter(existsSync);
    let observed = false;
    try {
      chmodSync(process.env.GRETEL_DATA_DIR, 0o500);
      for (const file of files) chmodSync(file, 0o400);
      try {
        const store = compiled("lib/profile-store.ts");
        store.createProfile(`Should not persist ${seed}`);
      } catch {
        observed = true;
      }
    } finally {
      try { chmodSync(process.env.GRETEL_DATA_DIR, 0o700); } catch {}
      for (const file of files) try { chmodSync(file, 0o600); } catch {}
    }
    finish({ ok: observed, kind: "database-fault", mode, observed });
    return;
  }
  if (mode === "readonly-recover") {
    let recovered = false;
    try {
      const store = compiled("lib/profile-store.ts");
      const p = store.createProfile(`Recovered profile ${seed}`);
      recovered = Boolean(p && p.id);
    } catch {}
    finish({ ok: recovered, kind: "database-fault", mode, recovered });
    return;
  }
  const store = compiled("lib/profile-store.ts");
  const profile = store.createProfile(`Fault profile ${seed}`);
  const item = video(`fault-${seed}`);
  const Database = require("better-sqlite3");
  const lock = new Database(dbPath());
  lock.pragma("busy_timeout = 1");
  lock.exec("BEGIN EXCLUSIVE");
  let busy = false;
  try { store.saveVideo(profile.id, item); } catch (error) { busy = /busy|locked/i.test(String(error)); }
  try { lock.exec("ROLLBACK"); } catch {}
  lock.close();

  // Verify successful write after releasing lock
  let recovered = false;
  try {
    const saved = store.saveVideo(profile.id, item);
    recovered = Boolean(saved);
  } catch {}

  finish({ ok: busy && recovered, kind: "database-fault", mode: "sqlite-busy", observed: busy, recovered });
}

async function authChaos() {
  const routes = [
    ["config", "app/api/config/route.js", "GET"], ["settings", "app/api/settings/route.js", "GET"],
    ["profiles", "app/api/profiles/route.js", "GET"], ["feed", "app/api/feed/route.js", "POST"],
    ["feed-build", "app/api/feed/build/route.js", "POST"], ["client-errors", "app/api/client-errors/route.js", "POST"],
    ["performance", "app/api/performance/route.js", "GET"], ["history", "app/api/history/route.js", "GET"],
    ["liked", "app/api/liked-videos/route.js", "GET"], ["saved", "app/api/saved-videos/route.js", "GET"],
    ["impressions", "app/api/impressions/route.js", "POST"], ["comments", "app/api/comments/route.js", "POST"],
    ["watch-events", "app/api/watch-events/route.js", "POST"], ["search", "app/api/search/route.js", "POST"],
    ["channels-search", "app/api/channels/search/route.js", "GET"], ["video-info", "app/api/video-info/route.js", "GET"]
  ];
  const store = compiled("lib/profile-store.ts");
  store.createProfile(`Auth fixture ${seed}`);
  const beforeProfiles = store.listProfiles().length;
  const requests = (method, token) => new Request("http://gretel.test/api", {
    method,
    headers: token === undefined ? {} : { "x-gretel-token": token },
    body: method === "POST" ? JSON.stringify({ profileId: "missing", query: "synthetic", videoIds: ["x"], video: video("x") }) : undefined
  });
  let passed = 0;
  const results = [];
  for (const [name, relative, method] of routes) {
    const route = require(path.join(buildRoot, relative));
    for (const token of [undefined, "wrong-token"]) {
      const response = await route[method](requests(method, token));
      const good = response.status === 401;
      results.push({ name, token: token === undefined ? "missing" : "wrong", status: response.status, good });
      if (good) passed += 1;
    }
  }
  const afterProfiles = store.listProfiles().length;
  finish({ ok: passed === routes.length * 2 && beforeProfiles === afterProfiles, kind: "api-auth", routes: routes.length, attempts: routes.length * 2, passed, mutationFree: beforeProfiles === afterProfiles, results });
}

async function privacyChaos() {
  const canary = `GRETEL-CANARY-${seed}-Qz9secret`;
  process.env.GRETEL_API_TOKEN = `synthetic-api-token-${seed}`;
  const route = compiled("app/api/client-errors/route.ts");
  await route.POST(new Request(`http://gretel.test/api/client-errors?token=${encodeURIComponent(canary)}`, {
    method: "POST",
    headers: {
      "x-gretel-token": process.env.GRETEL_API_TOKEN,
      cookie: `session=${canary}; HttpOnly`,
      "x-nested": JSON.stringify({ secret: canary })
    },
    body: JSON.stringify({
      source: "chaos",
      message: `upstream failed with ${canary}`,
      stack: `Error: ${canary}\n at synthetic (${canary}.mjs:1:1)`,
      url: `https://provider.invalid/callback?token=${encodeURIComponent(canary)}`,
      details: { nested: canary, array: [canary], cookie: `session=${canary}` }
    })
  }));
  const logger = compiled("lib/logger.ts");
  const settings = compiled("lib/settings.ts");
  settings.setUserSettings({ developerAnalytics: true });
  const metrics = compiled("lib/performance-metrics.ts");
  const trace = metrics.createPerformanceTrace("chaos.privacy", { profileId: canary });
  metrics.persistPerformanceTrace(trace, { diagnosticDetail: canary });
  logger.logError("chaos.error", {
    authorization: `Bearer ${canary}`,
    headers: { cookie: canary },
    nested: { error: new Error(`nested ${canary}`) },
    values: [canary]
  });
  await logger.flushLogFileWrites();
  finish({ ok: true, kind: "privacy", logFile: process.env.GRETEL_LOG_FILE });
}

async function concurrencyChaos() {
  const store = compiled("lib/profile-store.ts");
  const profiles = compiled("app/api/profiles/route.ts");
  const build = compiled("app/api/feed/build/route.ts");
  const profile = store.createProfile(`Concurrency profile ${seed}`, ["synthetic"], []);
  let fetchCalls = 0;
  let firstFetchResolve;
  const firstFetch = new Promise((resolve) => { firstFetchResolve = resolve; });

  // Intercept searchVideos at provider boundary
  const youtube = compiled("lib/feed/youtube.ts");
  youtube.searchVideos = async () => {
    fetchCalls += 1;
    if (firstFetchResolve) firstFetchResolve();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return [];
  };

  const body = { profileId: profile.id, tags: ["synthetic"], channels: [], channelSort: "balanced" };
  const builds = Array.from({ length: 20 }, () => build.POST(new Request("http://gretel.test/api/feed/build", {
    method: "POST", headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN }, body: JSON.stringify(body)
  })));
  const barrier = await Promise.race([firstFetch.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))]);
  const deletion = await profiles.POST(new Request("http://gretel.test/api/profiles", {
    method: "POST", headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN }, body: JSON.stringify({ action: "delete", profileId: profile.id })
  }));
  await Promise.allSettled(builds);
  const remaining = store.getProfile(profile.id);
  finish({ ok: barrier && !remaining && deletion.status < 500 && fetchCalls <= 1, kind: "concurrency", barrier, fetchCalls, deletionStatus: deletion.status, profileRemaining: Boolean(remaining), duplicateWork: fetchCalls > 1 });
}

async function diagnosticsChaos() {
  const settings = compiled("lib/settings.ts");
  const route = compiled("app/api/performance/route.ts");
  const before = await route.GET(new Request("http://gretel.test/api/performance", { headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN } }));
  settings.setUserSettings({ developerAnalytics: true });
  const after = await route.GET(new Request("http://gretel.test/api/performance", { headers: { "x-gretel-token": process.env.GRETEL_API_TOKEN } }));
  const body = await after.json();
  const hasSupportBundle = Object.keys(body).some((key) => /bundle|export|download/i.test(key));
  finish({ ok: false, kind: "diagnostics", blocked: !hasSupportBundle, beforeStatus: before.status, afterStatus: after.status, reason: "No user-obtainable sanitized support bundle/action exists; /diagnostics exposes local performance analytics only." });
}

async function main() {
  const operation = process.argv[2];
  if (operation === "profile-seed") return profileSeed();
  if (operation === "profile-verify") return profileVerify();
  if (operation === "network") return network(process.argv[3] || "success");
  if (operation === "network-hold") return networkHold();
  if (operation === "thumbnail-hold") return thumbnailHold();
  if (operation === "thumbnail-verify") return thumbnailVerify();
  if (operation === "settings-hold") return settingsHold(process.argv[3] || "production");
  if (operation === "settings-verify") return settingsVerify();
  if (operation === "feed-refresh-seed") return feedRefreshSeed();
  if (operation === "same-pool-fault") return samePoolFault();
  if (operation === "feed-refresh-fault") return feedRefreshFault();
  if (operation === "feed-refresh-recover") return feedRefreshRecover();
  if (operation === "config") return configChaos(process.argv[3] || "malformed-config");
  if (operation === "db-fault") return runDatabaseFault(process.argv[3] || "readonly");
  if (operation === "api-auth") return authChaos();
  if (operation === "privacy") return privacyChaos();
  if (operation === "concurrency") return concurrencyChaos();
  if (operation === "diagnostics") return diagnosticsChaos();
  if (operation === "negative-fail") { finish({ ok: false, kind: "intentional-negative" }, 42); return; }
  if (operation === "negative-hold") { writeBarrier("negative-cancellation"); await new Promise(() => {}); return; }
  throw new Error(`Unknown chaos worker operation: ${operation}`);
}

main().catch((error) => {
  finish({ ok: false, kind: "worker-error", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error).slice(0, 500) });
  process.exitCode = 1;
});

function stableVideo(v) { return {id:v.id,title:v.title,author:v.author,duration:v.duration,query:v.query}; }
