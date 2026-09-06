// Accelerated 180/365-day storage workload against actual production store
// routines. Uses a time seam (cleanupOldCaches(now)) and records per-table
// row counts, logical payload bytes and SQLite page accounting before/after.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, lstatSync, existsSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { rmSync as fsRm } from "node:fs";
import { createIsolatedRunRoot, writeSyntheticConfig } from "./env-isolation.mjs";

export const STORAGE_DAYS_DEFAULT = 180;

/**
 * Run the accelerated storage workload.
 * Returns a structured result with per-table counts and file categories.
 */
export async function runAcceleratedStorage({ days = STORAGE_DAYS_DEFAULT, profiles = 3, outputRoot } = {}) {
  const started = Date.now();
  const runRootObj = createIsolatedRunRoot("gretel-soak-storage-", outputRoot || os.tmpdir());
  const runRoot = runRootObj.runRoot;
  const previousEnv = {
    GRETEL_DATA_DIR: process.env.GRETEL_DATA_DIR,
    GRETEL_LOG_FILE: process.env.GRETEL_LOG_FILE,
    GRETEL_CONFIG: process.env.GRETEL_CONFIG,
    NODE_ENV: process.env.NODE_ENV,
    GRETEL_LOG_LEVEL: process.env.GRETEL_LOG_LEVEL
  };
  process.env.GRETEL_DATA_DIR = runRootObj.dataDir;
  process.env.GRETEL_LOG_FILE = runRootObj.logFile;
  process.env.GRETEL_CONFIG = runRootObj.configPath;
  process.env.GRETEL_LOG_LEVEL = "warn";
  process.env.NODE_ENV = "production";

  // The compiler output lives below this worktree so Node resolves the
  // worktree's own node_modules. It is removed before returning; no shared
  // node_modules or .next directory is linked into the scratch root.
  const buildDir = path.join(process.cwd(), "tests", "release", "soak", `.compiled-${crypto.randomUUID()}`);
  writeSyntheticConfig(runRootObj.configPath, { feed: { poolSizeCap: 20 } });
  const require_ = compileModules(buildDir);
  const profileStore = require_(path.join(buildDir, "lib", "profile-store.js"));
  const cacheCleanup = require_(path.join(buildDir, "lib", "cache-cleanup.js"));
  const poolStore = require_(path.join(buildDir, "lib", "feed", "pool-store.js"));
  const algorithmStore = require_(path.join(buildDir, "lib", "feed", "algorithm-store.js"));
  const metrics = require_(path.join(buildDir, "lib", "performance-metrics.js"));
  const settings = require_(path.join(buildDir, "lib", "settings.js"));
  const configMod = require_(path.join(buildDir, "lib", "feed", "config.js"));
  const poolSizeCap = configMod.getGretelConfig().feed.poolSizeCap;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const db = profileStore.getDatabase();

  // --- Durable baseline: history/saved/liked per profile ---
  const profilesArr = [];
  for (let p = 0; p < profiles; p++) {
    const prof = profileStore.createProfile(`Soak profile ${p}`, [`tag-${p}`], [`Channel ${p}`]);
    profilesArr.push(prof);
  }

  const videos = [];
  for (let d = 0; d < days; d++) {
    const ts = now - (days - d) * day;
    for (const prof of profilesArr) {
      const video = {
        id: `vid-${d}-${prof.id.slice(0, 8)}`,
        title: `Soak video day ${d} profile ${prof.name}`,
        author: `Channel ${d % 20}`,
        duration: "10:00",
        query: `tag-${d % 6}`,
        similarityScore: 0.5,
        engagementScore: 0.2,
        channelId: `UC-soak-${d % 20}`,
        channelKey: `channel ${d % 20}`
      };
      videos.push({ prof, video, ts });
    }
  }

  // --- Seed via actual production store routines ---
  // Timestamps on the user-owned rows are intentionally current: cleanup has
  // no authority to age or delete history. Disposable fixtures below carry
  // the accelerated 180/365-day timestamps through their production seams or
  // a narrowly documented SQL backdate.
  for (const { prof, video, ts } of videos) {
    profileStore.saveWatchedVideo({
      profileId: prof.id,
      video,
      watchedSeconds: 300,
      durationSeconds: 600
    });
    profileStore.saveVideo(prof.id, video);
    profileStore.likeVideo(prof.id, video);
    if (Number(video.id.split("-")[1]) % 5 === 0) {
      profileStore.recordVideoInteraction(prof.id, video.id, { clicked: true, ignoreCount: 0 });
    }
  }

  // --- Changing pool keys / embeddings across days ---
  const poolKeysSeen = new Set();
  let activeModel = null;
  for (let d = 0; d < days; d += 7) {
    for (const prof of profilesArr) {
      const model = Math.floor(d / 7) % 2 === 0 ? "mock/hash-v1" : "mock/hash-v2";
      if (model !== activeModel) {
        updateEmbeddingModel(runRootObj.configPath, model);
        activeModel = model;
      }
      const tags = [`tag-${d % 6}`, `drift-${d}`];
      const poolKey = poolStore.createFeedPoolKey({ tags, channels: [], channelSort: "mixed" });
      poolKeysSeen.add(`${prof.id}:${poolKey}`);
      poolStore.markRootDiscovered(prof.id, poolKey, now - (days - d) * day);
      algorithmStore.saveCentroid(prof.id, poolKey, [1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0]);
      const nodes = [];
      for (let i = 0; i < 25; i++) {
        nodes.push({
          id: `pool-${d}-${prof.id.slice(0, 6)}-${i}`,
          title: `Pool node ${d} ${i}`,
          author: "Channel 0",
          duration: "10:00",
          query: tags[0],
          similarityScore: 0.9,
          engagementScore: 0.1,
          channelId: "UC-soak-0",
          channelKey: "channel 0"
        });
      }
      poolStore.addPoolNodes(prof.id, poolKey, "tagSearch", nodes, now - (days - d) * day);
      // Old embeddings for each node
      for (const n of nodes) {
        algorithmStore.retainEmbedding(prof.id, n.id, [1, 0, 0, 0, 0, 0, 0, 0]);
      }
      // Exercise the actual cap routine rather than treating a small fixture
      // as proof that an unbounded insert path is safe.
      poolStore.prunePool(prof.id, poolKey, nodes, poolSizeCap);
      if (d < days - 30) {
        db.prepare("UPDATE feed_pool_state SET updated_at = ? WHERE profile_id = ? AND pool_key = ?")
          .run(now - (days - d) * day, prof.id, poolKey);
        db.prepare("UPDATE feed_centroids SET updated_at = ? WHERE profile_id = ? AND cache_key = ?")
          .run(now - (days - d) * day, prof.id, poolKey);
        db.prepare("UPDATE feed_video_embeddings SET updated_at = ? WHERE profile_id = ? AND video_id LIKE ?")
          .run(now - (days - d) * day, prof.id, `pool-${d}-${prof.id.slice(0, 6)}-%`);
      }
    }
  }

  // --- Visited + impressions (unbounded-by-cleanup tables) ---
  for (const { prof, video, ts } of videos) {
    profileStore.recordVideoImpressions(prof.id, [video.id]);
  }

  // --- Old metrics traces (30-day policy): seeded via persist then direct SQL
  //     backdating of started_at to simulate the actual 180-day spread. ---
  settings.setUserSettings({ developerAnalytics: true });
  for (let d = 0; d < days; d += 3) {
    const trace = metrics.createPerformanceTrace("soak.storage", { profileId: profilesArr[0].id });
    // developerAnalytics must be on for traces to persist
    trace.enabled = true;
    trace.operations.push({ name: "soak.op", durationMs: 5, status: "ok", input: {} });
    metrics.persistPerformanceTrace(trace, { day: d });
    db.prepare("UPDATE performance_traces SET started_at = ? WHERE id = ?")
      .run(now - (days - d) * day, trace.requestId);
  }

  // --- Filesystem fixtures: old thumbnails, youtube-sessions, rotated logs ---
  const thumbDir = path.join(runRootObj.dataDir, "thumbnails");
  const sessDir = path.join(runRootObj.dataDir, "youtube-sessions");
  mkdirSync(thumbDir, { recursive: true });
  mkdirSync(sessDir, { recursive: true });
  const staleFiles = [];
  const freshFiles = [];
  for (let i = 0; i < 40; i++) {
    const old = i < 20;
    const p = path.join(thumbDir, `thumb-${i}.jpg`);
    writeFileSync(p, Buffer.alloc(2048, 7));
    const age = old ? now - 40 * day : now - 1 * day;
    utimesSync(p, age / 1000, age / 1000);
    (old ? staleFiles : freshFiles).push(p);
  }
  for (let i = 0; i < 10; i++) {
    const old = i < 5;
    const p = path.join(sessDir, `session-${i}.json`);
    writeFileSync(p, JSON.stringify({ fixture: i }));
    const age = old ? now - 40 * day : now - 1 * day;
    utimesSync(p, age / 1000, age / 1000);
    (old ? staleFiles : freshFiles).push(p);
  }
  // Symlinks inside data root pointing outside (file and directory escape
  // attempts). The directory case protects against recursive stat/readdir
  // cleanup following a link into another tree.
  const escapeTarget = path.join(runRoot, "outside.txt");
  writeFileSync(escapeTarget, "outside");
  const linkPath = path.join(thumbDir, "escape-link.jpg");
  const escapeDir = path.join(runRoot, "outside-cache");
  mkdirSync(escapeDir, { recursive: true });
  const escapeDirFile = path.join(escapeDir, "old.txt");
  writeFileSync(escapeDirFile, "outside-directory");
  utimesSync(escapeDirFile, (now - 40 * day) / 1000, (now - 40 * day) / 1000);
  const escapeDirLink = path.join(thumbDir, "escape-dir");
  try {
    const { symlinkSync } = await import("node:fs");
    symlinkSync(escapeTarget, linkPath);
    symlinkSync(escapeDir, escapeDirLink, "dir");
    const oldAge = now - 40 * day;
    utimesSync(linkPath, oldAge / 1000, oldAge / 1000);
  } catch {}

  const logDir = path.join(runRootObj.logsDir);
  // Four synthetic rotated files model the logger's active file plus its
  // three retained rotations without flooding the harness console or making
  // the storage workload depend on logger stdin lifecycle handlers.
  for (let i = 0; i < 4; i++) {
    writeFileSync(path.join(logDir, i === 0 ? "gretel.log" : `gretel.log.${i}`), Buffer.alloc(1024 * 1024, 76));
  }

  const beforeCheckpoint = checkpointWal(db);
  const before = snapshotState(db, runRootObj.dataDir, logDir);
  before.checkpoint = beforeCheckpoint;
  const durableBaseline = durableFingerprint(db, profilesArr);

  // --- Invoke ACTUAL production cleanup path with time seam ---
  cacheCleanup.cleanupOldCaches(now);
  // Idempotence: second sweep must not change anything
  cacheCleanup.cleanupOldCaches(now);

  const afterCheckpoint = checkpointWal(db);
  let after = snapshotState(db, runRootObj.dataDir, logDir);
  after.checkpoint = afterCheckpoint;

  // --- Assertions ---
  const cases = [];
  const evidence = [];

  // 1. Stale file fixtures removed, fresh survive
  const staleGone = staleFiles.filter((f) => !existsSync(f)).length === staleFiles.length;
  const freshAlive = freshFiles.every((f) => existsSync(f));
  cases.push({
    id: "soak-storage-stale-files-removed",
    criterion: "File fixtures older than 30-day mtime cutoff are removed by actual cleanupOldCaches; fresh entries survive.",
    status: staleGone && freshAlive ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: staleGone && freshAlive ? null : "Stale fixtures not removed or fresh fixtures deleted"
  });

  // 2. Symlink escape: cleanup must never delete targets outside data root
  const outsideIntact = existsSync(escapeTarget) && existsSync(escapeDirFile);
  cases.push({
    id: "soak-storage-symlink-escape",
    criterion: "Symlinked cache entries must never cause deletion outside the data root.",
    status: outsideIntact ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: outsideIntact ? null : "Symlink target outside data root was deleted"
  });

  // 3. Log rotation bound: <=4 files
  const logFiles = readdirSync(logDir).filter((f) => f.startsWith("gretel.log"));
  const logTotal = logFiles.reduce((s, f) => s + statSync(path.join(logDir, f)).size, 0);
  const logMaxRecordOvershoot = 16 * 1024;
  const logOvershoot = Math.max(0, logTotal - 20 * 1024 * 1024);
  cases.push({
    id: "soak-storage-log-bounds",
    criterion: "Log files <=4 and total <=20MiB plus a bounded max-record overshoot per logger rotation policy.",
    status: logFiles.length <= 4 && logOvershoot <= logMaxRecordOvershoot ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: logFiles.length <= 4 && logOvershoot <= logMaxRecordOvershoot
      ? (logOvershoot ? `bounded overshoot=${logOvershoot} bytes` : null)
      : `logFiles=${logFiles.length} total=${logTotal} overshoot=${logOvershoot}`
  });

  // 4. Metrics retention: traces older than 30 days removed after write-cleanup
  // Trigger scheduled/write cleanup by forcing another persist (crosses 100 threshold not needed;
  // we instead verify old traces are gone via direct DB inspection after the documented
  // retention policy ran — exercise actual write path with 100 more writes to trigger).
  for (let i = 0; i < 100; i++) {
    const t = metrics.createPerformanceTrace("soak.storage.cleanup", { profileId: profilesArr[0].id });
    t.enabled = true;
    t.operations.push({ name: "soak.op", durationMs: 1, status: "ok", input: {} });
    metrics.persistPerformanceTrace(t, { i });
  }
  const oldMetrics = db.prepare(
    "SELECT COUNT(*) AS c FROM performance_traces WHERE started_at < ?"
  ).get(now - 30 * day).c;
  // Orphan spans: spans whose trace is gone
  const orphanSpans = db.prepare(
    "SELECT COUNT(*) AS c FROM performance_spans s LEFT JOIN performance_traces t ON s.trace_id = t.id WHERE t.id IS NULL"
  ).get().c;
  // Include the writes that triggered the production retention hook in the
  // post-cleanup snapshot used by the idempotence comparison.
  const metricsAfterCheckpoint = checkpointWal(db);
  after = snapshotState(db, runRootObj.dataDir, logDir);
  after.checkpoint = metricsAfterCheckpoint;
  cases.push({
    id: "soak-storage-metrics-retention",
    criterion: "Metrics older than documented 30-day policy removed after write cleanup; orphan spans bounded.",
    status: oldMetrics === 0 && orphanSpans === 0 ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: oldMetrics === 0 && orphanSpans === 0 ? null : `oldTraces=${oldMetrics} orphanSpans=${orphanSpans}`
  });

  // 5. Pool cap per profile/pool_key respected
  let capOk = true;
  const perKeyCounts = db.prepare(
    "SELECT profile_id, pool_key, COUNT(*) AS c FROM feed_pool_nodes GROUP BY profile_id, pool_key"
  ).all();
  for (const row of perKeyCounts) {
    if (row.c > poolSizeCap) capOk = false;
  }
  cases.push({
    id: "soak-storage-pool-cap",
    criterion: `Configured feed pool cap (${poolSizeCap}) per profile/pool_key respected.`,
    status: capOk ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: capOk ? null : "A pool key exceeded the configured cap"
  });

  // 6. Stale keys / visited data bounded? — this is the KNOWN GAP: with
  // changing pool keys, old feed_pool_state/nodes/visited/embeddings rows are
  // NOT cleaned by any policy. Document as failing required criterion.
  const staleKeyRows = db.prepare(
    `SELECT COUNT(*) AS c FROM feed_pool_state
     WHERE (profile_id, pool_key) IN (
       SELECT profile_id, pool_key FROM feed_pool_state
       GROUP BY profile_id, pool_key HAVING MAX(updated_at) < ?
     )`
  ).get(now - 30 * day).c;
  const oldVisited = db.prepare(
    "SELECT COUNT(*) AS c FROM feed_visited_videos WHERE last_seen_at < ?"
  ).get(now - 30 * day).c;
  const oldCentroids = db.prepare(
    "SELECT COUNT(*) AS c FROM feed_centroids WHERE updated_at < ?"
  ).get(now - 30 * day).c;
  const oldEmbeddings = db.prepare(
    "SELECT COUNT(*) AS c FROM feed_video_embeddings WHERE updated_at < ?"
  ).get(now - 30 * day).c;
  const modelKeys = db.prepare(
    "SELECT COUNT(DISTINCT store_key) AS c FROM feed_video_embeddings"
  ).get().c;
  const noStalePolicy = staleKeyRows > 0 || oldVisited > 0 || oldCentroids > 0 || oldEmbeddings > 0;
  cases.push({
    id: "soak-storage-stale-key-policy",
    criterion: "Stale pool keys, visited data and old embeddings/centroids are bounded under changing pool and embedding-model keys (required policy).",
    status: noStalePolicy ? "fail" : "pass",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: noStalePolicy
      ? `No cleanup policy for stale pool keys / visited data / old embeddings: staleState=${staleKeyRows} oldVisited=${oldVisited} oldCentroids=${oldCentroids} oldEmbeddings=${oldEmbeddings}`
      : null
  });

  // 7. Durable records preserved exactly
  const durableCounts = {};
  let durableOk = true;
  for (const prof of profilesArr) {
    const w = db.prepare("SELECT COUNT(*) AS c FROM watched_videos WHERE profile_id = ?").get(prof.id).c;
    const s = db.prepare("SELECT COUNT(*) AS c FROM saved_videos WHERE profile_id = ?").get(prof.id).c;
    const l = db.prepare("SELECT COUNT(*) AS c FROM liked_videos WHERE profile_id = ?").get(prof.id).c;
    durableCounts[prof.id] = { watched: w, saved: s, liked: l };
    if (w === 0 || s === 0 || l === 0) durableOk = false;
  }
  const durableAfter = durableFingerprint(db, profilesArr);
  durableOk = durableOk && durableAfter.checksum === durableBaseline.checksum &&
    durableAfter.rows === durableBaseline.rows;
  cases.push({
    id: "soak-storage-durable-preserved",
    criterion: "Durable user-owned history/saved/liked records retain exact row counts and checksum across cache cleanup.",
    status: durableOk ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: durableOk ? null : `Durable baseline ${durableBaseline.checksum} changed to ${durableAfter.checksum}`
  });

  // 8. Repeated sweep idempotence
  cacheCleanup.cleanupOldCaches(now);
  const after2 = snapshotState(db, runRootObj.dataDir, logDir);
  const idempotent = JSON.stringify(after2.files) === JSON.stringify(after.files) &&
    JSON.stringify(after2.tables) === JSON.stringify(after.tables) &&
    after2.payloadBytes === after.payloadBytes;
  cases.push({
    id: "soak-storage-sweep-idempotence",
    criterion: "Repeated cleanup sweep is idempotent (no further changes).",
    status: idempotent ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: idempotent ? null : "Second sweep changed state"
  });

  const disposableBytes = ["thumbnails", "youtube-sessions", "logs"]
    .reduce((sum, category) => sum + (after.files[category]?.bytes || 0), 0) +
    ["feed_pool_nodes", "feed_video_embeddings", "feed_centroids", "feed_pool_state",
      "feed_visited_videos", "performance_traces", "performance_spans"]
      .reduce((sum, table) => sum + (after.payloadBytesByTable?.[table] || 0), 0);
  const disposableBudget = 512 * 1024 * 1024;
  cases.push({
    id: "soak-storage-disposable-budget",
    criterion: "Known disposable cache/log payload remains within the proposed 512MiB budget.",
    status: disposableBytes <= disposableBudget ? "pass" : "fail",
    durationMs: 0,
    evidence: ["logs/storage-snapshot.json"],
    failureReason: disposableBytes <= disposableBudget ? null : `disposableBytes=${disposableBytes}`
  });
  cases.push({
    id: "soak-storage-updater-temp-budget",
    criterion: "Native updater temporary storage is included in disposable-budget evidence.",
    status: "blocked",
    durationMs: 0,
    evidence: [],
    failureReason: "Native updater package/temp directory is outside the server-only storage harness"
  });

  db.close();
  rmrf(buildDir);
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const result = {
    days,
    profiles,
    before,
    after,
    cases,
    runRoot,
    logDir,
    dataDir: runRootObj.dataDir
  };
  // Persist snapshot for evidence (sanitized: counts only, no raw payloads)
  const snapDir = path.join(runRoot, "evidence");
  mkdirSync(snapDir, { recursive: true });
  const snap = {
    days, profiles, poolSizeCap, poolKeysSeen: poolKeysSeen.size, embeddingModelKeys: modelKeys,
    before, after, durableCounts, durableBaseline, durableAfter,
    logFiles, logTotalBytes: logTotal, logOvershootBytes: logOvershoot,
    disposableBytes, disposableBudgetBytes: disposableBudget,
    staleFilesCount: staleFiles.length, freshFilesCount: freshFiles.length
  };
  writeFileSync(path.join(snapDir, "storage-snapshot.json"), JSON.stringify(snap, null, 2));
  result.evidenceDir = snapDir;
  result.durationMs = Date.now() - started;
  return result;
}

