import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, ".tmp", "thumbnail-avatar-pipeline-test");
const workDir = path.join(os.tmpdir(), `gretel-thumbnail-test-${process.pid}`);
const require = createRequire(import.meta.url);
let originalCwd = process.cwd();

before(() => {
  compileModules();
  mkdirSync(workDir, { recursive: true });
  process.chdir(workDir);
  process.env.GRETEL_DATA_DIR = path.join(workDir, "data");
});

after(() => {
  process.chdir(originalCwd);
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(workDir, { force: true, recursive: true });
  delete process.env.GRETEL_DATA_DIR;
});

function compileModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  const files = [
    ...listTsFiles(path.join(repoRoot, "lib")),
    path.join(repoRoot, "app", "api", "thumbnails", "[...slug]", "route.ts")
  ].map((file) => path.relative(repoRoot, file));

  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "typescript", "lib", "tsc.js"),
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

function createFakeJpegBuffer(size = 2048) {
  const buf = Buffer.alloc(size);
  // JPEG magic bytes 0xFF 0xD8 0xFF
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

test("1. Thumbnail candidate quality selection: prefers smallest candidate meeting quality floor >= 700", () => {
  const {
    selectThumbnailCandidate,
    estimateThumbnailWidth,
    QUALITY_FLOOR_WIDTH
  } = require(path.join(buildDir, "lib", "feed", "video-utils.js"));

  assert.equal(QUALITY_FLOOR_WIDTH, 700);

  // 336, 720, 1280 -> choose 720 (smallest meeting floor >= 700)
  const candidates1 = [
    { url: "https://i.ytimg.com/vi/v1/hqdefault.jpg", width: 336, height: 188 },
    { url: "https://i.ytimg.com/vi/v1/hq720.jpg", width: 720, height: 404 },
    { url: "https://i.ytimg.com/vi/v1/hq720_hd.jpg", width: 1280, height: 720 }
  ];
  const res1 = selectThumbnailCandidate(candidates1);
  assert.equal(res1.meetsQualityFloor, true);
  assert.equal(res1.selectedUrl, "https://i.ytimg.com/vi/v1/hq720.jpg");

  // 720, 1280, 1920 -> choose 720 (no need to jump to 1920)
  const candidates2 = [
    { url: "https://i.ytimg.com/vi/v2/maxresdefault.jpg", width: 1920, height: 1080 },
    { url: "https://i.ytimg.com/vi/v2/hq720_large.jpg", width: 1280, height: 720 },
    { url: "https://i.ytimg.com/vi/v2/hq720_med.jpg", width: 720, height: 404 }
  ];
  const res2 = selectThumbnailCandidate(candidates2);
  assert.equal(res2.meetsQualityFloor, true);
  assert.equal(res2.selectedUrl, "https://i.ytimg.com/vi/v2/hq720_med.jpg");

  // 1280, 1920 -> choose 1280
  const candidates3 = [
    { url: "https://i.ytimg.com/vi/v3/maxresdefault.jpg", width: 1920, height: 1080 },
    { url: "https://i.ytimg.com/vi/v3/hq720.jpg", width: 1280, height: 720 }
  ];
  const res3 = selectThumbnailCandidate(candidates3);
  assert.equal(res3.meetsQualityFloor, true);
  assert.equal(res3.selectedUrl, "https://i.ytimg.com/vi/v3/hq720.jpg");

  // Ignores animated previews
  const animatedCandidates = [
    { url: "https://i.ytimg.com/an_webp/v4/mqdefault_6s.webp", width: 320, height: 180 },
    { url: "https://i.ytimg.com/vi/v4/hq720.jpg", width: 720, height: 404 }
  ];
  const resAnimated = selectThumbnailCandidate(animatedCandidates);
  assert.equal(resAnimated.selectedUrl, "https://i.ytimg.com/vi/v4/hq720.jpg");
  assert.equal(estimateThumbnailWidth({ url: "https://i.ytimg.com/an_webp/v4/mqdefault_6s.webp" }), 0);
});

test("2. Videos with only low-res candidates: marks as not meeting quality floor and preserves real static candidate", () => {
  const {
    selectThumbnailCandidate,
    getThumbnailUrl
  } = require(path.join(buildDir, "lib", "feed", "video-utils.js"));

  // 336, 480 -> treated as fallback-quality, best fallback is 480
  const lowResCandidates = [
    { url: "https://i.ytimg.com/vi/low1/mqdefault.jpg", width: 336, height: 188 },
    { url: "https://i.ytimg.com/vi/low1/hqdefault.jpg", width: 480, height: 360 }
  ];
  const selection = selectThumbnailCandidate(lowResCandidates);
  assert.equal(selection.meetsQualityFloor, false);
  assert.equal(selection.selectedUrl, "https://i.ytimg.com/vi/low1/hqdefault.jpg");
  assert.deepEqual(selection.fallbackCandidates, [
    "https://i.ytimg.com/vi/low1/hqdefault.jpg",
    "https://i.ytimg.com/vi/low1/mqdefault.jpg"
  ]);

  // getThumbnailUrl keeps real static candidate rather than fabricating fake maxresdefault
  const videoObj = {
    id: "low1",
    thumbnails: lowResCandidates
  };
  assert.equal(getThumbnailUrl(videoObj), "https://i.ytimg.com/vi/low1/hqdefault.jpg");
});

test("3. Successful high-quality fallback discovery via thumbnail cache", async () => {
  const {
    getOrFetchThumbnail,
    clearThumbnailMemoryCache
  } = require(path.join(buildDir, "lib", "feed", "thumbnails.js"));

  clearThumbnailMemoryCache();

  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  const fakeImage = createFakeJpegBuffer();

  globalThis.fetch = async (url) => {
    fetchedUrls.push(url);
    if (url.includes("maxresdefault.jpg")) {
      return new Response(fakeImage, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const videoId = "video-probe-success";
    const result = await getOrFetchThumbnail(videoId, "https://i.ytimg.com/vi/video-probe-success/hqdefault.jpg");

    assert.ok(result);
    assert.equal(result.fromCache, false);
    assert.equal(result.contentType, "image/jpeg");
    assert.ok(fetchedUrls.some((u) => u.includes("maxresdefault.jpg")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("4. Failed high-quality fallback discovery: gracefully falls back to lower-resolution real candidate", async () => {
  const {
    getOrFetchThumbnail,
    clearThumbnailMemoryCache
  } = require(path.join(buildDir, "lib", "feed", "thumbnails.js"));

  clearThumbnailMemoryCache();

  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  const fakeLowResImage = createFakeJpegBuffer(1500);

  globalThis.fetch = async (url) => {
    fetchedUrls.push(url);
    if (url.includes("maxresdefault.jpg") || url.includes("hq720.jpg") || url.includes("sddefault.jpg")) {
      return new Response("404 Not Found", { status: 404 });
    }
    if (url.includes("hqdefault.jpg")) {
      return new Response(fakeLowResImage, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    }
    return new Response("Not found", { status: 404 });
  };

  try {
    const videoId = "video-probe-fallback";
    const result = await getOrFetchThumbnail(
      videoId,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    );

    assert.ok(result);
    assert.equal(result.fromCache, false);
    assert.equal(result.contentType, "image/jpeg");
    assert.ok(fetchedUrls.some((u) => u.includes("hqdefault.jpg")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("5. Thumbnail cache hit/miss and atomic file storage", async () => {
  const {
    getOrFetchThumbnail,
    getCachedThumbnail,
    getCachedThumbnailPath,
    clearThumbnailMemoryCache
  } = require(path.join(buildDir, "lib", "feed", "thumbnails.js"));

  clearThumbnailMemoryCache();

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const fakeImage = createFakeJpegBuffer();

  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(fakeImage, {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });
  };

  try {
    const videoId = "video-cache-hit-test";

    // First request: Cache Miss
    const missResult = await getOrFetchThumbnail(videoId, `https://i.ytimg.com/vi/${videoId}/hq720.jpg`);
    assert.ok(missResult);
    assert.equal(missResult.fromCache, false);
    assert.equal(fetchCount, 1);

    // Verify file exists on disk
    const diskPath = getCachedThumbnailPath(videoId);
    assert.ok(existsSync(diskPath));

    // Verify getCachedThumbnail reads it directly
    const cachedDirect = await getCachedThumbnail(videoId);
    assert.ok(cachedDirect);
    assert.equal(cachedDirect.contentType, "image/jpeg");

    // Second request: Cache Hit (no network calls)
    const hitResult = await getOrFetchThumbnail(videoId, `https://i.ytimg.com/vi/${videoId}/hq720.jpg`);
    assert.ok(hitResult);
    assert.equal(hitResult.fromCache, true);
    assert.equal(fetchCount, 1); // Fetch count did not increase!
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("6. Concurrent cache requests for the same uncached video are deduplicated", async () => {
  const {
    getOrFetchThumbnail,
    clearThumbnailMemoryCache
  } = require(path.join(buildDir, "lib", "feed", "thumbnails.js"));

  clearThumbnailMemoryCache();

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const fakeImage = createFakeJpegBuffer();

  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(fakeImage, {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });
  };

  try {
    const videoId = "video-concurrent-test";

    // Trigger 5 concurrent requests for the uncached video
    const [r1, r2, r3, r4, r5] = await Promise.all([
      getOrFetchThumbnail(videoId),
      getOrFetchThumbnail(videoId),
      getOrFetchThumbnail(videoId),
      getOrFetchThumbnail(videoId),
      getOrFetchThumbnail(videoId)
    ]);

    assert.ok(r1 && r2 && r3 && r4 && r5);
    assert.equal(fetchCount, 1, "Only 1 network fetch should have been made for concurrent requests");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("7. Global video-ID cache behavior across different profiles", async () => {
  const {
    getCachedThumbnailPath,
    writeCachedThumbnail,
    getCachedThumbnail
  } = require(path.join(buildDir, "lib", "feed", "thumbnails.js"));

  const videoId = "cross-profile-video-1";
  const fakeImage = createFakeJpegBuffer();

  // Write once for videoId
  await writeCachedThumbnail(videoId, fakeImage);

  // Both profileA and profileB paths resolve to the same global path
  const pathForProfileA = getCachedThumbnailPath("profile-a", videoId);
  const pathForProfileB = getCachedThumbnailPath("profile-b", videoId);
  const pathDirect = getCachedThumbnailPath(videoId);

  assert.equal(pathForProfileA, pathDirect);
  assert.equal(pathForProfileB, pathDirect);

  const cached = await getCachedThumbnail(videoId);
  assert.ok(cached);
  assert.equal(cached.buffer.length, fakeImage.length);
});

test("8. Avatar channel-ID identity: authoritative ID keying and lookup", () => {
  const {
    rememberChannelAvatar,
    getChannelAvatar,
    clearChannelAvatarCache
  } = require(path.join(buildDir, "lib", "feed", "channel-avatar-cache.js"));

  clearChannelAvatarCache();

  const channelId = "UC1234567890abcdef";
  const avatarUrl = "https://yt3.ggpht.com/author-avatar=s176-c-k";

  rememberChannelAvatar({ channelId, channelName: "Creator Alpha" }, avatarUrl);

  // Lookup by ID
  assert.equal(getChannelAvatar(channelId), avatarUrl);
  // Lookup by name alias
  assert.equal(getChannelAvatar(undefined, "Creator Alpha"), avatarUrl);
});

test("9. Duplicate channel display names do not overwrite or collide", () => {
  const {
    rememberChannelAvatar,
    getChannelAvatar,
    clearChannelAvatarCache
  } = require(path.join(buildDir, "lib", "feed", "channel-avatar-cache.js"));

  clearChannelAvatarCache();

  const channel1 = { channelId: "UC-AAA-1111111111111111", channelName: "Tech Channel" };
  const avatar1 = "https://yt3.ggpht.com/avatar-AAA=s176";

  const channel2 = { channelId: "UC-BBB-2222222222222222", channelName: "Tech Channel" };
  const avatar2 = "https://yt3.ggpht.com/avatar-BBB=s176";

  rememberChannelAvatar(channel1, avatar1);
  rememberChannelAvatar(channel2, avatar2);

  // Authoritative ID lookups remain distinct and correct
  assert.equal(getChannelAvatar(channel1.channelId), avatar1);
  assert.equal(getChannelAvatar(channel2.channelId), avatar2);
});

test("10. Persisted stale avatar URLs do not overwrite fresh authoritative cache entries", () => {
  const {
    rememberChannelAvatar,
    hydrateChannelAvatar,
    getChannelAvatar,
    clearChannelAvatarCache
  } = require(path.join(buildDir, "lib", "feed", "channel-avatar-cache.js"));

  clearChannelAvatarCache();

  const channelId = "UC-CREATOR-FRESH-12345";
  const freshAvatarUrl = "https://yt3.ggpht.com/fresh-avatar=s176";
  const stalePersistedAvatarUrl = "https://yt3.ggpht.com/old-stale-avatar=s176";

  // Fresh avatar is in cache
  rememberChannelAvatar(channelId, freshAvatarUrl);

  // Video loaded from persisted storage has old avatar URL
  const persistedVideo = {
    id: "v-persisted-1",
    title: "Video 1",
    author: "Creator Fresh",
    channelId,
    channelAvatarUrl: stalePersistedAvatarUrl
  };

  const hydrated = hydrateChannelAvatar(persistedVideo);

  // Hydration must upgrade to fresh avatar and not overwrite cache with stale URL
  assert.equal(hydrated.channelAvatarUrl, freshAvatarUrl);
  assert.equal(getChannelAvatar(channelId), freshAvatarUrl);
});

test("11. Avatar request deduplication and negative caching", async () => {
  const {
    resolveMissingChannelAvatars,
    clearChannelAvatarCache
  } = require(path.join(buildDir, "lib", "feed", "channel-avatar-cache.js"));

  clearChannelAvatarCache();

  let fetchCalls = 0;
  const fetcher = async (channelId) => {
    fetchCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (channelId === "UC-EXISTS-1") {
      return "https://yt3.ggpht.com/avatar-exists=s176";
    }
    return undefined; // 404 missing
  };

  const videos = [
    { id: "v1", title: "V1", author: "A1", channelId: "UC-EXISTS-1" },
    { id: "v2", title: "V2", author: "A1", channelId: "UC-EXISTS-1" },
    { id: "v3", title: "V3", author: "A2", channelId: "UC-MISSING-1" },
    { id: "v4", title: "V4", author: "A2", channelId: "UC-MISSING-1" }
  ];

  const resolved = await resolveMissingChannelAvatars(videos, fetcher);

  assert.equal(resolved[0].channelAvatarUrl, "https://yt3.ggpht.com/avatar-exists=s176");
  assert.equal(resolved[1].channelAvatarUrl, "https://yt3.ggpht.com/avatar-exists=s176");
  assert.equal(fetchCalls, 2, "Should fetch each unique channel ID only once");

  // Subsequent call hits negative cache for missing channel without re-fetching
  await resolveMissingChannelAvatars([{ id: "v5", title: "V5", author: "A2", channelId: "UC-MISSING-1" }], fetcher);
  assert.equal(fetchCalls, 2, "Negative cache should prevent redundant fetch for missing channel");
});
