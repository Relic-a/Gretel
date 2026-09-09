import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const root = process.cwd();
const dependencyRoot = existsSync(path.join(root, "node_modules")) ? root : path.resolve(root, "../..");
const buildDir = path.join(root, ".tmp", "saved-collections-test");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "gretel-saved-collections-"));
const require = createRequire(import.meta.url);
const originalDataDir = process.env.GRETEL_DATA_DIR;
process.env.GRETEL_DATA_DIR = dataDir;
process.env.GRETEL_LOG_FILE = path.join(dataDir, "gretel-test.log");
process.env.NODE_PATH = path.join(dependencyRoot, "node_modules");
Module._initPaths();

let profileStore;
let savedCollections;
let savedCollectionsRoute;
let profile;
const video = {
  id: "video-1",
  title: "SQLite for thoughtful research",
  author: "Database Academy",
  duration: "10:00",
  query: "databases",
  thumbnailUrl: "https://example.test/thumb.jpg"
};

function compileModules() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const files = [
    "lib/logger.ts",
    "lib/data-dir.ts",
    "lib/api-auth.ts",
    "lib/cache-cleanup.ts",
    "lib/feed/config.ts",
    "lib/feed/config-defaults.ts",
    "lib/feed/types.ts",
    "lib/feed/engagement.ts",
    "lib/feed/channel-avatar-cache.ts",
    "lib/feed/youtube-client.ts",
    "lib/saved-collections.ts",
    "lib/profile-store.ts",
    "app/api/saved-collections/route.ts"
  ];
  const result = spawnSync(
    process.execPath,
    [
      path.join(dependencyRoot, "node_modules", "typescript", "lib", "tsc.js"),
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
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function seedLegacyDatabase() {
  const Database = require(path.join(dependencyRoot, "node_modules", "better-sqlite3"));
  const database = new Database(path.join(dataDir, "gretel.sqlite"));
  database.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      channels_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE saved_videos (
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_json TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, video_id)
    );
  `);
  database.prepare("INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("legacy-profile", "Legacy", 1, 1);
  database.prepare("INSERT INTO saved_videos (profile_id, video_id, video_json, saved_at) VALUES (?, ?, ?, ?)")
    .run("legacy-profile", video.id, JSON.stringify(video), 123);
  database.close();
}

before(() => {
  seedLegacyDatabase();
  compileModules();
  profileStore = require(path.join(buildDir, "lib", "profile-store.js"));
  savedCollections = require(path.join(buildDir, "lib", "saved-collections.js"));
  savedCollectionsRoute = require(path.join(buildDir, "app", "api", "saved-collections", "route.js"));
  profile = profileStore.getProfile("legacy-profile");
  assert.ok(profile);
});

after(() => {
  profileStore?.getDatabase()?.close();
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(dataDir, { force: true, recursive: true });
  if (originalDataDir === undefined) delete process.env.GRETEL_DATA_DIR;
  else process.env.GRETEL_DATA_DIR = originalDataDir;
});

test("migrates legacy saved videos into Watch Later without losing metadata", () => {
  const database = profileStore.getDatabase();
  const items = savedCollections.listSavedItems(database, profile.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].video.id, video.id);
  assert.deepEqual(items[0].folders.map((folder) => folder.name), ["Watch Later"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM saved_videos WHERE profile_id = ?").get(profile.id).count, 1);
  assert.deepEqual(
    savedCollections.listSavedFolders(database, profile.id).map((folder) => folder.name),
    ["Watch Later", "Research", "Reference"]
  );
});

test("supports folder/tag CRUD, notes, and searchable saved items", () => {
  const database = profileStore.getDatabase();
  const folder = savedCollections.createSavedFolder(database, profile.id, "Projects");
  const tag = savedCollections.createSavedTag(database, profile.id, "Deep Dive");
  const secondVideo = { ...video, id: "video-2", title: "A practical reference guide" };

  savedCollections.saveSavedItem(database, profile.id, secondVideo, {
    note: "Review the indexing section",
    folderIds: [folder.id],
    tagIds: [tag.id]
  });
  let item = savedCollections.getSavedItem(database, profile.id, secondVideo.id);
  assert.equal(item.note, "Review the indexing section");
  assert.deepEqual(item.folders.map((value) => value.name), ["Projects"]);
  assert.deepEqual(item.tags.map((value) => value.name), ["Deep Dive"]);

  savedCollections.updateSavedItem(database, profile.id, secondVideo.id, {
    note: "Remember this for the research brief",
    folderIds: [folder.id],
    tagIds: []
  });
  item = savedCollections.getSavedItem(database, profile.id, secondVideo.id);
  assert.equal(item.note, "Remember this for the research brief");
  assert.equal(item.tags.length, 0);
  assert.equal(savedCollections.searchSavedItems(database, profile.id, "research brief").length, 1);
  assert.equal(savedCollections.searchSavedItems(database, profile.id, "reference guide").length, 1);
  assert.equal(savedCollections.listSavedItems(database, profile.id, { folderId: folder.id }).length, 1);
  assert.equal(savedCollections.listSavedItems(database, profile.id, { tagId: tag.id }).length, 0);

  savedCollections.renameSavedFolder(database, profile.id, folder.id, "Reading List");
  savedCollections.renameSavedTag(database, profile.id, tag.id, "Old Tag");
  assert.equal(savedCollections.listSavedFolders(database, profile.id).some((value) => value.name === "Reading List"), true);
  assert.equal(savedCollections.deleteSavedTag(database, profile.id, tag.id), true);
  assert.equal(savedCollections.deleteSavedFolder(database, profile.id, folder.id), true);
});

test("saved collections route exposes typed items and CRUD actions", async () => {
  const post = await savedCollectionsRoute.POST(new Request("http://gretel.test", {
    method: "POST",
    body: JSON.stringify({ profileId: profile.id, action: "create-tag", name: "Route Tag" })
  }));
  assert.equal(post.status, 200);
  const created = await post.json();
  const tag = created.tags.find((value) => value.name === "Route Tag");
  assert.ok(tag);

  const save = await savedCollectionsRoute.POST(new Request("http://gretel.test", {
    method: "POST",
    body: JSON.stringify({
      profileId: profile.id,
      action: "save",
      video: { ...video, id: "route-video", title: "Route searchable note" },
      tagIds: [tag.id],
      note: "route note"
    })
  }));
  assert.equal(save.status, 200);

  const response = await savedCollectionsRoute.GET(new Request(`http://gretel.test?profileId=${profile.id}&q=route%20note`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].note, "route note");
  assert.equal(body.items[0].tags[0].name, "Route Tag");
});
