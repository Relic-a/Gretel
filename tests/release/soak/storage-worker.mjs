// storage-worker.mjs: Isolated child worker executing the accelerated storage workload.
// Runs with controlled stdin and allowlisted environment.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, lstatSync,
  existsSync, utimesSync, unlinkSync, rmSync
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createIsolatedRunRoot, writeSyntheticConfig } from "./env-isolation.mjs";

function parseArgs(argv) {
  const out = { days: 180, profiles: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") out.days = Number(argv[++i]);
    else if (argv[i] === "--profiles") out.profiles = Number(argv[++i]);
    else if (argv[i] === "--output") out.outputRoot = argv[++i];
    else if (argv[i] === "--result-file") out.resultFile = argv[++i];
    else if (argv[i] === "--simulate-broken-rotation") out.brokenRotation = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = args.days || 180;
  const profiles = args.profiles || 3;
  const started = Date.now();

  const runRootObj = createIsolatedRunRoot("gretel-soak-storage-", args.outputRoot || os.tmpdir());
  const runRoot = runRootObj.runRoot;

  process.env.GRETEL_DATA_DIR = runRootObj.dataDir;
  process.env.GRETEL_LOG_FILE = runRootObj.logFile;
  process.env.GRETEL_CONFIG = runRootObj.configPath;
  process.env.GRETEL_LOG_LEVEL = "info";
  process.env.NODE_ENV = "production";

  const repoRoot = process.cwd();
  const buildDir = path.join(repoRoot, "tests", "release", "soak", `.compiled-worker-${crypto.randomUUID()}`);
  writeSyntheticConfig(runRootObj.configPath, { feed: { poolSizeCap: 20 } });

  const require_ = compileModules(repoRoot, buildDir);
  const profileStore = require_(path.join(buildDir, "lib", "profile-store.js"));
  const cacheCleanup = require_(path.join(buildDir, "lib", "cache-cleanup.js"));
  const poolStore = require_(path.join(buildDir, "lib", "feed", "pool-store.js"));
  const algorithmStore = require_(path.join(buildDir, "lib", "feed", "algorithm-store.js"));
  const metrics = require_(path.join(buildDir, "lib", "performance-metrics.js"));
  const settings = require_(path.join(buildDir, "lib", "settings.js"));
  const configMod = require_(path.join(buildDir, "lib", "feed", "config.js"));
  const logger = require_(path.join(buildDir, "lib", "logger.js"));

  const poolSizeCap = configMod.getGretelConfig().feed.poolSizeCap;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const db = profileStore.getDatabase();

  // --- 1. Durable baseline: history/saved/liked per profile with UTF-8 multibyte characters ---
  const profilesArr = [];
  for (let p = 0; p < profiles; p++) {
    const prof = profileStore.createProfile(`Soak profile ${p} 🚀`, [`tag-${p}`, "日本語"], [`Channel ${p}`]);
    profilesArr.push(prof);
  }

  const videos = [];
  for (let d = 0; d < days; d++) {
    const ts = now - (days - d) * day;
    for (const prof of profilesArr) {
      const video = {
        id: `vid-${d}-${prof.id.slice(0, 8)}`,
        title: `Soak video day ${d} profile ${prof.name} 🎬 特殊文字`,
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

  // --- 2. Changing pool keys / embeddings across days ---
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
          title: `Pool node ${d} ${i} ✨`,
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
      for (const n of nodes) {
        algorithmStore.retainEmbedding(prof.id, n.id, [1, 0, 0, 0, 0, 0, 0, 0]);
      }
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

  for (const { prof, video } of videos) {
    profileStore.recordVideoImpressions(prof.id, [video.id]);
  }

  // --- 3. Old metrics traces (30-day policy) ---
  settings.setUserSettings({ developerAnalytics: true });
  for (let d = 0; d < days; d += 3) {
    const trace = metrics.createPerformanceTrace("soak.storage", { profileId: profilesArr[0].id });
    trace.enabled = true;
    trace.operations.push({ name: "soak.op", durationMs: 5, status: "ok", input: { note: "multibyte 🚀" } });
    metrics.persistPerformanceTrace(trace, { day: d });
    db.prepare("UPDATE performance_traces SET started_at = ? WHERE id = ?")
      .run(now - (days - d) * day, trace.requestId);
  }

  // --- 4. Filesystem fixtures: old thumbnails, youtube-sessions, rotated logs ---
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
    writeFileSync(p, JSON.stringify({ fixture: i, tag: "日本語" }));
    const age = old ? now - 40 * day : now - 1 * day;
    utimesSync(p, age / 1000, age / 1000);
    (old ? staleFiles : freshFiles).push(p);
  }

  // Symlinks inside data root pointing outside (file and directory escape attempts)
  const escapeTarget = path.join(runRoot, "outside.txt");
  writeFileSync(escapeTarget, "outside-content");
  const linkPath = path.join(thumbDir, "escape-link.jpg");
  const escapeDir = path.join(runRoot, "outside-cache");
  mkdirSync(escapeDir, { recursive: true });
  const escapeDirFile = path.join(escapeDir, "old.txt");
  writeFileSync(escapeDirFile, "outside-directory-content");
  utimesSync(escapeDirFile, (now - 40 * day) / 1000, (now - 40 * day) / 1000);
  const escapeDirLink = path.join(thumbDir, "escape-dir");
  try {
    const { symlinkSync } = await import("node:fs");
    symlinkSync(escapeTarget, linkPath);
    symlinkSync(escapeDir, escapeDirLink, "dir");
    const oldAge = now - 40 * day;
    utimesSync(linkPath, oldAge / 1000, oldAge / 1000);
  } catch {}

  // --- 5. DRIVE ACTUAL PRODUCTION LOGGER THROUGH ROTATION THRESHOLDS ---
  const logDir = path.join(runRootObj.logsDir);
  mkdirSync(logDir, { recursive: true });
  const mainLogFile = runRootObj.logFile;

  if (args.brokenRotation) {
    // Simulated broken rotation: manually write 6 files to prove failure detection
    for (let i = 0; i < 6; i++) {
      writeFileSync(path.join(logDir, i === 0 ? "gretel.log" : `gretel.log.${i}`), Buffer.alloc(1024 * 1024 * 6, 76));
    }
  } else {
    // Drive actual logger:
    // Logger maxLogFileBytes is 5 MiB (5 * 1024 * 1024 = 5,242,880). Rotated files = 3.
    // Create initial 5MB chunk in active log, then call logger.logInfo to trigger rotation to .1
    writeFileSync(mainLogFile, Buffer.alloc(5 * 1024 * 1024, "x"));
    logger.logInfo("rotation.trigger.1", { msg: "force rotation 1" });
    await logger.flushLogFileWrites();

    // Fill again and trigger rotation to .2
    writeFileSync(mainLogFile, Buffer.alloc(5 * 1024 * 1024, "y"));
    logger.logInfo("rotation.trigger.2", { msg: "force rotation 2" });
    await logger.flushLogFileWrites();

    // Fill again and trigger rotation to .3
    writeFileSync(mainLogFile, Buffer.alloc(5 * 1024 * 1024, "z"));
    logger.logInfo("rotation.trigger.3", { msg: "force rotation 3" });
    await logger.flushLogFileWrites();

    // Fill again and trigger 4th rotation (should delete oldest .3 and keep only active + 3 rotations)
    writeFileSync(mainLogFile, Buffer.alloc(5 * 1024 * 1024, "w"));
    logger.logInfo("rotation.trigger.4", { msg: "force rotation 4" });
    await logger.flushLogFileWrites();

    // Test failed write resilience: point to directory and ensure queue does not crash
    const badDir = path.join(logDir, "bad-dir");
    mkdirSync(badDir, { recursive: true });
    process.env.GRETEL_LOG_FILE = badDir;
    logger.logInfo("failure.probe", { expectFail: true });
    await logger.flushLogFileWrites();
    process.env.GRETEL_LOG_FILE = mainLogFile;
    try { rmSync(badDir, { recursive: true, force: true }); } catch {}
  }

  // --- 6. State snapshots with physical SQLite + WAL + SHM and UTF-8 byte accounting ---
  // Hold WAL uncheckpointed for first snapshot so WAL and SHM exist
  const before = snapshotState(db, runRootObj.dataDir, logDir);
  const durableBaseline = durableFingerprint(db, profilesArr);

  // --- 7. Invoke ACTUAL production cleanup path with time seam ---
  cacheCleanup.cleanupOldCaches(now);
  // Idempotence: second sweep must not change anything
  cacheCleanup.cleanupOldCaches(now);

  let after = snapshotState(db, runRootObj.dataDir, logDir);

  // --- 8. Build Case Results ---
  const cases = [];

  // 1. Stale files removed
  const staleGone = staleFiles.filter((f) => !existsSync(f)).length === staleFiles.length;
  const freshAlive = freshFiles.every((f) => existsSync(f));
  cases.push({
    id: "soak-storage-stale-files-removed",
    criterion: "File fixtures older than 30-day mtime cutoff are removed by actual cleanupOldCaches; fresh entries survive.",
    status: staleGone && freshAlive ? "pass" : "fail",
    durationMs: 0,
    evidence: ["storage/storage-snapshot.json"],
    failureReason: staleGone && freshAlive ? null : "Stale fixtures not removed or fresh fixtures deleted"
  });

  // 2. Symlink escape (known product gap: statSync follows dir symlink and deletes target)
  const outsideTargetIntact = existsSync(escapeTarget);
  const outsideDirFileIntact = existsSync(escapeDirFile);
  const symlinkEscaped = !outsideTargetIntact || !outsideDirFileIntact;
  cases.push({
    id: "soak-storage-symlink-escape",
    criterion: "Symlinked cache entries must never cause deletion outside the data root.",
    status: symlinkEscaped ? "fail" : "pass",
    durationMs: 0,
    evidence: ["storage/storage-snapshot.json"],
    failureReason: symlinkEscaped
      ? `Symlink target outside data root was deleted (outsideTarget=${outsideTargetIntact}, outsideDirFile=${outsideDirFileIntact})`
      : null
  });

  // 3. Log rotation bounds
  const logFiles = readdirSync(logDir).filter((f) => f.startsWith("gretel.log"));
  const logTotal = logFiles.reduce((s, f) => s + statSync(path.join(logDir, f)).size, 0);
  const logMaxRecordOvershoot = 16 * 1024;
  const logOvershoot = Math.max(0, logTotal - 20 * 1024 * 1024);
  const logRotationOk = logFiles.length <= 4 && logOvershoot <= logMaxRecordOvershoot && !existsSync(path.join(logDir, "gretel.log.4"));
  cases.push({
    id: "soak-storage-log-bounds",
    criterion: "Log files <=4 and total <=20MiB plus a bounded max-record overshoot per logger rotation policy.",
    status: logRotationOk ? "pass" : "fail",
    durationMs: 0,
    evidence: ["storage/storage-snapshot.json"],
    failureReason: logRotationOk
      ? (logOvershoot ? `bounded overshoot=${logOvershoot} bytes` : null)
      : `logFiles=${logFiles.length} total=${logTotal} overshoot=${logOvershoot}`
  });

  // 4. Metrics retention
  for (let i = 0; i < 100; i++) {
    const t = metrics.createPerformanceTrace("soak.storage.cleanup", { profileId: profilesArr[0].id });
    t.enabled = true;
    t.operations.push({ name: "soak.op", durationMs: 1, status: "ok", input: {} });
    metrics.persistPerformanceTrace(t, { i });
  }
  const oldMetrics = db.prepare("SELECT COUNT(*) AS c FROM performance_traces WHERE started_at < ?").get(now - 30 * day).c;
  const orphanSpans = db.prepare(
    "SELECT COUNT(*) AS c FROM performance_spans s LEFT JOIN performance_traces t ON s.trace_id = t.id WHERE t.id IS NULL"
  ).get().c;
  after = snapshotState(db, runRootObj.dataDir, logDir);
  cases.push({
    id: "soak-storage-metrics-retention",
    criterion: "Metrics older than documented 30-day policy removed after write cleanup; orphan spans bounded.",
    status: oldMetrics === 0 && orphanSpans === 0 ? "pass" : "fail",
    durationMs: 0,
    evidence: ["storage/storage-snapshot.json"],
    failureReason: oldMetrics === 0 && orphanSpans === 0 ? null : `oldTraces=${oldMetrics} orphanSpans=${orphanSpans}`
  });

  // 5. Pool cap
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
    evidence: ["storage/storage-snapshot.json"],
    failureReason: capOk ? null : "A pool key exceeded the configured cap"
  });

  // 6. Stale key policy (known product gap: no policy to clean old pool keys/visited)
  const staleKeyRows = db.prepare(
    `SELECT COUNT(*) AS c FROM feed_pool_state
     WHERE (profile_id, pool_key) IN (
       SELECT profile_id, pool_key FROM feed_pool_state
       GROUP BY profile_id, pool_key HAVING MAX(updated_at) < ?
     )`
  ).get(now - 30 * day).c;
  const oldVisited = db.prepare("SELECT COUNT(*) AS c FROM feed_visited_videos WHERE last_seen_at < ?").get(now - 30 * day).c;
  const oldCentroids = db.prepare("SELECT COUNT(*) AS c FROM feed_centroids WHERE updated_at < ?").get(now - 30 * day).c;
  const oldEmbeddings = db.prepare("SELECT COUNT(*) AS c FROM feed_video_embeddings WHERE updated_at < ?").get(now - 30 * day).c;
  const modelKeys = db.prepare("SELECT COUNT(DISTINCT store_key) AS c FROM feed_video_embeddings").get().c;
  const hasStaleAccumulation = staleKeyRows > 0 || oldVisited > 0 || oldCentroids > 0 || oldEmbeddings > 0;
  cases.push({
    id: "soak-storage-stale-key-policy",
    criterion: "Stale pool keys, visited data and old embeddings/centroids are bounded under changing pool and embedding-model keys (required policy).",
    status: hasStaleAccumulation ? "fail" : "pass",
    durationMs: 0,
    evidence: ["storage/storage-snapshot.json"],
    failureReason: hasStaleAccumulation
      ? `No cleanup policy for stale pool keys / visited data / old embeddings: staleState=${staleKeyRows} oldVisited=${oldVisited} oldCentroids=${oldCentroids} oldEmbeddings=${oldEmbeddings}`
      : null
  });

  // 7. Durable records preserved
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
    evidence: ["storage/storage-snapshot.json"],
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
    evidence: ["storage/storage-snapshot.json"],
    failureReason: idempotent ? null : "Second sweep changed state"
  });

  // 9. Disposable budget
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
    evidence: ["storage/storage-snapshot.json"],
    failureReason: disposableBytes <= disposableBudget ? null : `disposableBytes=${disposableBytes}`
  });

  // 10. Native updater budget
  cases.push({
    id: "soak-storage-updater-temp-budget",
    criterion: "Native updater temporary storage is included in disposable-budget evidence.",
    status: "blocked",
    durationMs: 0,
    evidence: [],
    failureReason: "Native updater package/temp directory is outside the server-only storage harness"
  });

  db.close();
  try { rmSync(buildDir, { recursive: true, force: true }); } catch {}

  const snapshot = {
    days, profiles, poolSizeCap, poolKeysSeen: poolKeysSeen.size, embeddingModelKeys: modelKeys,
    before, after, durableCounts, durableBaseline, durableAfter,
    logFiles, logTotalBytes: logTotal, logOvershootBytes: logOvershoot,
    disposableBytes, disposableBudgetBytes: disposableBudget,
    staleFilesCount: staleFiles.length, freshFilesCount: freshFiles.length
  };

  const result = {
    days,
    profiles,
    before,
    after,
    cases,
    snapshot,
    runRoot,
    logDir,
    dataDir: runRootObj.dataDir,
    durationMs: Date.now() - started
  };

  if (args.resultFile) {
    mkdirSync(path.dirname(args.resultFile), { recursive: true });
    writeFileSync(args.resultFile, JSON.stringify(result, null, 2), "utf8");
  }

  process.exit(0);
}