function snapshotState(db, dataDir, logDir) {
  const tables = ["profiles", "watched_videos", "saved_videos", "liked_videos",
    "feed_pool_state", "feed_pool_nodes", "feed_visited_videos",
    "video_impressions", "video_interactions", "feed_centroids",
    "feed_video_embeddings", "performance_traces", "performance_spans"];
  const counts = {};
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    } catch { counts[t] = null; }
  }
  // Logical payload bytes by table. Text and JSON values are counted as UTF-8
  // byte lengths; this deliberately excludes SQLite page overhead.
  const payloadBytesByTable = {};
  let payloadBytes = 0;
  for (const t of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
      if (cols.length === 0) continue;
      const expr = cols.map((c) => `LENGTH(CAST(COALESCE("${c}",'') AS TEXT))`).join(" + ");
      const r = db.prepare(`SELECT COALESCE(SUM(${expr}),0) AS b FROM "${t}"`).get();
      payloadBytesByTable[t] = Number(r.b) || 0;
      payloadBytes += payloadBytesByTable[t];
    } catch {}
  }
  // Filesystem categories
  const files = {};
  for (const cat of ["thumbnails", "youtube-sessions"]) {
    const dir = path.join(dataDir, cat);
    files[cat] = listFilesRecursive(dir);
  }
  files.logs = listFilesRecursive(logDir);
  // SQLite page accounting
  const dbPath = path.join(dataDir, "gretel.sqlite");
  let pages = { main: 0, wal: 0, shm: 0, pageCount: 0, freelist: 0, pageSize: 0 };
  try {
    const pageCount = db.pragma("page_count", { simple: true });
    const freelist = db.pragma("freelist_count", { simple: true });
    const pageSize = db.pragma("page_size", { simple: true });
    pages = { pageCount, freelist, pageSize };
  } catch {}
  const fs = statFiles(dbPath, ["", ".wal", ".shm"]);
  pages.files = fs;
  pages.allocatedBytes = (pages.pageCount || 0) * (pages.pageSize || 0);
  pages.freeBytes = (pages.freelist || 0) * (pages.pageSize || 0);
  return { tables: counts, payloadBytes, payloadBytesByTable, files, pages };
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0, bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        count++;
        // lstat prevents evidence collection from traversing a symlink into
        // an external directory or attributing its target bytes to a cache.
        try { bytes += lstatSync(p).size; } catch {}
      }
    }
  }
  return { count, bytes };
}

