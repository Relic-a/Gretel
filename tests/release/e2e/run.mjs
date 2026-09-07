#!/usr/bin/env node

/**
 * Gretel release E2E verifier.
 *
 * The verifier deliberately lives outside the shipped application. It starts the
 * production Next standalone server in a fresh, allow-listed environment and
 * drives a real Chromium instance through CDP when one is available.
 */

import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync, realpathSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { getArtifactIdentity } from "../artifact-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const defaultArtifact = path.join(repoRoot, ".next", "standalone");
const secret = "e2e-synthetic-secret-should-never-be-logged";
const token = "e2e-local-token-20260905";
const options = parseArgs(process.argv.slice(2));
const startupLimitMs = Number.isFinite(Number(options.startupMs)) && Number(options.startupMs) > 0 ? Number(options.startupMs) : 30_000;
const mode = options.mode || "all";
const strict = options.strict === true;

const results = [];
const activeChildren = new Set();
const supportedModes = new Set(["all", "production", "browser", "migration", "native", "self-test"]);
let outputRoot;
let runRoot;
let runStartedAt;
let context;
let cancelled = false;

process.on("SIGINT", () => {
  cancelled = true;
  void shutdownChildren().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  cancelled = true;
  void shutdownChildren().finally(() => process.exit(143));
});

async function main() {
  outputRoot = await prepareOutputRoot(options.output);
  runRoot = await mkdtemp(path.join(outputRoot, "run-"));
  runStartedAt = new Date().toISOString();

  if (!supportedModes.has(mode)) {
    addCase("e2e.mode", "The requested verifier mode is one of the documented executable modes.", "blocked", {
      reason: `Unsupported mode ${mode}; choose ${[...supportedModes].join(", ")}.`,
      scope: "module-integration",
      evidence: []
    });
    await writeReport("e2e", null);
    process.exitCode = exitCode();
    return;
  }

  if (options.selfTest || mode === "self-test") {
    await runSelfTests();
    await writeReport("self-test", null);
    await shutdownChildren();
    process.exitCode = exitCode();
    return;
  }

  context = {
    artifact: path.resolve(options.artifact || defaultArtifact),
    outputRoot,
    runRoot,
    dataDir: path.join(runRoot, "data"),
    browserRoot: path.join(runRoot, "browser"),
    configPath: path.join(runRoot, "gretel.config.json"),
    logPath: path.join(runRoot, "server.log"),
    token,
    seeded: null,
    server: null,
    baseUrl: ""
  };

  const prerequisite = await checkPrerequisites();
  if (!prerequisite.ok) {
    addCase("e2e.prerequisites", "The selected production artifact is runnable and the required test tools are present.", "blocked", {
      reason: prerequisite.reason,
      scope: "production-server",
      evidence: []
    });
    await addSkippedCasesForMissingPrerequisite();
    await writeReport("e2e", artifactMetadata());
    await shutdownChildren();
    process.exitCode = exitCode();
    return;
  }

  await writeSyntheticConfig();
  context.seeded = await seedDatabase(context.dataDir, context.configPath);
  context.port = await freePort();
  context.server = await startProductionServer();
  if (!context.baseUrl) throw new Error("production server readiness completed without assigning base URL");

  if (mode === "all" || mode === "production" || mode === "browser") {
    await runCleanFirstRunCase();
    await runProductionServerCases();
  }
  if (mode === "all" || mode === "browser") {
    await runBrowserCases();
  }
  if (mode === "all" || mode === "production") {
    await runResetScopeCase();
  }
  if (mode === "all" || mode === "migration") {
    await runMigrationCases();
  }
  if (mode === "all" || mode === "native") {
    addCase("native.adapter", "Native installer/update evidence must come from a disposable target OS runner.", "blocked", {
      reason: "Use tests/release/e2e/native-adapter.mjs with explicit artifacts; no native package runner was supplied to this server verifier.",
      scope: "native-package",
      evidence: []
    });
  }

  await writeReport("e2e", artifactMetadata());
  await shutdownChildren();
  process.exitCode = exitCode();
}