function snapshotState(db, dataDir, logDir) {
  const tables = [
    "profiles", "watched_videos", "saved_videos", "liked_videos",
    "feed_pool_state", "feed_pool_nodes", "feed_visited_videos",
    "video_impressions", "video_interactions", "feed_centroids",
    "feed_video_embeddings", "performance_traces", "performance_spans"
  ];
  const counts = {};
  for (const t of tables) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c; } catch { counts[t] = null; }
  }

  // Logical payload bytes by table. Text and JSON values are counted as UTF-8
  // byte lengths (using LENGTH(CAST(COALESCE(...) AS BLOB))), NOT character count!
  const payloadBytesByTable = {};
  let payloadBytes = 0;
  for (const t of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
      if (cols.length === 0) continue;
      const expr = cols.map((c) => `LENGTH(CAST(COALESCE("${c}",'') AS BLOB))`).join(" + ");
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

  // SQLite physical file and page accounting
  const dbPath = path.join(dataDir, "gretel.sqlite");
  let pages = { main: 0, wal: 0, shm: 0, pageCount: 0, freelist: 0, pageSize: 0 };
  try {
    const pageCount = db.pragma("page_count", { simple: true });
    const freelist = db.pragma("freelist_count", { simple: true });
    const pageSize = db.pragma("page_size", { simple: true });
    pages = { pageCount, freelist, pageSize };
  } catch {}

  // Measure actual SQLite files: dbPath, dbPath-wal, dbPath-shm (NOT .wal/.shm!)
  const fsFiles = statFiles(dbPath, ["", "-wal", "-shm"]);
  pages.files = fsFiles;
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
    const label = s === "" ? ".sqlite" : s;
    try { out[label] = statSync(p).size; } catch { out[label] = 0; }
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

function compileModules(repoRoot, buildDir) {
  try { rmSync(buildDir, { recursive: true, force: true }); } catch {}
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));
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

main().catch((err) => {
  console.error("Storage worker fatal error:", err);
  process.exit(1);
});