function statFiles(dbPath, suffixes) {
  const out = {};
  for (const s of suffixes) {
    const p = dbPath + s;
    try { out[s || ".sqlite"] = statSync(p).size; } catch { out[s || ".sqlite"] = 0; }
  }
  return out;
}

function updateEmbeddingModel(configPath, model) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.embeddings = { ...(config.embeddings || {}), model };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const timestamp = new Date();
  utimesSync(configPath, timestamp, timestamp);
}

function durableFingerprint(db, profiles) {
  const rows = [];
  for (const profile of profiles) {
    for (const table of ["watched_videos", "saved_videos", "liked_videos"]) {
      const tableRows = db.prepare(`SELECT * FROM "${table}" WHERE profile_id = ? ORDER BY video_id`).all(profile.id);
      rows.push({ table, profileId: profile.id, rows: tableRows });
    }
  }
  const canonical = JSON.stringify(rows);
  return {
    rows: rows.reduce((count, entry) => count + entry.rows.length, 0),
    checksum: crypto.createHash("sha256").update(canonical).digest("hex")
  };
}

function checkpointWal(db) {
  try {
    const raw = db.pragma("wal_checkpoint(PASSIVE)");
    return Array.isArray(raw) ? (raw[0] || {}) : raw;
  } catch (error) {
    return { error: String(error).slice(0, 200) };
  }
}

