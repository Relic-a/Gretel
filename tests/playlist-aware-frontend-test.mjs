import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, test } from "node:test";

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, ".tmp", "playlist-aware-frontend-test");
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

after(() => {
  rmSync(buildDir, { force: true, recursive: true });
});

test("playlist cards keep real playlist art instead of a video thumbnail proxy", () => {
  compileClientModules();
  const { thumbnailFor, isPlaylistCard } = require(path.join(buildDir, "components", "video-utils.js"));

  assert.equal(isPlaylistCard({ itemType: "playlist" }), true);
  assert.equal(isPlaylistCard({ itemType: "video" }), false);
  assert.equal(isPlaylistCard({}), false);

  assert.equal(
    thumbnailFor({
      itemType: "playlist",
      id: "PLcourse",
      title: "Course",
      author: "Teacher",
      duration: "",
      thumbnailUrl: "https://example.test/playlist.jpg"
    }),
    "https://example.test/playlist.jpg",
    "playlist art must come from thumbnailUrl"
  );

  // The cache URL still wins when the server provided one, even for a playlist.
  assert.equal(
    thumbnailFor({
      itemType: "playlist",
      id: "PLcourse",
      title: "Course",
      author: "Teacher",
      duration: "",
      thumbnailCacheUrl: "/api/thumbnails/profile/PLcourse",
      thumbnailUrl: "https://example.test/playlist.jpg"
    }),
    "/api/thumbnails/profile/PLcourse"
  );

  // A normal video keeps the local thumbnail proxy.
  assert.equal(
    thumbnailFor({ id: "dQw4w9WgXcQ", title: "Video", author: "Channel", duration: "3:32" }),
    "/api/thumbnails/dQw4w9WgXcQ"
  );
});

test("the playlist card advertises itself and never fakes a duration", () => {
  const card = read("app/components/VideoCard.tsx");
  assert.match(card, /isPlaylistCard/);
  assert.match(card, /playlist-card/);
  assert.match(card, /playlist-badge/);
  assert.match(card, /playlist-count-pill/);
  assert.match(card, /playlistVideoCount/);
  assert.match(card, /data-playlist-card/);
  // Playlists have no duration; only real videos render the duration pill.
  assert.match(card, /isPlaylist \? \([\s\S]*playlist-badge[\s\S]*\) : props\.video\.duration/);

  const css = read("app/styles.css");
  for (const token of [".playlist-card", ".playlist-badge", ".playlist-count-pill", ".playlist-panel", ".playlist-item"]) {
    assert.match(css, new RegExp(token.replace(".", "\\.")));
  }
});

test("opening a playlist card loads /api/playlist with the profile, playlist, and pool key", () => {
  const page = read("app/page.tsx");
  assert.match(page, /openPlaylistDetails/);
  assert.match(page, /\/api\/playlist\?\$\{params\.toString\(\)\}/);
  assert.match(page, /playlistId: playlist\.playlistId \|\| playlist\.id/);
  assert.match(page, /playlistPoolKey: playlist\.playlistPoolKey \|\| ""/);
  assert.match(page, /profileId,?\s*$/m);
  assert.match(page, /api\/playlist/);
  // Playlist cards route to the panel instead of the watch page.
  assert.match(page, /if \(isPlaylistCard\(video\)\) \{\s*void openPlaylistDetails\(video\);\s*return;/);
  assert.match(page, /<PlaylistPanel/);
});

test("the dedicated side panel shows ordered videos and its states", () => {
  const panel = read("app/components/PlaylistPanel.tsx");
  assert.match(panel, /className="playlist-panel"/);
  assert.match(panel, /details\?\.videos/);
  assert.match(panel, /videos\.map/);
  assert.match(panel, /playlistLoading|props\.loading/);
  assert.match(panel, /props\.error/);
  assert.match(panel, /Play all/);
  assert.match(panel, /onSelectVideo/);
  assert.match(panel, /Save/);
  assert.match(panel, /Queue all/);
});

test("autoplay follows autoplayVideoIds and advances the watch player in order", () => {
  const page = read("app/page.tsx");
  const panel = read("app/components/PlaylistPanel.tsx");
  assert.match(page, /autoplayVideoIds/);
  assert.match(page, /playlistNextVideoId/);
  assert.match(panel, /nextVideoId/);
  // The watch view is handed the playlist-aware ended handler.
  assert.match(page, /onVideoEnded=\{handleVideoEnded\}/);
  assert.match(page, /index \+ 1 < autoplayIds\.length|autoplayIds\[index \+ 1\]/);
  assert.match(page, /the playlist's own order/i);
});

test("saving a playlist card is a normal save and queue uses the existing enqueue action", () => {
  const page = read("app/page.tsx");
  assert.match(page, /onToggleSave=\{\(\) => void saveVideo\(openPlaylist\)\}/);
  assert.match(page, /handleEnqueueVideo/);
  assert.match(page, /queue\.enqueue\(video\)/);
  // Playlist queueing must not send the generic queue toast or open the drawer
  // over the playlist panel; it gets its own notice instead.
  assert.match(page, /if \(isPlaylist\) return;/);
  assert.match(page, /setPlaylistNotice\(true\)/);
});

test("queue state marks a playlist card queued when its members are queued", () => {
  const feed = read("app/components/FeedView.tsx");
  const watch = read("app/components/WatchView.tsx");
  assert.match(feed, /queuedPlaylistIds/);
  assert.match(feed, /queuedPlaylistIds\?\.has\(video\.playlistId \|\| video\.id\)/);
  assert.match(watch, /queuedPlaylistIds/);
  assert.match(watch, /isPlaylistCard/);
});

test("the enqueue API expands a playlist card through the shared playlist store", () => {
  const route = read("app/api/queue/route.ts");
  assert.match(route, /itemType === "playlist"/);
  assert.match(route, /isPlaylistAdmitted\(profileId, poolKey, playlistId\)/);
  assert.match(route, /getPlaylistDetails\(profileId, poolKey, playlistId\)/);
  assert.match(route, /enqueueQueueVideos\(profileId, details\.videos\)/);

  const api = read("app/api/playlist/route.ts");
  assert.match(api, /profileId/);
  assert.match(api, /playlistId/);
  // The card sends playlistPoolKey; the route accepts it (and the poolKey alias).
  assert.match(api, /playlistPoolKey/);
  assert.match(api, /searchParams\.get\("poolKey"\)/);
  assert.match(api, /isPlaylistAdmitted/);
  assert.match(api, /getPlaylistDetails/);
});

/** The client utils are plain TypeScript, so compile and exercise them for real. */
function compileClientModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

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
      path.join("app", "types.ts"),
      path.join("app", "components", "video-utils.ts")
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
}
