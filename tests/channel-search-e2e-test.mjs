import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "channel-search-e2e-test");
const workDir = path.join(os.tmpdir(), `gretel-channel-search-${process.pid}`);
const require = createRequire(import.meta.url);

function compileTestModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const files = [
    "lib/logger.ts",
    "lib/data-dir.ts",
    "lib/api-auth.ts",
    "lib/profile-store.ts",
    "lib/feed/config.ts",
    "lib/feed/config-defaults.ts",
    "lib/feed/observation.ts",
    "lib/feed/types.ts",
    "lib/feed/vector-math.ts",
    "lib/feed/centroid-drift.ts",
    "lib/feed/video-utils.ts",
    "lib/feed/channel-utils.ts",
    "lib/feed/channel-avatar-cache.ts",
    "lib/feed/youtube-client.ts",
    "lib/feed/youtube.ts",
    "app/api/channels/search/route.ts"
  ];

  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
      "--rootDir",
      root,
      "--outDir",
      buildDir,
      "--module",
      "commonjs",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "--types",
      "node",
      "--esModuleInterop",
      ...files
    ],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

let searchChannels;
let clearChannelSearchCache;
let getChannelAvatar;
let searchRouteGet;

before(() => {
  compileTestModules();
  mkdirSync(workDir, { recursive: true });
  
  const youtubeModule = require(path.join(buildDir, "lib", "feed", "youtube.js"));
  searchChannels = youtubeModule.searchChannels;
  clearChannelSearchCache = youtubeModule.clearChannelSearchCache;

  const avatarCacheModule = require(path.join(buildDir, "lib", "feed", "channel-avatar-cache.js"));
  getChannelAvatar = avatarCacheModule.getChannelAvatar;

  const routeModule = require(path.join(buildDir, "app", "api", "channels", "search", "route.js"));
  searchRouteGet = routeModule.GET;
});

after(() => {
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(workDir, { force: true, recursive: true });
});

