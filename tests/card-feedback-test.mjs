import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "card-feedback-test");
const workDir = path.join(os.tmpdir(), `gretel-card-feedback-${process.pid}`);
const dataDir = path.join(workDir, "data");
const require = createRequire(import.meta.url);
let profileStore;
let feedbackRoute;

before(() => {
  process.env.GRETEL_DATA_DIR = dataDir;
  compileModules();
  profileStore = require(path.join(buildDir, "lib", "profile-store.js"));
  feedbackRoute = require(path.join(buildDir, "app", "api", "feedback", "route.js"));
});

after(() => {
  try {
    profileStore?.getDatabase?.().close?.();
  } catch {}
  delete process.env.GRETEL_DATA_DIR;
  delete process.env.GRETEL_API_TOKEN;
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(workDir, { force: true, recursive: true });
});

test("feedback is durable, profile-scoped, and filters both video and channel targets", () => {
  const { applyContentFeedback, createProfile, deleteProfile, getContentFeedback } = profileStore;
  const { filterFeedbackVideos, toContentFeedbackSnapshot } = require(
    path.join(buildDir, "lib", "feed", "feedback.js")
  );
  const { createCandidatePoolFeed } = require(path.join(buildDir, "lib", "feed", "pool.js"));
  const { DEFAULT_GRETEL_CONFIG } = require(path.join(buildDir, "lib", "feed", "config-defaults.js"));
  const profile = createProfile("Feedback profile");

  try {
    assert.equal(applyContentFeedback(profile.id, { action: "notInterested", videoId: "video-1" }), true);
    assert.equal(applyContentFeedback(profile.id, { action: "hideVideo", videoId: "video-2" }), true);
    assert.equal(
      applyContentFeedback(profile.id, {
        action: "muteChannel",
        channelId: "UC-MUTED",
        channelKey: "Muted Creator"
      }),
      true
    );

    const state = getContentFeedback(profile.id);
    assert.deepEqual(toContentFeedbackSnapshot(state), {
      notInterestedVideoIds: ["video-1"],
      hiddenVideoIds: ["video-2"],
      mutedChannelIds: ["uc-muted"],
      mutedChannelKeys: ["muted creator"]
    });

    const videos = [
      { id: "video-1", author: "Allowed", channelKey: "allowed", title: "", duration: "", query: "" },
      { id: "video-2", author: "Allowed", channelKey: "allowed", title: "", duration: "", query: "" },
      { id: "video-3", author: "Muted Creator", channelId: "UC-MUTED", title: "", duration: "", query: "" },
      { id: "video-4", author: "Muted Creator", channelKey: "Muted Creator", title: "", duration: "", query: "" },
      { id: "video-5", author: "Allowed", channelKey: "allowed", title: "", duration: "", query: "" }
    ];
    assert.deepEqual(filterFeedbackVideos(videos, state).map((video) => video.id), ["video-5"]);
    assert.deepEqual(
      createCandidatePoolFeed({
        rootVideos: videos,
        channelVideos: [],
        relatedVideos: [],
        watchedVideoIds: new Set(),
        interactions: new Map(),
        feedback: state,
        config: DEFAULT_GRETEL_CONFIG
      }).videos.map((video) => video.id),
      ["video-5"]
    );

    assert.deepEqual(getContentFeedback(profile.id), getContentFeedback(profile.id));
  } finally {
    deleteProfile(profile.id);
  }
});

test("authenticated feedback route accepts shared card/watch commands and returns current state", async () => {
  const { createProfile, deleteProfile } = profileStore;
  const profile = createProfile("Route profile");
  process.env.GRETEL_API_TOKEN = "test-token";

  try {
    const unauthorized = await feedbackRoute.POST(new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ profileId: profile.id, action: "hideVideo", videoId: "video-1" })
    }));
    assert.equal(unauthorized.status, 401);

    const response = await feedbackRoute.POST(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gretel-token": "test-token" },
      body: JSON.stringify({ profileId: profile.id, action: "not-interested", videoId: "video-1" })
    }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).feedback.notInterestedVideoIds, ["video-1"]);

    const muteResponse = await feedbackRoute.POST(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gretel-token": "test-token" },
      body: JSON.stringify({ profileId: profile.id, action: "muteChannel", channelName: "Muted Creator" })
    }));
    assert.equal(muteResponse.status, 200);
    assert.deepEqual((await muteResponse.json()).feedback.mutedChannelKeys, ["muted creator"]);

    const current = await feedbackRoute.GET(new Request(
      `http://localhost/api/feedback?profileId=${encodeURIComponent(profile.id)}`,
      { headers: { "x-gretel-token": "test-token" } }
    ));
    assert.equal(current.status, 200);
    assert.deepEqual((await current.json()).feedback.notInterestedVideoIds, ["video-1"]);
  } finally {
    deleteProfile(profile.id);
  }
});

function compileModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const files = [...listTsFiles(path.join(root, "lib")), path.join(root, "app", "api", "feedback", "route.ts")]
    .map((file) => path.relative(root, file));
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
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
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function listTsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    return statSync(fullPath).isDirectory()
      ? listTsFiles(fullPath)
      : fullPath.endsWith(".ts")
        ? [fullPath]
        : [];
  });
}