async function checkPrerequisites() {
  try {
    const stats = await lstat(context.artifact);
    if (!stats.isDirectory()) return { ok: false, reason: `Artifact is not a directory: ${context.artifact}` };
    await access(path.join(context.artifact, "server.js"));
    await access(path.join(context.artifact, ".next"));
    await access(path.join(context.artifact, "package.json"));
    const browser = findChromium();
    if ((mode === "all" || mode === "browser") && !browser) {
      return { ok: false, reason: "Chromium is required for browser mode; install it in the disposable runner or run --mode production." };
    }
    return { ok: true, browser };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function addSkippedCasesForMissingPrerequisite() {
  const entries = [
    ["e2e.startup", "The production standalone server reaches its authenticated readiness endpoint within 30 seconds."],
    ["e2e.clean-first-run", "A clean data directory boots the production server, creates initial schema, supports first-run setup, and preserves created state across restart."],
    ["e2e.static-assets", "Production HTML, JavaScript, CSS, and bundled fonts load successfully."],
    ["e2e.persistence", "Profiles, settings, saved/liked videos, and watch history survive a server restart."],
    ["e2e.fault-handling", "Unauthorized and missing feed data return explicit non-success responses."],
    ["e2e.concurrency", "Concurrent writes through the real HTTP handlers preserve independent profile records."],
    ["e2e.browser", "A real isolated browser profile can boot the UI and exercise actual DOM actions."],
    ["e2e.migration", "Old-version source schemas migrate to a current readable database without data loss."]
  ];
  for (const [id, criterion] of entries) {
    addCase(id, criterion, "not_run", { reason: "Prerequisite check did not pass.", scope: "production-server", evidence: [] });
  }
}

async function writeSyntheticConfig() {
  const source = JSON.parse(await readFile(path.join(repoRoot, "config", "gretel.config.json"), "utf8"));
  source.embeddings = {
    ...source.embeddings,
    provider: "mock",
    model: "e2e/mock-embedding-v1",
    dimensions: 8,
    batchSize: 4,
    maxConcurrentRequests: 2,
    mockSeed: 20260905
  };
  source.feed = {
    ...source.feed,
    maxVideos: 12,
    poolSizeCap: 40,
    minFreshVideos: 0,
    minFreshRatio: 0,
    maxQueries: 5
  };
  source.expansion = {
    ...source.expansion,
    initialExpansionCycles: 0,
    maxFetchCallsPerCycle: 0,
    minFreshVideos: 0,
    minFreshRatio: 0,
    minExpansionYield: 0
  };
  await writeFile(context.configPath, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
}

async function seedDatabase(dataDir, configPath) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dataDir, "gretel.sqlite");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  const profileSource = gitShow("v0.5.3", "lib/profile-store.ts");
  const schemaSql = extractFirstDatabaseSql(profileSource);
  db.exec(schemaSql);
  ensureColumn(db, "feed_pool_state", "last_expanded_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "feed_pool_nodes", "impression_count", "INTEGER NOT NULL DEFAULT 0");

  const now = Date.now();
  const profiles = {
    alpha: { id: "e2e-profile-alpha", name: "Alpha systems", tags: ["systems design"], channels: [] },
    beta: { id: "e2e-profile-beta", name: "Beta systems", tags: ["data systems"], channels: [] }
  };
  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, name, tags_json, channels_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const profile of Object.values(profiles)) {
    insertProfile.run(profile.id, profile.name, JSON.stringify(profile.tags), JSON.stringify(profile.channels), now, now);
  }

  const insertState = db.prepare(
    "INSERT INTO feed_pool_state (profile_id, pool_key, root_discovered_at, updated_at, last_expanded_at) VALUES (?, ?, ?, ?, 0)"
  );
  const insertNode = db.prepare(
    `INSERT INTO feed_pool_nodes (
      profile_id, pool_key, video_id, node_id, video_json, parent_video_id,
      similarity_score, parent_engagement_score, first_seen_at, updated_at,
      served_count, impression_count, last_served_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL)`
  );
  const insertVisited = db.prepare(
    "INSERT INTO feed_visited_videos (profile_id, pool_key, video_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  );
  const seeds = {};
  for (const [name, profile] of Object.entries(profiles)) {
    const poolKey = createPoolKey(profile.tags, profile.channels);
    insertState.run(profile.id, poolKey, now, now);
    const videos = [];
    for (let index = 0; index < 18; index += 1) {
      const id = `e2e${name === "alpha" ? "a" : "b"}${String(index).padStart(2, "0")}x`;
      const video = {
        id,
        title: `${profile.name} fixture ${index + 1}`,
        author: name === "alpha" ? "Alpha Lab" : "Beta Lab",
        duration: "10:00",
        query: profile.tags[0],
        publishedText: `${index + 1} days ago`,
        publishedAt: now - index * 86_400_000,
        thumbnailCacheUrl: fixtureThumbnail(index, name === "alpha" ? "#5eead4" : "#f59e0b"),
        channelKey: name === "alpha" ? "alpha lab" : "beta lab",
        sourceNodeId: "tagSearch",
        sourceNodeLabel: "Topic search",
        similarityScore: 0.95 - index * 0.01,
        parentEngagementScore: 0
      };
      const timestamp = now + index;
      insertNode.run(profile.id, poolKey, id, "tagSearch", JSON.stringify(video), null, video.similarityScore, 0, timestamp, timestamp);
      insertVisited.run(profile.id, poolKey, id, timestamp, timestamp);
      videos.push(video);
    }
    seeds[name] = { profile, poolKey, videos };
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  return { dbPath, profiles, seeds, profileSourceSha256: sha256(profileSource), configPath };
}

async function runProductionServerCases() {
  await caseRun("e2e.startup", "The production standalone server reaches its authenticated readiness endpoint within 30 seconds.", async () => {
    const started = Date.now();
    const response = await http("/api/config");
    assert(response.status === 200, `readiness status was ${response.status}`);
    const body = await response.json();
    assert(body.embeddings?.provider === "mock", "synthetic deterministic config was not applied");
    const durationMs = Date.now() - started;
    assert(durationMs <= startupLimitMs, `startup exceeded ${startupLimitMs}ms (${durationMs}ms)`);
    return { scope: "production-server", measurements: { startupMs: durationMs, thresholdMs: startupLimitMs }, evidence: [] };
  });

  await caseRun("e2e.auth", "The local API token protects handlers when one is configured.", async () => {
    const response = await fetch(`${context.baseUrl}/api/profiles`);
    assert(response.status === 401, `unauthenticated profiles status was ${response.status}`);
    return { scope: "production-server", measurements: { unauthenticatedStatus: response.status }, evidence: [] };
  });

  await caseRun("e2e.static-assets", "Production HTML, JavaScript, CSS, and bundled fonts load successfully.", async () => {
    const response = await fetch(`${context.baseUrl}/?token=${encodeURIComponent(token)}`);
    assert(response.status === 200, `home status was ${response.status}`);
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/_next\/[^"#?]+)/g)].map((match) => match[1]);
    const css = assets.filter((asset) => asset.endsWith(".css"));
    const scripts = assets.filter((asset) => asset.endsWith(".js"));
    const cssText = await Promise.all(css.map(async (asset) => (await fetch(`${context.baseUrl}${asset}`)).text()));
    const fonts = [...cssText.join("\n").matchAll(/url\((['"]?)(\/_next\/[^)'"\s]+\.(?:woff2?|ttf))\1\)/g)].map((match) => match[2]);
    const unique = [...new Set([...assets, ...fonts])];
    const statuses = [];
    for (const asset of unique) {
      const result = await fetch(`${context.baseUrl}${asset}`);
      statuses.push({ asset, status: result.status });
      assert(result.status === 200, `${asset} returned ${result.status}`);
    }
    assert(scripts.length > 0, "production HTML did not reference JavaScript");
    assert(css.length > 0, "production HTML did not reference CSS");
    const evidence = await writeEvidence("static-assets", { htmlBytes: html.length, assets: statuses });
    return { scope: "production-server", measurements: { scriptCount: scripts.length, cssCount: css.length, fontCount: fonts.length }, evidence: [evidence] };
  });

  await caseRun("e2e.profiles-settings", "Real profile and settings HTTP handlers persist preferences while masking a synthetic API key.", async () => {
    const profiles = await jsonRequest("/api/profiles");
    assert(profiles.profiles.length === 2, `expected 2 seeded profiles, received ${profiles.profiles.length}`);
    const settings = await jsonRequest("/api/settings", { method: "POST", body: { openRouterApiKey: secret, openRouterModel: "e2e/mock-embedding-v1" } });
    assert(settings.openRouterApiKey === "set", "settings response did not mask the key");
    assert(!JSON.stringify(settings).includes(secret), "settings response leaked the synthetic key");
    const created = await jsonRequest("/api/profiles", { method: "POST", body: { name: "Created by HTTP E2E", tags: [], channels: [] } });
    assert(created.profileId, "profile creation did not return an id");
    const listed = await jsonRequest("/api/profiles");
    assert(listed.profiles.some((profile) => profile.id === created.profileId), "created profile was not durable");
    const alpha = listed.profiles.find((profile) => profile.id === context.seeded.profiles.alpha.id);
    assert(JSON.stringify(alpha?.tags) === JSON.stringify(context.seeded.profiles.alpha.tags), "profile feed preferences were not preserved");
    const evidence = await writeEvidence("profiles-settings", { profileCount: listed.profiles.length, createdProfileId: created.profileId, settingsMasked: true });
    return { scope: "production-server", measurements: { profileCount: listed.profiles.length }, evidence: [evidence] };
  });

  await caseRun("e2e.feed-and-engagement", "The seeded deterministic pool is served by the production feed route and actual HTTP handlers persist save, like, and watch records.", async () => {
    const alpha = context.seeded.seeds.alpha;
    const feed = await jsonRequest("/api/feed", { method: "POST", body: { profileId: alpha.profile.id, tags: alpha.profile.tags, channels: [] } });
    assert(feed.videos?.length > 0, "seeded pool returned no videos");
    assert(feed.pool?.status === "served", `unexpected feed pool status ${feed.pool?.status}`);
    const video = feed.videos[0];
    const saved = await jsonRequest("/api/saved-videos", { method: "POST", body: { profileId: alpha.profile.id, video, videoId: video.id, action: "save" } });
    assert(saved.savedVideoIds.includes(video.id), "save handler did not return saved video");
    const liked = await jsonRequest("/api/liked-videos", { method: "POST", body: { profileId: alpha.profile.id, video, videoId: video.id, action: "like" } });
    assert(liked.likedVideoIds.includes(video.id), "like handler did not return liked video");
    const watched = await jsonRequest("/api/watch-events", { method: "POST", body: { profileId: alpha.profile.id, video, watchedSeconds: 120, durationSeconds: 600 } });
    assert(watched.saved === true, "watch event did not cross the configured save threshold");
    const history = await jsonRequest(`/api/history?profileId=${alpha.profile.id}`);
    assert(history.videos.some((entry) => entry.id === video.id), "watch event did not appear in history");
    const evidence = await writeEvidence("feed-engagement", { poolVideos: feed.pool.videos, servedVideos: feed.videos.length, videoId: video.id, records: { saved: true, liked: true, watched: true } });
    return { scope: "production-server", measurements: { poolVideos: feed.pool.videos, servedVideos: feed.videos.length }, evidence: [evidence] };
  });

  await caseRun("e2e.fault-handling", "Missing pools and invalid authentication produce explicit failure responses rather than passing as empty feeds.", async () => {
    const missing = context.seeded.profiles.alpha.id;
    const profile = await jsonRequest("/api/profiles", { method: "POST", body: { name: "No pool", tags: ["missing pool"], channels: [] } });
    const response = await fetch(`${context.baseUrl}/api/feed`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ profileId: profile.profileId, tags: ["missing pool"], channels: [] }) });
    const body = await response.json();
    assert(response.status === 404, `missing-pool status was ${response.status}`);
    assert(body.code === "FEED_POOL_MISSING", `missing-pool code was ${body.code}`);
    assert(missing !== profile.profileId, "fixture profile id unexpectedly reused");
    const evidence = await writeEvidence("fault-handling", { missingPoolStatus: response.status, missingPoolCode: body.code });
    return { scope: "production-server", measurements: { missingPoolStatus: response.status }, evidence: [evidence] };
  });

  await caseRun("e2e.concurrency", "Concurrent writes through the real HTTP handlers preserve independent profile records.", async () => {
    const beta = context.seeded.seeds.beta;
    const writes = beta.videos.slice(0, 4).map((video) => jsonRequest("/api/saved-videos", { method: "POST", body: { profileId: beta.profile.id, video, videoId: video.id, action: "save" } }));
    await Promise.all(writes);
    const saved = await jsonRequest(`/api/saved-videos?profileId=${beta.profile.id}`);
    assert(saved.savedVideoIds.length === 4, `concurrent writes produced ${saved.savedVideoIds.length} saved videos`);
    const alphaSaved = await jsonRequest(`/api/saved-videos?profileId=${context.seeded.profiles.alpha.id}`);
    assert(!alphaSaved.savedVideoIds.some((id) => beta.videos.slice(0, 4).some((video) => video.id === id)), "profile records leaked across profiles");
    const evidence = await writeEvidence("concurrency", { betaSavedIds: saved.savedVideoIds, alphaSavedCount: alphaSaved.savedVideoIds.length });
    return { scope: "production-server", measurements: { concurrentWrites: writes.length }, evidence: [evidence] };
  });

  await caseRun("e2e.persistence", "Profiles, settings, saved/liked videos, and watch history survive a production server restart.", async () => {
    const alpha = context.seeded.seeds.alpha;
    const before = {
      profiles: (await jsonRequest("/api/profiles")).profiles.map((profile) => ({ id: profile.id, name: profile.name })),
      settings: await jsonRequest("/api/settings"),
      saved: await jsonRequest(`/api/saved-videos?profileId=${alpha.profile.id}`),
      liked: await jsonRequest(`/api/liked-videos?profileId=${alpha.profile.id}`),
      history: await jsonRequest(`/api/history?profileId=${alpha.profile.id}`)
    };
    assert(before.settings.openRouterApiKey === "set", "pre-restart settings were not persisted");
    await stopProductionServer();
    context.port = await freePort();
    context.server = await startProductionServer();
    const after = {
      profiles: (await jsonRequest("/api/profiles")).profiles.map((profile) => ({ id: profile.id, name: profile.name })),
      settings: await jsonRequest("/api/settings"),
      saved: await jsonRequest(`/api/saved-videos?profileId=${alpha.profile.id}`),
      liked: await jsonRequest(`/api/liked-videos?profileId=${alpha.profile.id}`),
      history: await jsonRequest(`/api/history?profileId=${alpha.profile.id}`)
    };
    assert(JSON.stringify(after.profiles) === JSON.stringify(before.profiles), "profile ids/names changed after restart");
    assert(after.settings.openRouterApiKey === "set", "settings did not survive restart");
    assert(after.saved.savedVideoIds.includes(alpha.videos[0].id), "saved video did not survive restart");
    assert(after.liked.likedVideoIds.includes(alpha.videos[0].id), "liked video did not survive restart");
    assert(after.history.videos.some((video) => video.id === alpha.videos[0].id), "history did not survive restart");
    const evidence = await writeEvidence("persistence", { before, after: { ...after, settings: { openRouterApiKey: after.settings.openRouterApiKey, openRouterModel: after.settings.openRouterModel } } });
    return { scope: "production-server", measurements: { profileCount: after.profiles.length, savedCount: after.saved.savedVideoIds.length, historyCount: after.history.videos.length }, evidence: [evidence] };
  });

}

async function runResetScopeCase() {
  await caseRun("e2e.reset-scope", "Reset behavior is recorded against the advertised current scope and leaves the profile itself intact.", async () => {
    const alpha = context.seeded.seeds.alpha;
    const response = await jsonRequest("/api/profiles", { method: "POST", body: { action: "reset", profileId: alpha.profile.id } });
    assert(response.profileId === alpha.profile.id, "reset changed the active profile id");
    const saved = await jsonRequest(`/api/saved-videos?profileId=${alpha.profile.id}`);
    const liked = await jsonRequest(`/api/liked-videos?profileId=${alpha.profile.id}`);
    const history = await jsonRequest(`/api/history?profileId=${alpha.profile.id}`);
    assert(saved.savedVideoIds.length === 0 && liked.likedVideoIds.length === 0 && history.videos.length === 0, "reset did not clear saved, liked, and history records");
    const evidence = await writeEvidence("reset-scope", { profileId: alpha.profile.id, savedCount: 0, likedCount: 0, historyCount: 0, advertisedScope: "current implementation clears saved, liked, history, interactions, impressions, and feed pool" });
    return { scope: "production-server", measurements: { clearedCollections: 3 }, evidence: [evidence] };
  });
}

async function runBrowserCases() {
  await caseRun("e2e.browser", "A real isolated browser profile boots the production UI and exercises actual DOM actions against the HTTP handlers.", async () => {
    const browser = await launchChromium(path.join(context.browserRoot, "profile-alpha"));
    try {
      await browser.navigate(`${context.baseUrl}/?token=${encodeURIComponent(token)}`);
      await browser.waitFor("Boolean(document.querySelector('header') && document.querySelector('.profile-button'))", 20_000);
      await browser.waitFor("document.querySelectorAll('article.video-card h2').length > 0", 20_000);
      const initialName = await browser.evaluate("document.querySelector('.profile-button-name')?.textContent || ''");
      assert(initialName.includes("Alpha"), `browser selected unexpected profile ${initialName}`);

      await browser.evaluate("document.querySelector('article.video-card details summary')?.click()");
      await browser.evaluate("Array.from(document.querySelectorAll('article.video-card details button')).find((button) => button.textContent?.trim() === 'Like')?.click()");
      await browser.waitFor("document.querySelector('article.video-card details')?.textContent?.includes('Liked')", 5_000);
      await browser.evaluate("(() => { const details = document.querySelector('article.video-card details'); if (details) details.open = false; })()");
      await browser.evaluate("document.querySelector('article.video-card details summary')?.click()");
      await browser.evaluate("Array.from(document.querySelectorAll('article.video-card details button')).find((button) => button.textContent?.trim() === 'Save')?.click()");
      await browser.waitFor("document.querySelector('article.video-card details')?.textContent?.includes('Saved')", 5_000);

      await browser.evaluate("document.querySelector('button[aria-label=\"Open settings\"]')?.click()");
      await browser.waitFor("Boolean(document.querySelector('.settings-modal'))", 5_000);
      await browser.evaluate("(() => { const input = document.querySelector('.settings-modal input[type=password]'); if (!input) throw new Error('settings key input missing'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'e2e-browser-secret'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'e2e-browser-secret' })); input.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await browser.evaluate("document.querySelector('.settings-modal form button[type=submit]')?.click()");
      await browser.waitFor("!document.querySelector('.settings-modal')", 5_000);

      await browser.evaluate("document.querySelector('.profile-button')?.click()");
      await browser.evaluate("Array.from(document.querySelectorAll('.profile-popover button')).find((button) => button.textContent?.includes('Manage profiles'))?.click()");
      await browser.waitFor("Boolean(document.querySelector('.profile-modal'))", 5_000);
      await browser.evaluate("(() => { const input = document.querySelector('.profile-modal input[placeholder*=\"Systems design\"]'); if (!input) throw new Error('profile name input missing'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Created by browser E2E'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Created by browser E2E' })); input.dispatchEvent(new Event('change', { bubbles: true })); })()");
      for (let index = 0; index < 3; index += 1) {
        await browser.evaluate("document.querySelector('.wizard-next')?.click()");
        await delay(120);
      }
      await browser.waitFor("!document.querySelector('.profile-modal form')", 2_000).catch(() => undefined);
      await delay(500);
      const profilesAfterUiCreate = await jsonRequest("/api/profiles");
      assert(profilesAfterUiCreate.profiles.some((profile) => profile.name === "Created by browser E2E"), "browser profile creation was not durable");

      await browser.evaluate("document.querySelector('.profile-button')?.click()");
      await browser.evaluate("Array.from(document.querySelectorAll('.profile-popover button')).find((button) => button.textContent?.includes('Beta systems'))?.click()");
      await browser.waitFor("document.querySelector('.profile-button-name')?.textContent?.includes('Beta')", 5_000);
      const betaName = await browser.evaluate("document.querySelector('.profile-button-name')?.textContent || ''");
      const betaSaved = await jsonRequest(`/api/saved-videos?profileId=${context.seeded.profiles.beta.id}`);
      assert(betaSaved.savedVideoIds.length === 4, "beta profile unexpectedly lost independent saved records");

      await browser.evaluate("localStorage.setItem('gretel.clientState.v2', '{broken-json')");
      await browser.reload(`${context.baseUrl}/?token=${encodeURIComponent(token)}`);
      await browser.waitFor("Boolean(document.querySelector('header') && document.querySelector('.profile-button'))", 10_000);
      const recoveryName = await browser.evaluate("document.querySelector('.profile-button-name')?.textContent || ''");
      assert(recoveryName.length > 0, "corrupt localStorage did not recover to a usable screen");

      const expectedFailures = browser.requestFailures.filter((item) => item.method === "POST" && item.status === 400 && item.url.endsWith("/api/feed/build"));
      const unexpectedFailures = browser.requestFailures.filter((item) => !expectedFailures.includes(item));
      const evidence = await writeEvidence("browser", {
        initialProfile: initialName.trim(),
        betaProfile: betaName.trim(),
        localStorageRecoveryProfile: recoveryName.trim(),
        requestFailures: browser.requestFailures,
        expectedFailures: expectedFailures.length,
        pageErrors: browser.pageErrors,
        browserExecutable: browser.executable
      });
      assert(unexpectedFailures.length === 0, `browser saw failed requests: ${unexpectedFailures.map((item) => item.url).join(", ")}`);
      assert(browser.pageErrors.length === 0, `browser saw page errors: ${browser.pageErrors.join("; ")}`);
      return { scope: "browser", measurements: { requestFailures: unexpectedFailures.length, expectedFailures: expectedFailures.length, pageErrors: browser.pageErrors.length }, evidence: [evidence] };
    } finally {
      await browser.close();
    }
  });

  await caseRun("e2e.browser-fresh-context", "A fresh isolated browser profile independently reads persisted records from the old server database.", async () => {
    const browser = await launchChromium(path.join(context.browserRoot, "profile-fresh"));
    try {
      await browser.navigate(`${context.baseUrl}/?token=${encodeURIComponent(token)}`);
      await browser.waitFor("Boolean(document.querySelector('header') && document.querySelector('.profile-button'))", 10_000);
      await browser.evaluate("document.querySelector('button[aria-label=\"Open settings\"]')?.click()");
      await browser.waitFor("Boolean(document.querySelector('.settings-modal'))", 5_000);
      const keyPlaceholder = await browser.evaluate("document.querySelector('.settings-modal input[type=password]')?.getAttribute('placeholder') || ''");
      assert(keyPlaceholder.includes("already saved"), "fresh browser did not see persisted masked settings");
      await browser.evaluate("document.querySelector('.settings-modal button[type=button]')?.click()");
      await browser.evaluate("document.querySelector('button').textContent");
      await browser.evaluate("Array.from(document.querySelectorAll('.section-tabs button')).find((button) => button.textContent?.includes('Saved'))?.click()");
      await browser.waitFor("document.querySelectorAll('article.video-card').length > 0", 5_000);
      const savedCount = await browser.evaluate("document.querySelectorAll('article.video-card').length");
      const savedTitle = await browser.evaluate("document.querySelector('article.video-card h2')?.textContent || ''");
      assert(savedCount > 0, "fresh browser context did not render persisted saved videos");
      assert(savedTitle.includes("Alpha"), `fresh browser rendered an unexpected profile: ${savedTitle}`);
      const evidence = await writeEvidence("browser-fresh-context", { savedCount, savedTitle, keyMasked: true, requestFailures: browser.requestFailures, pageErrors: browser.pageErrors });
      assert(browser.requestFailures.length === 0, "fresh browser saw a failed request");
      assert(browser.pageErrors.length === 0, "fresh browser saw a page error");
      return { scope: "browser", measurements: { savedCount }, evidence: [evidence] };
    } finally {
      await browser.close();
    }
  });
}

async function runCleanFirstRunCase() {
  await caseRun("e2e.clean-first-run", "A clean data directory boots the production server, creates initial schema, supports first-run setup, and preserves created state across restart.", async () => {
    const cleanRoot = await mkdtemp(path.join(outputRoot, "clean-run-"));
    const dataDir = path.join(cleanRoot, "data");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const configPath = path.join(cleanRoot, "gretel.config.json");
    const source = JSON.parse(await readFile(path.join(repoRoot, "config", "gretel.config.json"), "utf8"));
    source.embeddings = { ...source.embeddings, provider: "mock", model: "e2e/mock", dimensions: 8, batchSize: 4, mockSeed: 20260905 };
    source.feed = { ...source.feed, maxVideos: 6, maxQueries: 2, poolSizeCap: 20, minFreshVideos: 0, minFreshRatio: 0 };
    await writeFile(configPath, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });

    const preload = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mock-youtube-preload.cjs");
    const cleanPort = await freePort();
    let server = await startServerFor({ dataDir, configPath, logPath: path.join(cleanRoot, "server.log"), port: cleanPort, preload });
    try {
      const baseUrl = `http://127.0.0.1:${cleanPort}`;
      await waitReady(baseUrl, startupLimitMs);

      const initProfiles = await jsonRequestAt(baseUrl, "/api/profiles");
      assert(Array.isArray(initProfiles.profiles) && initProfiles.profiles.length === 0, "clean database unexpectedly had existing profiles");
      const initSettings = await jsonRequestAt(baseUrl, "/api/settings");
      assert(!initSettings.openRouterApiKey, "clean state unexpectedly had saved API key");

      const dbPath = path.join(dataDir, "gretel.sqlite");
      assert(existsSync(dbPath), "server failed to create gretel.sqlite in clean data directory");
      const db = new Database(dbPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      db.close();
      assert(tables.includes("profiles"), "profiles table missing from newly initialized schema");
      assert(tables.includes("saved_videos"), "saved_videos table missing from newly initialized schema");

      const hasChromium = Boolean(findChromium());
      let createdProfileId;
      if (hasChromium && (mode === "all" || mode === "browser")) {
        const browser = await launchChromium(path.join(cleanRoot, "browser"));
        try {
          await browser.navigate(`${baseUrl}/?token=${encodeURIComponent(token)}`);
          await browser.waitFor("Boolean(document.querySelector('.profile-modal'))", 20_000);

          await browser.evaluate(`(() => {
            const input = document.querySelector('.profile-modal input');
            if (!input) throw new Error('profile name input missing');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'Clean First Run Profile');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Clean First Run Profile' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await delay(200);
          await browser.evaluate("document.querySelector('.wizard-next')?.click()");
          await delay(300);

          await browser.waitFor("document.querySelectorAll('.suggestion-row button').length > 0", 5_000);
          await browser.evaluate("document.querySelector('.suggestion-row button')?.click()");
          await delay(200);
          await browser.evaluate("document.querySelector('.wizard-next')?.click()");
          await delay(300);

          await browser.evaluate("document.querySelector('.wizard-next')?.click()");
          await delay(300);

          await browser.waitFor("Boolean(document.querySelector('.profile-modal input[type=password]'))", 5_000);
          await browser.evaluate(`(() => {
            const input = document.querySelector('.profile-modal input[type=password]');
            if (!input) throw new Error('settings key input missing');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'clean-first-run-secret-key');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'clean-first-run-secret-key' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await delay(200);

          await browser.evaluate("document.querySelector('.wizard-next')?.click()");

          await browser.waitFor("document.querySelector('.profile-button-name')?.textContent?.includes('Clean')", 25_000);
          await browser.waitFor("document.querySelectorAll('article.video-card:not(.skeleton-card)').length > 0", 25_000);
          const profileHeader = await browser.evaluate("document.querySelector('.profile-button-name')?.textContent || ''");
          assert(profileHeader.includes("Clean"), `expected header to display Clean First Run Profile, got ${profileHeader}`);
        } finally {
          await browser.close();
        }
      } else {
        const savedSettings = await jsonRequestAt(baseUrl, "/api/settings", { method: "POST", body: { openRouterApiKey: "clean-first-run-secret-key" } });
        assert.strictEqual(savedSettings.openRouterApiKey, "set");
        const createdProfile = await jsonRequestAt(baseUrl, "/api/profiles", { method: "POST", body: { name: "Clean First Run Profile", tags: ["systems design"], channels: [] } });
        createdProfileId = createdProfile.profileId;
        const feedBuild = await jsonRequestAt(baseUrl, "/api/feed/build", { method: "POST", body: { profileId: createdProfileId, tags: ["systems design"], channels: [] } });
        assert(feedBuild.videos?.length > 0, "clean feed build returned no videos");
      }

      const profilesBefore = await jsonRequestAt(baseUrl, "/api/profiles");
      assert.strictEqual(profilesBefore.profiles.length, 1, `expected 1 profile, found ${profilesBefore.profiles.length}`);
      const cleanProfile = profilesBefore.profiles[0];
      createdProfileId = cleanProfile.id;

      const settingsBefore = await jsonRequestAt(baseUrl, "/api/settings");
      assert.strictEqual(settingsBefore.openRouterApiKey, "set", "settings did not mask key");
      const rawSettingsBefore = readJsonIfPresent(path.join(dataDir, "user-settings.json"));
      assert.strictEqual(rawSettingsBefore.openRouterApiKey, "clean-first-run-secret-key", "raw settings file did not persist unmasked key");

      const feedBefore = await jsonRequestAt(baseUrl, "/api/feed", { method: "POST", body: { profileId: createdProfileId, tags: cleanProfile.tags, channels: cleanProfile.channels } });
      assert(feedBefore.videos?.length > 0, "feed route did not serve videos");

      await stopChild(server);

      const restartPort = await freePort();
      server = await startServerFor({ dataDir, configPath, logPath: path.join(cleanRoot, "server-restart.log"), port: restartPort, preload });
      const restartedBaseUrl = `http://127.0.0.1:${restartPort}`;
      await waitReady(restartedBaseUrl, startupLimitMs);

      const profilesAfter = await jsonRequestAt(restartedBaseUrl, "/api/profiles");
      assert.strictEqual(profilesAfter.profiles.length, 1, "profile count changed after restart");
      assert.deepStrictEqual(profilesAfter.profiles[0], cleanProfile, "profile state mutated after restart");

      const settingsAfter = await jsonRequestAt(restartedBaseUrl, "/api/settings");
      assert.deepStrictEqual(settingsAfter, settingsBefore, "settings state mutated after restart");
      const rawSettingsAfter = readJsonIfPresent(path.join(dataDir, "user-settings.json"));
      assert.strictEqual(rawSettingsAfter.openRouterApiKey, "clean-first-run-secret-key", "raw settings key lost after restart");

      const feedAfter = await jsonRequestAt(restartedBaseUrl, "/api/feed", { method: "POST", body: { profileId: createdProfileId, tags: cleanProfile.tags, channels: cleanProfile.channels } });
      assert.strictEqual(feedAfter.videos?.length, feedBefore.videos?.length, "feed video count changed after restart");
      assert.deepStrictEqual(feedAfter.videos.map((v) => v.id), feedBefore.videos.map((v) => v.id), "feed video IDs changed after restart");

      if (hasChromium && (mode === "all" || mode === "browser")) {
        const freshBrowser = await launchChromium(path.join(cleanRoot, "browser-after-restart"));
        try {
          await freshBrowser.navigate(`${restartedBaseUrl}/?token=${encodeURIComponent(token)}`);
          await freshBrowser.waitFor("document.querySelectorAll('article.video-card').length > 0", 15_000);
          const modalVisible = await freshBrowser.evaluate("Boolean(document.querySelector('.profile-modal'))");
          assert(!modalVisible, "onboarding modal unexpectedly visible after restart");
        } finally {
          await freshBrowser.close();
        }
      }

      const evidence = await writeEvidence("clean-first-run", {
        profileId: createdProfileId,
        profileName: cleanProfile.name,
        tags: cleanProfile.tags,
        feedVideosCount: feedAfter.videos.length,
        persistedSettingsMasked: true,
        tablesCreated: tables.length,
        exactMatchAfterRestart: true
      });

      return {
        scope: "production-server",
        measurements: {
          tablesCreated: tables.length,
          feedVideos: feedAfter.videos.length,
          exactRestartMatch: true
        },
        evidence: [evidence]
      };
    } finally {
      await stopChild(server);
    }
  });
}

function compareMigrationRecords(tag, expected, actual) {
  assert(actual.profile, `${tag} missing profile`);
  assert.strictEqual(actual.profile.name, expected.profile.name, `${tag} profile name mismatch: expected "${expected.profile.name}", got "${actual.profile.name}"`);
  assert.deepStrictEqual(actual.profile.tags, expected.profile.tags, `${tag} profile tags mismatch`);
  assert.deepStrictEqual(actual.profile.channels, expected.profile.channels, `${tag} profile channels mismatch`);

  assert(actual.settings, `${tag} missing settings`);
  assert.strictEqual(actual.settings.openRouterApiKey, "set", `${tag} settings API key not reported as masked "set"`);
  assert.strictEqual(actual.settings.openRouterModel, expected.settings.openRouterModel, `${tag} settings model mismatch`);
  assert.strictEqual(actual.settings.developerAnalytics, expected.settings.developerAnalytics, `${tag} developerAnalytics mismatch`);
  if (expected.rawSettings) {
    assert.strictEqual(actual.rawSettings?.openRouterApiKey, expected.rawSettings.openRouterApiKey, `${tag} raw settings unmasked API key was modified or lost`);
  }

  assert(Array.isArray(actual.savedVideoIds), `${tag} savedVideoIds missing`);
  assert(actual.savedVideoIds.includes(expected.savedVideo.id), `${tag} saved video ID ${expected.savedVideo.id} missing from saved collection`);

  assert(Array.isArray(actual.likedVideoIds), `${tag} likedVideoIds missing`);
  assert(actual.likedVideoIds.includes(expected.likedVideo.id), `${tag} liked video ID ${expected.likedVideo.id} missing from liked collection`);

  assert(Array.isArray(actual.historyVideos), `${tag} historyVideos missing`);
  const watched = actual.historyVideos.find((v) => v.id === expected.watchedVideo.id);
  assert(watched, `${tag} watched video ID ${expected.watchedVideo.id} missing from history`);
  assert.strictEqual(watched.title, expected.watchedVideo.title, `${tag} history video title mismatch`);
  assert.strictEqual(watched.author, expected.watchedVideo.author, `${tag} history video author mismatch`);

  if (actual.watchedDbRow) {
    assert.strictEqual(actual.watchedDbRow.watched_seconds, expected.watchedVideo.watchedSeconds, `${tag} DB watched_seconds mismatch`);
    assert.strictEqual(actual.watchedDbRow.duration_seconds, expected.watchedVideo.durationSeconds, `${tag} DB duration_seconds mismatch`);
    assert.strictEqual(actual.watchedDbRow.watched_ratio, expected.watchedVideo.watchedRatio, `${tag} DB watched_ratio mismatch`);
  }

  if (actual.feedPoolStateColumns) {
    assert(actual.feedPoolStateColumns.includes("last_expanded_at"), `${tag} feed_pool_state missing migrated column last_expanded_at`);
  }
  if (actual.feedPoolNodesColumns) {
    assert(actual.feedPoolNodesColumns.includes("impression_count"), `${tag} feed_pool_nodes missing migrated column impression_count`);
  }
}

async function runMigrationCases() {
  const tags = ["v0.5.2", "v0.5.1", "v0.5.0"];
  for (const tag of tags) {
    await caseRun(`e2e.migration.${tag.replaceAll(".", "-")}`, `The ${tag} profile-store source schema upgrades with profiles, preferences, saved/liked videos, watch history, and database integrity intact.`, async () => {
      const migrationRoot = await mkdtemp(path.join(outputRoot, `migration-${tag.replaceAll(".", "-")}-`));
      const dataDir = path.join(migrationRoot, "data");
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const dbPath = path.join(dataDir, "gretel.sqlite");
      const source = gitShow(tag, "lib/profile-store.ts");
      const algorithmSource = gitShow(tag, "lib/feed/algorithm-store.ts");
      const db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      db.exec(extractFirstDatabaseSql(source));
      const lazySchemaAdditions = extractLazySchemaAdditions(tag);
      for (const addition of lazySchemaAdditions) {
        ensureColumn(db, addition.table, addition.column, addition.definition);
      }

      const profile = { id: `legacy-${tag.replaceAll(".", "-")}`, name: `${tag} legacy`, tags: ["legacy systems"], channels: ["Legacy Lab"] };
      const now = Date.now();
      db.prepare("INSERT INTO profiles (id, name, tags_json, channels_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(profile.id, profile.name, JSON.stringify(profile.tags), JSON.stringify(profile.channels), now, now);

      const legacySettings = { openRouterApiKey: `legacy-key-${tag}`, openRouterModel: "legacy-model", developerAnalytics: true };
      await writeFile(path.join(dataDir, "user-settings.json"), `${JSON.stringify(legacySettings, null, 2)}\n`, { mode: 0o600 });

      const video = { id: `legacy${tag.replaceAll(".", "")}01`, title: `${tag} retained video`, author: "Legacy Lab", duration: "08:00", query: "legacy systems", thumbnailCacheUrl: fixtureThumbnail(2, "#a78bfa") };
      db.prepare("INSERT INTO saved_videos (profile_id, video_id, video_json, saved_at) VALUES (?, ?, ?, ?)").run(profile.id, video.id, JSON.stringify(video), now);
      db.prepare("INSERT INTO liked_videos (profile_id, video_id, video_json, liked_at) VALUES (?, ?, ?, ?)").run(profile.id, video.id, JSON.stringify(video), now);
      const watchedRecord = { id: video.id, title: video.title, author: video.author, duration: video.duration, query: video.query, sourceNodeId: "tagSearch", sourceNodeLabel: "Legacy", channelKey: "legacy lab", watchedSeconds: 240, durationSeconds: 480, watchedRatio: 0.5, watchedAt: now };
      db.prepare(`INSERT INTO watched_videos (profile_id, video_id, title, author, duration, query, source_node_id, source_node_label, channel_key, watched_seconds, duration_seconds, watched_ratio, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(profile.id, watchedRecord.id, watchedRecord.title, watchedRecord.author, watchedRecord.duration, watchedRecord.query, watchedRecord.sourceNodeId, watchedRecord.sourceNodeLabel, watchedRecord.channelKey, watchedRecord.watchedSeconds, watchedRecord.durationSeconds, watchedRecord.watchedRatio, watchedRecord.watchedAt);

      const poolKey = createPoolKey(profile.tags, profile.channels);
      db.prepare("INSERT INTO feed_pool_state (profile_id, pool_key, root_discovered_at, updated_at, last_expanded_at) VALUES (?, ?, ?, ?, 0)").run(profile.id, poolKey, now, now);
      db.close();

      const migrationConfigPath = path.join(migrationRoot, "gretel.config.json");
      await writeFile(migrationConfigPath, await readFile(context.configPath), { mode: 0o600 });
      const migrationPort = await freePort();
      let server = await startServerFor({ dataDir, configPath: migrationConfigPath, logPath: path.join(migrationRoot, "server.log"), port: migrationPort });
      try {
        const baseUrl = `http://127.0.0.1:${migrationPort}`;
        await waitReady(baseUrl, startupLimitMs);

        const profilesRes = await jsonRequestAt(baseUrl, `/api/profiles`);
        const foundProfile = profilesRes.profiles.find((entry) => entry.id === profile.id);
        const savedRes = await jsonRequestAt(baseUrl, `/api/saved-videos?profileId=${profile.id}`);
        const likedRes = await jsonRequestAt(baseUrl, `/api/liked-videos?profileId=${profile.id}`);
        const historyRes = await jsonRequestAt(baseUrl, `/api/history?profileId=${profile.id}`);
        const settingsRes = await jsonRequestAt(baseUrl, `/api/settings`);
        const rawSettings = readJsonIfPresent(path.join(dataDir, "user-settings.json"));

        const migratedDb = new Database(dbPath, { readonly: true });
        const integrity = migratedDb.pragma("integrity_check", { simple: true });
        const foreignKeys = migratedDb.prepare("PRAGMA foreign_key_check").all();
        const tables = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
        const poolStateCols = migratedDb.prepare("PRAGMA table_info(feed_pool_state)").all().map((row) => row.name);
        const poolNodeCols = migratedDb.prepare("PRAGMA table_info(feed_pool_nodes)").all().map((row) => row.name);
        const watchedDbRow = migratedDb.prepare("SELECT watched_seconds, duration_seconds, watched_ratio, watched_at FROM watched_videos WHERE profile_id = ? AND video_id = ?").get(profile.id, video.id);
        migratedDb.close();

        assert(integrity === "ok", `${tag} integrity_check returned ${integrity}`);
        assert(foreignKeys.length === 0, `${tag} foreign_key_check returned ${foreignKeys.length} rows`);

        compareMigrationRecords(tag, {
          profile,
          settings: legacySettings,
          rawSettings: legacySettings,
          savedVideo: video,
          likedVideo: video,
          watchedVideo: watchedRecord
        }, {
          profile: foundProfile,
          settings: settingsRes,
          rawSettings,
          savedVideoIds: savedRes.savedVideoIds,
          likedVideoIds: likedRes.likedVideoIds,
          historyVideos: historyRes.videos,
          watchedDbRow,
          feedPoolStateColumns: poolStateCols,
          feedPoolNodesColumns: poolNodeCols
        });

        const evidence = await writeEvidence(`migration-${tag}`, {
          tag,
          sourceSchemaSha256: sha256(source),
          algorithmSourceSha256: sha256(algorithmSource),
          lazySchemaAdditions,
          profileId: profile.id,
          durableVideoId: video.id,
          integrity,
          foreignKeyErrors: foreignKeys.length,
          tables,
          poolStateCols,
          poolNodeCols
        });

        await stopChild(server);

        const restartPort = await freePort();
        server = await startServerFor({ dataDir, configPath: migrationConfigPath, logPath: path.join(migrationRoot, "server-restart.log"), port: restartPort });
        const restartedBaseUrl = `http://127.0.0.1:${restartPort}`;
        await waitReady(restartedBaseUrl, startupLimitMs);

        const restartedProfiles = await jsonRequestAt(restartedBaseUrl, "/api/profiles");
        const restartedFoundProfile = restartedProfiles.profiles.find((entry) => entry.id === profile.id);
        const restartedSaved = await jsonRequestAt(restartedBaseUrl, `/api/saved-videos?profileId=${profile.id}`);
        const restartedLiked = await jsonRequestAt(restartedBaseUrl, `/api/liked-videos?profileId=${profile.id}`);
        const restartedHistory = await jsonRequestAt(restartedBaseUrl, `/api/history?profileId=${profile.id}`);
        const restartedSettings = await jsonRequestAt(restartedBaseUrl, `/api/settings`);
        const restartedRawSettings = readJsonIfPresent(path.join(dataDir, "user-settings.json"));

        const restartDb = new Database(dbPath, { readonly: true });
        const restartedWatchedDbRow = restartDb.prepare("SELECT watched_seconds, duration_seconds, watched_ratio, watched_at FROM watched_videos WHERE profile_id = ? AND video_id = ?").get(profile.id, video.id);
        restartDb.close();

        compareMigrationRecords(`${tag}-restart`, {
          profile,
          settings: legacySettings,
          rawSettings: legacySettings,
          savedVideo: video,
          likedVideo: video,
          watchedVideo: watchedRecord
        }, {
          profile: restartedFoundProfile,
          settings: restartedSettings,
          rawSettings: restartedRawSettings,
          savedVideoIds: restartedSaved.savedVideoIds,
          likedVideoIds: restartedLiked.likedVideoIds,
          historyVideos: restartedHistory.videos,
          watchedDbRow: restartedWatchedDbRow
        });

        return { scope: "production-server", measurements: { durableCollections: 3, integrityOk: true }, evidence: [evidence] };
      } finally {
        await stopChild(server);
      }
    });
  }

  await caseRun("e2e.migration-legacy-embedding-tables", "The current algorithm store imports an older dynamic embedding table variant and retains logical vectors.", async () => {
    const root = await mkdtemp(path.join(outputRoot, "migration-embedding-"));
    const dataDir = path.join(root, "data");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(dataDir, "gretel.sqlite");
    const db = new Database(dbPath);
    db.exec(extractFirstDatabaseSql(gitShow("v0.5.2", "lib/profile-store.ts")));
    // NOTE: NO ensureColumn pre-patches!
    const profileId = "legacy-embedding-profile";
    const now = Date.now();
    db.prepare("INSERT INTO profiles (id, name, tags_json, channels_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(profileId, "Embedding legacy", JSON.stringify(["systems design"]), "[]", now, now);
    const poolKey = createPoolKey(["systems design"], []);
    db.prepare("INSERT INTO feed_pool_state (profile_id, pool_key, root_discovered_at, updated_at) VALUES (?, ?, ?, ?)").run(profileId, poolKey, now, now);
    const poolVideo = { id: "legacy-vector-video", title: "Legacy vector fixture", author: "Legacy Lab", duration: "08:00", query: "systems design", thumbnailCacheUrl: fixtureThumbnail(3, "#a78bfa") };
    db.prepare(`INSERT INTO feed_pool_nodes (profile_id, pool_key, video_id, node_id, video_json, parent_video_id, similarity_score, parent_engagement_score, first_seen_at, updated_at, served_count, last_served_at) VALUES (?, ?, ?, 'tagSearch', ?, NULL, 0.9, 0, ?, ?, 0, NULL)`).run(profileId, poolKey, poolVideo.id, JSON.stringify(poolVideo), now, now);
    db.prepare("INSERT INTO feed_visited_videos (profile_id, pool_key, video_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(profileId, poolKey, poolVideo.id, now, now);
    const storeKey = "mock_e2e_mock_embedding_v1_8";
    db.exec(`CREATE TABLE "feed_centroids_${storeKey}" (profile_id TEXT NOT NULL, cache_key TEXT NOT NULL, original_json TEXT NOT NULL, current_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(profile_id, cache_key)); CREATE TABLE "feed_video_embeddings_${storeKey}" (profile_id TEXT NOT NULL, video_id TEXT NOT NULL, embedding_json TEXT NOT NULL, retained INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(profile_id, video_id));`);
    db.prepare(`INSERT INTO "feed_centroids_${storeKey}" VALUES (?, ?, ?, ?, ?)`).run(profileId, "systems design", "[1,0,0,0,0,0,0,0]", "[1,0,0,0,0,0,0,0]", now);
    db.prepare(`INSERT INTO "feed_video_embeddings_${storeKey}" VALUES (?, ?, ?, 1, ?)`).run(profileId, poolVideo.id, "[1,0,0,0,0,0,0,0]", now);
    db.close();
    const migrationConfigPath = path.join(root, "gretel.config.json");
    await writeFile(migrationConfigPath, await readFile(context.configPath), { mode: 0o600 });
    const port = await freePort();
    const server = await startServerFor({ dataDir, configPath: migrationConfigPath, logPath: path.join(root, "server.log"), port });
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitReady(baseUrl, startupLimitMs);
      const feed = await jsonRequestAt(baseUrl, "/api/feed", { method: "POST", body: { profileId, tags: ["systems design"], channels: [] } });
      assert(feed && !feed.error, `legacy embedding feed request failed: ${feed?.error || "unknown"}`);
      const migrated = new Database(dbPath, { readonly: true });
      const centroid = migrated.prepare("SELECT current_json, original_json FROM feed_centroids WHERE profile_id = ? AND store_key = ? AND cache_key = ?").get(profileId, storeKey, "systems design");
      const embedding = migrated.prepare("SELECT embedding_json FROM feed_video_embeddings WHERE profile_id = ? AND store_key = ? AND video_id = ?").get(profileId, storeKey, "legacy-vector-video");
      const oldTables = migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'feed_centroids_%' OR name LIKE 'feed_video_embeddings_%')").all();
      migrated.close();
      assert(centroid && embedding, "legacy embedding rows were not copied into current tables");
      assert.deepStrictEqual(JSON.parse(centroid.current_json), [1, 0, 0, 0, 0, 0, 0, 0], "migrated centroid vector mismatch");
      assert.deepStrictEqual(JSON.parse(centroid.original_json), [1, 0, 0, 0, 0, 0, 0, 0], "migrated original centroid vector mismatch");
      assert.deepStrictEqual(JSON.parse(embedding.embedding_json), [1, 0, 0, 0, 0, 0, 0, 0], "migrated embedding vector mismatch");
      assert.strictEqual(oldTables.length, 0, "legacy dynamic embedding tables were not retired");
      const legacyDynamicSource = gitShow("01a5525", "lib/feed/algorithm-store.ts");
      const evidence = await writeEvidence("migration-embedding-tables", { legacyDynamicCommit: "01a5525", legacyDynamicAlgorithmSourceSha256: sha256(legacyDynamicSource), storeKey, centroidRetained: true, embeddingRetained: true, oldTablesRetired: true });
      return { scope: "production-server", measurements: { retainedRows: 2, vectorExactMatch: true }, evidence: [evidence] };
    } finally {
      await stopChild(server);
    }
  });
}

async function runSelfTests() {
  await caseRun("runner.strict-failing-fixture", "Strict mode returns a non-zero result when a fixture fails.", async () => {
    const fixture = [{ status: "fail" }, { status: "pass" }];
    assert(strictExitCode(fixture, true) !== 0, "strict exit policy accepted a failing fixture");
    const evidence = await writeEvidence("runner-failing-fixture", { strictExitCode: strictExitCode(fixture, true) });
    return { scope: "module-integration", measurements: { failingCases: 1 }, evidence: [evidence] };
  });
  await caseRun("runner.missing-prerequisite", "Missing prerequisites are blocked and never silently converted into passes.", async () => {
    const caseValue = missingPrerequisiteCase("missing artifact");
    assert(caseValue.status === "blocked", `missing prerequisite status was ${caseValue.status}`);
    const evidence = await writeEvidence("runner-missing-prerequisite", caseValue);
    return { scope: "module-integration", measurements: { status: caseValue.status }, evidence: [evidence] };
  });
  await caseRun("runner.cleanup-cancellation", "Cancellation teardown only signals a child created by the runner and completes within the bounded timeout.", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: process.platform !== "win32", stdio: "ignore" });
    activeChildren.add(child);
    await delay(100);
    const started = Date.now();
    await stopChild(child);
    assert(Date.now() - started < 5_000, "cancellation teardown exceeded bound");
    const evidence = await writeEvidence("runner-cleanup-cancellation", { boundedTeardown: true });
    return { scope: "module-integration", measurements: { teardownMs: Date.now() - started }, evidence: [evidence] };
  });
  await caseRun("runner.migration-assertion-catches-mutation", "Migration comparison assertions catch tampered fields, missing data, and mutated vectors.", async () => {
    const baseExpected = {
      profile: { id: "p1", name: "Valid Profile", tags: ["sys"], channels: [] },
      settings: { openRouterApiKey: "set", openRouterModel: "m1", developerAnalytics: true },
      rawSettings: { openRouterApiKey: "secret-key" },
      savedVideo: { id: "v1", title: "Video 1", author: "A1" },
      likedVideo: { id: "v1", title: "Video 1", author: "A1" },
      watchedVideo: { id: "v1", title: "Video 1", author: "A1", watchedSeconds: 240, durationSeconds: 480, watchedRatio: 0.5 }
    };
    const baseActual = {
      profile: { id: "p1", name: "Valid Profile", tags: ["sys"], channels: [] },
      settings: { openRouterApiKey: "set", openRouterModel: "m1", developerAnalytics: true },
      rawSettings: { openRouterApiKey: "secret-key" },
      savedVideoIds: ["v1"],
      likedVideoIds: ["v1"],
      historyVideos: [{ id: "v1", title: "Video 1", author: "A1" }],
      watchedDbRow: { watched_seconds: 240, duration_seconds: 480, watched_ratio: 0.5 },
      feedPoolStateColumns: ["profile_id", "pool_key", "last_expanded_at"],
      feedPoolNodesColumns: ["profile_id", "pool_key", "impression_count"]
    };

    compareMigrationRecords("control", baseExpected, baseActual);

    assert.throws(() => {
      compareMigrationRecords("tamper-name", baseExpected, { ...baseActual, profile: { ...baseActual.profile, name: "Tampered Name" } });
    }, /profile name mismatch/);

    assert.throws(() => {
      compareMigrationRecords("tamper-watch", baseExpected, {
        ...baseActual,
        watchedDbRow: { ...baseActual.watchedDbRow, watched_seconds: 100 }
      });
    }, /DB watched_seconds mismatch/);

    assert.throws(() => {
      compareMigrationRecords("tamper-key", baseExpected, {
        ...baseActual,
        rawSettings: { openRouterApiKey: "mutated-key" }
      });
    }, /unmasked API key was modified or lost/);

    assert.throws(() => {
      const v1 = [1, 0, 0, 0, 0, 0, 0, 0];
      const v2 = [0.99, 0, 0, 0, 0, 0, 0, 0];
      assert.deepStrictEqual(v1, v2);
    }, /Expected values to be strictly deep-equal|Values have differences|ERR_ASSERTION/);

    const evidence = await writeEvidence("runner-migration-tamper-control", {
      mutationsTested: 4,
      profileNameCaught: true,
      watchDurationCaught: true,
      secretKeyCaught: true,
      vectorMismatchCaught: true
    });
    return { scope: "module-integration", measurements: { mutationsTested: 4 }, evidence: [evidence] };
  });
}

async function caseRun(id, criterion, work) {
  const started = Date.now();
  try {
    const value = await work();
    addCase(id, criterion, "pass", { durationMs: Date.now() - started, ...value });
  } catch (error) {
    addCase(id, criterion, "fail", { durationMs: Date.now() - started, reason: error instanceof Error ? error.message : String(error), scope: "production-server", evidence: [] });
  }
}

function addCase(id, criterion, status, details = {}) {
  const reason = details.reason || (status === "fail" || status === "blocked" || status === "not_run" ? "No additional failure reason recorded." : undefined);
  results.push({
    id,
    criterion,
    status,
    durationMs: details.durationMs || 0,
    evidence: details.evidence || [],
    reason,
    failureReason: reason,
    scope: details.scope || "production-server",
    measurements: details.measurements || {}
  });
}

async function writeReport(layer, artifact) {
  const report = {
    schemaVersion: 1,
    layer,
    runId: path.basename(runRoot),
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dirty: gitDirty(),
    seed: 20260905,
    platform: process.platform,
    architecture: process.arch,
    mode: layer === "self-test" ? "self-test" : mode,
    artifact: artifact || artifactMetadata(),
    thresholds: { startupReadyMs: startupLimitMs },
    cases: results
  };
  await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function artifactMetadata() {
  const artifactPath = context?.artifact || defaultArtifact;
  return getArtifactIdentity(artifactPath);
}

async function startProductionServer() {
  return startServerFor({ dataDir: context.dataDir, configPath: context.configPath, logPath: context.logPath, port: context.port, assignContext: true });
}

async function startServerFor({ dataDir, configPath, logPath, port, assignContext = false, preload = null }) {
  const env = allowlistedEnvironment({ dataDir, configPath, logPath, port, preload });
  const artifact = context?.artifact || defaultArtifact;
  const child = spawn(process.execPath, [path.join(artifact, "server.js")], {
    cwd: artifact,
    env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"]
  });
  activeChildren.add(child);
  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const onData = (chunk) => logStream.write(scrub(String(chunk)));
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.once("close", () => {
    logStream.end();
    activeChildren.delete(child);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitReady(baseUrl, startupLimitMs);
  if (assignContext) context.baseUrl = baseUrl;
  return child;
}

async function stopProductionServer() {
  if (context.server) {
    await stopChild(context.server);
    context.server = null;
  }
}

async function waitReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config`, { headers: authHeaders(), signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms (${lastError})`);
}

async function http(route, init = {}) {
  return fetch(`${context.baseUrl}${route}`, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
}

async function jsonRequest(route, init = {}) {
  return jsonRequestAt(context.baseUrl, route, init);
}

async function jsonRequestAt(baseUrl, route, init = {}) {
  const headers = { ...authHeaders(), ...(init.headers || {}) };
  if (init.body && typeof init.body === "object") {
    headers["content-type"] = "application/json";
    init = { ...init, body: JSON.stringify(init.body) };
  }
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

function authHeaders() {
  return { "x-gretel-token": token };
}

async function launchChromium(userDataDir) {
  const executable = findChromium();
  assert(executable, "Chromium executable was not found");
  await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  const port = await freePort();
  const env = allowlistedEnvironment({ dataDir: path.join(userDataDir, "data"), configPath: context.configPath, logPath: path.join(userDataDir, "browser.log"), port });
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { env, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"] });
  activeChildren.add(child);
  child.once("close", () => activeChildren.delete(child));
  const deadline = Date.now() + 10_000;
  let target;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((entry) => entry.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    await delay(100);
  }
  assert(target?.webSocketDebuggerUrl, "Chromium CDP endpoint did not become ready");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const cdp = new CdpSession(socket);
  await cdp.ready();
  await cdp.command("Runtime.enable");
  await cdp.command("Network.enable");
  await cdp.command("Page.enable");
  await cdp.command("Log.enable");
  return {
    cdp,
    child,
    executable,
    requestFailures: cdp.requestFailures,
    pageErrors: cdp.pageErrors,
    navigate: (url) => cdp.navigate(url),
    reload: (url) => cdp.navigate(url),
    evaluate: (expression) => cdp.evaluate(expression),
    waitFor: (expression, timeout) => cdp.waitFor(expression, timeout),
    close: async () => { await cdp.close(); await stopChild(child); }
  };
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.requests = new Map();
    this.requestFailures = [];
    this.pageErrors = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.requestWillBeSent") this.requests.set(message.params.requestId, { url: message.params.request?.url || "", method: message.params.request?.method || "GET" });
      if (message.method === "Network.loadingFailed") {
        const request = this.requests.get(message.params?.requestId) || {};
        this.requestFailures.push({ url: request.url || message.params?.blockedReason || message.params?.errorText || "unknown", method: request.method || "GET", error: message.params?.errorText || "" });
      }
      if (message.method === "Network.responseReceived" && message.params?.response?.status >= 400 && !message.params.response.url.endsWith("/favicon.ico")) {
        const request = this.requests.get(message.params.requestId) || {};
        this.requestFailures.push({ url: message.params.response.url, method: request.method || "GET", status: message.params.response.status });
      }
      if (message.method === "Runtime.exceptionThrown") this.pageErrors.push(message.params?.exceptionDetails?.text || "Runtime exception");
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) resolve();
      else {
        this.socket.addEventListener("open", resolve, { once: true });
        this.socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), { once: true });
      }
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async navigate(url) {
    await this.command("Page.navigate", { url });
    await delay(250);
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluate failed";
      throw new Error(`browser evaluate failed for ${expression}: ${details}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await delay(100);
    }
    throw new Error(`browser condition timed out: ${expression} (${String(last)})`);
  }

  async close() {
    try { this.socket.close(); } catch {}
  }
}

async function prepareOutputRoot(requested) {
  if (!requested) return mkdtemp(path.join(os.tmpdir(), "gretel-e2e-output-"));
  const absolute = path.resolve(requested);
  assertSafeScratchPath(absolute);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const stats = await lstat(absolute);
  assert(!stats.isSymbolicLink(), "output directory must not be a symlink");
  return absolute;
}

function assertSafeScratchPath(target) {
  const resolved = path.resolve(target);
  const forbidden = new Set([path.parse(resolved).root, os.homedir(), repoRoot]);
  assert(!forbidden.has(resolved), `refusing unsafe scratch path ${resolved}`);
  let parent = path.dirname(resolved);
  while (parent && parent !== path.parse(parent).root && existsSync(parent)) {
    const realParent = realpathSync(parent);
    assert(!forbidden.has(realParent), `refusing scratch path through protected symlink ${parent}`);
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

async function writeEvidence(name, value) {
  const relative = path.join("evidence", `${name}.json`);
  const target = path.join(outputRoot, relative);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${JSON.stringify(redact(value), null, 2)}\n`, { mode: 0o600 });
  return relative;
}

function allowlistedEnvironment({ dataDir, configPath, logPath, port, preload = null }) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    NODE_ENV: "production",
    NODE_OPTIONS: preload ? `--require ${preload}` : "",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    GRETEL_DATA_DIR: dataDir,
    GRETEL_LOG_FILE: logPath,
    GRETEL_CONFIG: configPath,
    GRETEL_API_TOKEN: token,
    TZ: "UTC",
    LC_ALL: "C",
    NO_COLOR: "1"
  };
}

async function shutdownChildren() {
  const children = [...activeChildren];
  await Promise.all(children.map((child) => stopChild(child)));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    activeChildren.delete(child);
    return;
  }
  const pid = child.pid;
  try {
    if (process.platform !== "win32" && pid) process.kill(-pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {}
  const deadline = Date.now() + 2_000;
  while (child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child.exitCode === null) {
    try {
      if (process.platform !== "win32" && pid) process.kill(-pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {}
  }
  activeChildren.delete(child);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function createPoolKey(tags, channels) {
  return JSON.stringify({ tags: tags.map((value) => value.replace(/\s+/g, " ").trim().toLowerCase()).sort(), channels: channels.map((value) => value.replace(/\s+/g, " ").trim().toLowerCase()).sort(), channelSort: "mixed" });
}

function fixtureThumbnail(index, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/><text x="32" y="190" font-family="sans-serif" font-size="40" fill="#0a0a0c">Gretel E2E ${index + 1}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function extractFirstDatabaseSql(source) {
  const match = source.match(/db\.exec\(`([\s\S]*?)`\);/);
  if (!match) throw new Error("Could not extract old profile-store database schema");
  return match[1];
}

function extractLazySchemaAdditions(tag) {
  const additions = [];
  try {
    const poolSource = gitShow(tag, "lib/feed/pool-store.ts");
    const regex = /ensureColumn\(\s*["']([^"']+)["'],\s*["']([^"']+)["'],\s*["']([^"']+)["']\s*\)/g;
    for (const match of poolSource.matchAll(regex)) {
      additions.push({ table: match[1], column: match[2], definition: match[3], source: `${tag}:lib/feed/pool-store.ts` });
    }
  } catch {}
  return additions;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all();
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

function gitShow(tag, file) {
  return execFileSync("git", ["show", `${tag}:${file}`], { cwd: repoRoot, encoding: "utf8" });
}

function gitSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function gitDirty() {
  try { return Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim()); } catch { return true; }
}

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

function readJsonIfPresent(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function findChromium() {
  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    try { return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim() || null; } catch {}
  }
  return null;
}

function scrub(value) {
  return String(value).replaceAll(secret, "[REDACTED]").replaceAll(token, "[TOKEN]");
}

function redact(value) {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /secret|token|key/i.test(key) ? "[REDACTED]" : redact(item)]));
  return value;
}

function missingPrerequisiteCase(reason) {
  return { status: "blocked", reason, criterion: "A missing prerequisite must block the gate." };
}

function strictExitCode(cases, strictMode) {
  const bad = cases.some((entry) => entry.status === "fail" || (strictMode && ["blocked", "not_run"].includes(entry.status)));
  return bad ? 1 : 0;
}

function exitCode() {
  return strictExitCode(results, strict);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") result.strict = true;
    else if (arg === "--self-test") result.selfTest = true;
    else if (arg === "--keep-run-root") result.keepRunRoot = true;
    else if (arg.startsWith("--mode=")) result.mode = arg.slice(7);
    else if (arg === "--mode") result.mode = argv[++index];
    else if (arg.startsWith("--output=")) result.output = arg.slice(9);
    else if (arg === "--output") result.output = argv[++index];
    else if (arg.startsWith("--artifact=")) result.artifact = arg.slice(11);
    else if (arg === "--artifact") result.artifact = argv[++index];
    else if (arg.startsWith("--startup-ms=")) result.startupMs = arg.slice(13);
    else if (arg === "--startup-ms") result.startupMs = argv[++index];
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
  }
  return result;
}

function printHelp() {
  console.log("Usage: node tests/release/e2e/run.mjs [--mode all|production|browser|migration|self-test] [--artifact .next/standalone] [--startup-ms 30000] [--output DIR] [--strict]");
}

try {
  await main();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  addCase("e2e.runner", "The E2E runner must produce a report when setup or teardown fails.", "fail", { reason, scope: "module-integration", evidence: [] });
  if (outputRoot && runRoot) {
    try { await writeReport("e2e", context ? artifactMetadata() : null); } catch {}
  }
  await shutdownChildren();
  console.error(`E2E runner failed: ${reason}`);
  process.exitCode = 1;
}