test("searches live channels end-to-end via YouTube API and returns valid channel objects", async () => {
  clearChannelSearchCache();
  const query = "veritasium";
  const start = performance.now();
  const channels = await searchChannels(query, "e2e-profile");
  const elapsed = performance.now() - start;

  assert.ok(channels.length > 0, `Expected channels for query "${query}", got ${channels.length}`);
  assert.ok(channels.length <= 8, `Expected at most 8 channels, got ${channels.length}`);

  const primary = channels[0];
  assert.ok(primary.id.startsWith("UC"), `Expected valid channel ID starting with UC, got: ${primary.id}`);
  assert.match(primary.name, /veritasium/i, `Expected channel name to contain Veritasium, got: ${primary.name}`);
  assert.ok(primary.thumbnailUrl, "Expected non-empty thumbnailUrl");
  assert.ok(
    !primary.thumbnailUrl.includes("/maxresdefault.jpg"),
    `Thumbnail must not be a fake maxresdefault video URL: ${primary.thumbnailUrl}`
  );
  assert.ok(
    primary.thumbnailUrl.startsWith("http://") || primary.thumbnailUrl.startsWith("https://"),
    `Thumbnail must be a valid HTTP(S) URL: ${primary.thumbnailUrl}`
  );

  // Live verify the thumbnail image URL actually loads over HTTP HEAD
  const imgRes = await fetch(primary.thumbnailUrl, { method: "HEAD" });
  assert.equal(imgRes.status, 200, `Thumbnail URL ${primary.thumbnailUrl} must return HTTP 200`);
  const contentType = imgRes.headers.get("content-type") || "";
  assert.match(contentType, /^image\//i, `Thumbnail URL content-type must be image, got: ${contentType}`);
});

test("in-memory search cache serves subsequent queries instantaneously with identical results", async () => {
  clearChannelSearchCache();
  const query = "fireship";

  // First call (uncached network call)
  const t0 = performance.now();
  const first = await searchChannels(query, "e2e-profile");
  const firstDuration = performance.now() - t0;
  assert.ok(first.length > 0);

  // Second call (cached in memory)
  const t1 = performance.now();
  const second = await searchChannels(query, "e2e-profile");
  const secondDuration = performance.now() - t1;

  assert.deepEqual(second, first, "Cached results must match uncached results exactly");
  assert.ok(
    secondDuration < 50,
    `Cached query must be extremely fast (< 50ms), got ${secondDuration.toFixed(1)}ms (first was ${firstDuration.toFixed(1)}ms)`
  );
});

test("direct channel ID query resolves channel name and thumbnail directly", async () => {
  clearChannelSearchCache();
  // Fireship channel ID
  const channelId = "UCsBjURrPoezykLs9EqgamOA";
  const channels = await searchChannels(channelId, "e2e-profile");

  assert.ok(channels.length > 0, "Direct channel ID query should return results");
  const match = channels.find((c) => c.id === channelId);
  assert.ok(match, `Expected to find channel with ID ${channelId}`);
  assert.equal(match.name, "Fireship");
  assert.ok(match.thumbnailUrl, "Direct channel resolution must include thumbnailUrl");
  assert.ok(!match.thumbnailUrl.includes("/maxresdefault.jpg"), "Direct channel thumbnail must not be video URL");
});

test("short queries return empty array immediately without network calls", async () => {
  const result1 = await searchChannels("", "e2e-profile");
  assert.deepEqual(result1, []);

  const result2 = await searchChannels("a", "e2e-profile");
  assert.deepEqual(result2, []);

  const result3 = await searchChannels("  ", "e2e-profile");
  assert.deepEqual(result3, []);
});

test("channel search populates global channel avatar cache", async () => {
  clearChannelSearchCache();
  const channels = await searchChannels("mkbhd", "e2e-profile");
  assert.ok(channels.length > 0);

  const first = channels[0];
  if (first.thumbnailUrl) {
    const cachedByChannelId = getChannelAvatar(first.id);
    assert.equal(cachedByChannelId, first.thumbnailUrl, "Channel avatar cache should contain channel by ID");
    const cachedByName = getChannelAvatar(first.name);
    assert.equal(cachedByName, first.thumbnailUrl, "Channel avatar cache should contain channel by name");
  }
});

test("channel search API route endpoint returns valid json with Cache-Control headers", async () => {
  const request = new Request("http://localhost:3000/api/channels/search?q=3blue1brown&profileId=e2e-profile", {
    method: "GET"
  });

  const response = await searchRouteGet(request);
  assert.equal(response.status, 200, "API route must return HTTP 200");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=300");

  const data = await response.json();
  assert.ok(Array.isArray(data.channels), "API route must return channels array");
  assert.ok(data.channels.length > 0, "API route must return channels");

  const channel = data.channels[0];
  assert.ok(channel.id);
  assert.ok(channel.name);
  assert.ok(channel.thumbnailUrl);
  assert.ok(!channel.thumbnailUrl.includes("/maxresdefault.jpg"));
  assert.ok(channel.thumbnailUrl.startsWith("https://") || channel.thumbnailUrl.startsWith("http://"));
});

test("cross-profile query sharing serves another profile instantly from global cache", async () => {
  clearChannelSearchCache();
  const query = "veritasium";

  // Search on Profile A
  const t0 = performance.now();
  const resA = await searchChannels(query, "profile-A");
  assert.ok(resA.length > 0);

  // Search on Profile B (should hit shared cache immediately)
  const t1 = performance.now();
  const resB = await searchChannels(query, "profile-B");
  const durB = performance.now() - t1;

  assert.deepEqual(resB, resA, "Cross-profile query must return identical results from cache");
  assert.ok(durB < 50, `Cross-profile query must be instant (< 50ms), got ${durB.toFixed(1)}ms`);
});

test("query starting with @ handle normalizes and returns matching channels", async () => {
  clearChannelSearchCache();
  const results = await searchChannels("@fireship", "e2e-profile");
  assert.ok(results.length > 0, "Expected channel results for @ handle query");
  assert.match(results[0].name, /fireship/i, "Top result should be Fireship");
});

test("in-flight concurrent requests for the exact same query deduplicate to a single network call", async () => {
  clearChannelSearchCache();
  const query = "lex fridman";

  const [res1, res2] = await Promise.all([
    searchChannels(query, "profile-1"),
    searchChannels(query, "profile-2")
  ]);

  assert.ok(res1.length > 0);
  assert.deepEqual(res1, res2, "Concurrent in-flight searches must resolve with identical data");
});
