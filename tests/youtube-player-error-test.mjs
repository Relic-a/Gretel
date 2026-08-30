import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "youtube-player-error-test");

rmSync(buildDir, { force: true, recursive: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const result = spawnSync(process.execPath, [
  path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
  "--outDir", buildDir,
  "--module", "commonjs",
  "--target", "ES2022",
  "--ignoreConfig",
  "--ignoreDeprecations", "6.0",
  "--skipLibCheck",
  "app/components/youtube-player-error.ts"
], { cwd: root, encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);

const require = createRequire(import.meta.url);
const { describeYouTubePlayerError, youtubeWatchUrl } = require(
  path.join(buildDir, "youtube-player-error.js")
);

test("maps every documented YouTube IFrame API error code", () => {
  assert.equal(describeYouTubePlayerError(2).kind, "invalid_parameter");
  assert.equal(describeYouTubePlayerError(5).kind, "html5_playback");
  assert.equal(describeYouTubePlayerError(100).kind, "video_unavailable");
  assert.equal(describeYouTubePlayerError(101).kind, "embedding_disabled");
  assert.equal(describeYouTubePlayerError(150).kind, "embedding_disabled");
  assert.equal(describeYouTubePlayerError(153).kind, "client_identity_missing");
  assert.equal(describeYouTubePlayerError(999).kind, "unknown");
});

test("keeps HTML5 playback failures broad and builds a safe YouTube URL", () => {
  const playbackError = describeYouTubePlayerError(5);
  assert.match(playbackError.message, /media support/);
  assert.match(playbackError.message, /network/);
  assert.doesNotMatch(playbackError.message, /missing codec/i);
  assert.equal(
    youtubeWatchUrl("nEy_im1bPK8&list=unsafe"),
    "https://www.youtube.com/watch?v=nEy_im1bPK8%26list%3Dunsafe"
  );
});

after(() => rmSync(buildDir, { force: true, recursive: true }));
