import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "queue-autoplay-test");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "gretel-queue-"));
const dependencyRoot = existsSync(path.join(root, "node_modules"))
  ? path.join(root, "node_modules")
  : "/home/relic/Work/Gretel/node_modules";
process.env.GRETEL_DATA_DIR = dataDir;
process.env.GRETEL_LOG_FILE = path.join(dataDir, "gretel.log");

rmSync(buildDir, { force: true, recursive: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const compile = spawnSync(
  process.execPath,
  [
    path.join(dependencyRoot, "typescript", "lib", "tsc.js"),
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
    "lib/playback-queue.ts",
    "lib/queue-store.ts",
    "lib/profile-store.ts",
    "lib/data-dir.ts",
    "lib/cache-cleanup.ts",
    "lib/logger.ts",
    "lib/settings.ts",
    "lib/env.ts",
    "lib/feed/types.ts",
    "lib/feed/config.ts",
    "lib/feed/config-defaults.ts",
    "lib/feed/channel-avatar-cache.ts",
    "lib/feed/youtube-client.ts",
    "lib/api-auth.ts",
    "app/api/queue/route.ts"
  ],
  { cwd: root, encoding: "utf8", env: { ...process.env, NODE_PATH: dependencyRoot } }
);
assert.equal(compile.status, 0, compile.stderr || compile.stdout);

const require = createRequire(import.meta.url);
const pure = require(path.join(buildDir, "lib", "playback-queue.js"));
const store = require(path.join(buildDir, "lib", "queue-store.js"));
const profiles = require(path.join(buildDir, "lib", "profile-store.js"));
const queueRoute = require(path.join(buildDir, "app", "api", "queue", "route.js"));

const video = (id) => ({
  id,
  title: `Video ${id}`,
  author: "Channel",
  duration: "1:00",
  query: "Queue"
});

const first = video("first");
const second = video("second");
const third = video("third");

// Pure state transitions are deterministic and do not wrap at the tail.
let state = pure.createPlaybackQueue([first, second, third], { currentVideoId: "first" });
assert.deepEqual(pure.getUpNextVideos(state).map((item) => item.id), ["second", "third"]);
assert.equal(pure.handlePlaybackEnded(state).kind, "advanced");
state = pure.handlePlaybackEnded(state).state;
assert.equal(state.currentVideoId, "second");
state = pure.setAutoplayEnabled(state, false);
assert.equal(pure.handlePlaybackEnded(state).kind, "stopped");
state = pure.setAutoplayEnabled(state, true);
state = pure.handlePlaybackEnded(state).state;
assert.equal(state.currentVideoId, "third");
assert.equal(pure.handlePlaybackEnded(state).kind, "ended");
assert.deepEqual(pure.removeFromQueue(state, "third").items.map((item) => item.id), ["first", "second"]);

// The profile store persists ordering, cursor, and autoplay independently per profile.
const profile = profiles.createProfile("Queue test");
assert.equal(store.getPlaybackQueue(profile.id).autoplayEnabled, true);
store.enqueueQueueVideos(profile.id, [first, second, third]);
store.setQueueCurrentVideo(profile.id, "first");
store.reorderQueueVideo(profile.id, "third", 1);
let snapshot = store.getPlaybackQueue(profile.id);
assert.deepEqual(snapshot.items.map((item) => item.id), ["first", "third", "second"]);
assert.deepEqual(snapshot.upNextVideos.map((item) => item.id), ["third", "second"]);

store.setQueueAutoplay(profile.id, false);
assert.equal(store.handlePlaybackQueueEnded(profile.id).kind, "stopped");
store.setQueueAutoplay(profile.id, true);
assert.equal(store.handlePlaybackQueueEnded(profile.id).kind, "advanced");
snapshot = store.getPlaybackQueue(profile.id);
assert.equal(snapshot.currentVideoId, "third");

store.removeQueueVideo(profile.id, "third");
snapshot = store.getPlaybackQueue(profile.id);
assert.equal(snapshot.currentVideoId, "second");
store.clearPlaybackQueue(profile.id);
snapshot = store.getPlaybackQueue(profile.id);
assert.deepEqual(snapshot.items, []);
assert.equal(snapshot.currentVideo, null);
assert.equal(snapshot.autoplayEnabled, true);

profiles.deleteProfile(profile.id);

const apiProfile = profiles.createProfile("Queue API test");
const enqueueResponse = await queueRoute.POST(new Request("http://gretel.test/api/queue", {
  method: "POST",
  body: JSON.stringify({ profileId: apiProfile.id, action: "enqueue", video: video("api-video") })
}));
assert.equal(enqueueResponse.status, 200);
const queueResponse = await queueRoute.GET(new Request(
  `http://gretel.test/api/queue?profileId=${encodeURIComponent(apiProfile.id)}`
));
assert.equal(queueResponse.status, 200);
assert.deepEqual((await queueResponse.json()).items.map((item) => item.id), ["api-video"]);
profiles.deleteProfile(apiProfile.id);
rmSync(dataDir, { force: true, recursive: true });
console.log("queue and autoplay tests passed");