function compileModules(buildDir) {
  const repoRoot = process.cwd();
  rmrf(buildDir);
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  // The output is nested inside this worktree, so Node resolves this
  // worktree's own node_modules through normal ancestor lookup. No writable
  // node_modules or .next directory is linked into the scratch root.
  const files = [
    ...listTsFiles(path.join(repoRoot, "lib")),
    path.join(repoRoot, "app", "api", "feed", "route.ts"),
    path.join(repoRoot, "app", "api", "feed", "build", "route.ts"),
    path.join(repoRoot, "app", "api", "impressions", "route.ts"),
    path.join(repoRoot, "app", "api", "profiles", "route.ts"),
    path.join(repoRoot, "app", "api", "watch-events", "route.ts")
  ].map((f) => path.relative(repoRoot, f));
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "node_modules", "typescript", "lib", "tsc.js"),
      "--outDir", buildDir, "--module", "commonjs", "--target", "ES2022",
      "--skipLibCheck", "--types", "node", "--esModuleInterop", ...files],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const nodeRequire = createRequire(import.meta.url);
  return (p) => nodeRequire(p);
}

function listTsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listTsFiles(p) : (p.endsWith(".ts") ? [p] : []);
  });
}

function rmrf(p) {
  try { fsRm(p, { recursive: true, force: true }); } catch {}
}
