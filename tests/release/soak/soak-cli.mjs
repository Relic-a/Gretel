#!/usr/bin/env node
// Wall-clock sustained soak CLI. Runs the actual production Next.js standalone
// server (or next start) in an isolated data dir and cycles real HTTP
// operations: idle / browse / refresh / watch / impressions / profile switch /
// restarts. Samples RSS/CPU of the owned app process tree and writes
// time-series JSONL plus a structured report.

import { spawn } from "node:child_process";
import { createReadStream, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createIsolatedRunRoot, writeSyntheticConfig, buildChildEnv } from "./env-isolation.mjs";
import { validateScratchRoot, safeRemove } from "./scrub-runner.mjs";
import { getArtifactIdentity } from "../artifact-identity.mjs";
import { verifyAcknowledgedRows } from "./durable-evaluator.mjs";
import { newReport, caseResult, strictExit, summarize } from "./report-schema.mjs";
import {
  selectIdleWindows,
  runIdlePhase,
  evaluateIdleCpu,
  evaluateIdleRssStability,
  evaluateRssTrend,
  selectWindow,
  getCpuClockTicksPerSecond
} from "./soak-evaluator.mjs";

if (process.argv.includes("--phase-self-test")) {
  let now = 0;
  const samples = [];
  for (let cycle=0; cycle<9; cycle++) {
    const activeEnd = now + 600000;
    while (now < activeEnd) {samples.push({elapsedMs:now,op:"browse",phase:"active",phaseId:`active-${cycle}`,rssMb:200,cpuTicks:now/1000,processIdentity:"fixture:1"});now+=10001;}
    await runIdlePhase({durationMs: 610000, intervalMs: 10000, phaseId: `virtual-idle-${cycle}`, now: () => now, sleep: async ms => { now += ms + 1; }, sample: phase => samples.push({...phase, elapsedMs: now, rssMb: 200, cpuTicks: now / 1000, processIdentity: "fixture:1"})});
    now++;
  }
  const windows = selectIdleWindows(samples.filter(s=>s.phase==="idle"));
  console.log(JSON.stringify({scope:"self-test-virtual-time",virtualDurationMs:now,cpu:evaluateIdleCpu(windows.last,{clockTicks:100}),rss:evaluateIdleRssStability(windows.first,windows.last),trend:evaluateRssTrend(samples)}));
  process.exit(0);
}
const args = parseArgs(process.argv.slice(2));

if (args.durationSec !== undefined && (!Number.isFinite(args.durationSec) || args.durationSec <= 0)) {
  console.error("Invalid --duration: must be a positive number greater than 0");
  process.exit(1);
}

const durationMs = (args.durationSec ?? 60) * 1000;
const intervalMs = (args.intervalSec ?? 5) * 1000;
if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 30000) throw Error("Sampling interval must be 1–30 seconds; maximum permitted measurement gap is 30 seconds.");
const seed = args.seed ?? "soak-seed-1";
const mode = args.mode || "quick";
let outputRoot;
if (args.output) {
  mkdirSync(args.output, { recursive: true });
  outputRoot = validateScratchRoot(args.output);
} else {
  outputRoot = createIsolatedRunRoot("gretel-soak-out-").runRoot;
}

const runId = `soak-${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
const t0 = Date.now();

// --- Build server root: prefer existing .next/standalone, else next start ---
const repoRoot = process.cwd();
const standalone = path.join(repoRoot, ".next", "standalone");
const serverRoot = args.serverRoot || args.artifact || standalone;
const serverRootSpecified = Boolean(args.serverRoot || args.artifact);
const hasStandalone = existsSync(path.join(serverRoot, "server.js"));

// --- Isolated run environment ---
const runRootObj = createIsolatedRunRoot("gretel-soak-run-", outputRoot);
writeSyntheticConfig(runRootObj.configPath);

const metricsLogDir = path.join(outputRoot, "logs");
mkdirSync(metricsLogDir, { recursive: true });
const metricsLogPath = path.join(metricsLogDir, "metrics.jsonl");
const eventsLogPath = path.join(metricsLogDir, "events.jsonl");
writeFileSync(metricsLogPath, "");
writeFileSync(eventsLogPath, "");

let serverProcess = null;
let serverGeneration = 0;
let port = null;
const cases = [];

// Incremental metrics and bounded in-memory sliding windows
const recentSamples = [];
const idleSamples = [];
let coverageLost = false;
let fatalEventCount = 0;
let evidenceWriteError = null;
let metricBytes = 0, eventBytes = 0;
const evidenceBudgetBytes = 64 * 1024 * 1024;
let requestCount = 0;
let errorCount = 0;

// Ledger of durable writes acknowledged during the run
const durableLedger = {
  watched: [] // list of { profileId, videoId, video, watchedSeconds, durationSeconds }
};

// Workload operations counters (post-setup only)
const completedWorkloadOps = {
  browse: 0,
  nonEmptyBrowse: 0,
  impressions: 0,
  watch: 0,
  refresh: 0,
  switchProfile: 0
};

let inFlightFeedWork = 0;
let maxInFlightFeedWork = 0;
let cancelled = false;
let finalized = false;
let expectingServerExit = false;

function log(msg) { console.log(`[soak ${new Date().toISOString()}] ${msg}`); }

function recordEvent(event) {
  if (event.type === "exit" && !event.expected) fatalEventCount++;
  const full = { at: new Date().toISOString(), ...event };
  const line = JSON.stringify(full) + "\n";
  eventBytes += Buffer.byteLength(line);
  try { if (eventBytes > evidenceBudgetBytes) throw Error("Event evidence budget exhausted"); appendFileSync(eventsLogPath, line, "utf8"); } catch (error) { evidenceWriteError = String(error); }
}

function recordMetric(sample) {
  const line = JSON.stringify(sample) + "\n";
  metricBytes += Buffer.byteLength(line);
  try { if (metricBytes > evidenceBudgetBytes) throw Error("Metrics evidence budget exhausted"); appendFileSync(metricsLogPath, line, "utf8"); } catch (error) { evidenceWriteError = String(error); coverageLost = true; }
  recentSamples.push(sample);
  if (recentSamples.length > 200000) { recentSamples.shift(); coverageLost = true; }
  if (sample.op === "idle" || sample.phase === "idle") {
    idleSamples.push(sample);
    if (idleSamples.length > 200000) { idleSamples.shift(); coverageLost = true; }
  }
}

async function startServer() {
  if (!hasStandalone && (serverRootSpecified || !existsSync(path.join(repoRoot, ".next", "BUILD_ID")))) {
    recordEvent({ type: "missing-prerequisite", prerequisite: "Next production build" });
    return false;
  }
  serverGeneration++;
  port = 31000 + Math.floor(Math.random() * 20000);
  const env = buildChildEnv({
    dataDir: runRootObj.dataDir,
    logFile: runRootObj.logFile,
    configPath: runRootObj.configPath,
    mode: "deterministic"
  });
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";
  env.GRETEL_SOAK_BLOCKOUTBOUND = "1";
  env.GRETEL_API_TOKEN = "gretel_soak_synthetic_token_only_for_tests";
  env.GRETEL_SOAK_NETWORK_LOG = path.join(outputRoot, "logs", "network-guard.jsonl");
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${path.join(repoRoot, "tests/release/soak/network-guard.mjs")}`]
    .filter(Boolean).join(" ");
  env.HOME = runRootObj.homeDir;

  if (hasStandalone) {
    serverProcess = spawn(process.execPath, [path.join(serverRoot, "server.js")], {
      cwd: serverRoot, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32"
    });
  } else {
    serverProcess = spawn(process.execPath, [
      path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "start",
      "-p", String(port), "-H", "127.0.0.1"
    ], { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
  }

  recordEvent({type:"owned-server", pid:serverProcess.pid, port});
  serverProcess.on("error", (error) => recordEvent({
    type: "spawn-error", error: String(error).slice(0, 300)
  }));
  serverProcess.stdout.on("data", (d) => recordEvent({ type: "stdout", data: String(d).slice(0, 500) }));
  serverProcess.stderr.on("data", (d) => recordEvent({ type: "stderr", data: String(d).slice(0, 500) }));
  serverProcess.on("exit", (code, sig) => {
    recordEvent({ type: "exit", code, signal: sig, expected: expectingServerExit });
    expectingServerExit = false;
  });

  // Wait until server accepts connections
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (cancelled) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 307 || res.status < 500) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function stopServer() {
  if (!serverProcess) return null;
  const startedAt = Date.now();
  const childPid = serverProcess.pid;
  const alreadyExited = serverProcess.exitCode !== null || serverProcess.signalCode !== null;
  const exited = new Promise((resolve) => {
    if (alreadyExited) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), 5000);
    serverProcess.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
  expectingServerExit = !alreadyExited;
  try {
    if (process.platform !== "win32" && childPid) process.kill(-childPid, "SIGTERM");
    else serverProcess.kill("SIGTERM");
  } catch {}
  if (!(await exited)) {
    try {
      if (process.platform !== "win32" && childPid) process.kill(-childPid, "SIGKILL");
      else serverProcess.kill("SIGKILL");
    } catch {}
  }
  serverProcess = null;
  return Date.now() - startedAt;
}

async function api(pathname, init = {}, retries = 2) {
  const url = `http://127.0.0.1:${port}${pathname}`;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      requestCount++;
      const res = await fetch(url, {
        ...init,
        headers: {
          "x-gretel-token": "gretel_soak_synthetic_token_only_for_tests",
          "content-type": "application/json",
          ...(init.headers || {})
        },
        signal: AbortSignal.timeout(15000)
      });
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) { await sleep(500); continue; }
    }
  }
  throw lastErr;
}

// --- Cycle implementations (real app paths) ---
async function cycleBrowse(profileId, tags, channels) {
  inFlightFeedWork++;
  maxInFlightFeedWork = Math.max(maxInFlightFeedWork, inFlightFeedWork);
  try {
    const res = await api("/api/feed", {
      method: "POST",
      body: JSON.stringify({ profileId, tags, channels, channelSort: "mixed" })
    });
    let videos = [];
    if (res.ok) {
      completedWorkloadOps.browse++;
      const body = await res.json().catch(() => ({}));
      videos = Array.isArray(body.videos) ? body.videos.map((video) => video?.id).filter(Boolean) : [];
      if (videos.length > 0) completedWorkloadOps.nonEmptyBrowse++;
    } else if (res.status !== 404) {
      errorCount++;
    }
    return { status: res.status, videos };
  } finally {
    inFlightFeedWork--;
  }
}

async function cycleRefresh(profileId, tags, channels) {
  inFlightFeedWork++;
  maxInFlightFeedWork = Math.max(maxInFlightFeedWork, inFlightFeedWork);
  try {
    const res = await api("/api/feed/build", {
      method: "POST",
      body: JSON.stringify({ profileId, tags, channels, channelSort: "mixed", requestReason: "soak_refresh" })
    });
    let videos = [];
    if (res.ok) {
      completedWorkloadOps.refresh++;
      const body = await res.json().catch(() => ({}));
      videos = Array.isArray(body.videos) ? body.videos.map((video) => video?.id).filter(Boolean) : [];
    } else {
      errorCount++;
    }
    return { status: res.status, videos };
  } finally {
    inFlightFeedWork--;
  }
}

async function cycleImpressions(profileId, videoIds, tags, channels) {
  const res = await api("/api/impressions", {
    method: "POST",
    body: JSON.stringify({ profileId, videoIds, tags, channels })
  });
  if (res.ok) completedWorkloadOps.impressions++; else errorCount++;
  return res.status;
}

async function cycleWatch(profileId, video) {
  const res = await api("/api/watch-events", {
    method: "POST",
    body: JSON.stringify({
      profileId, video,
      watchedSeconds: 300, durationSeconds: 600
    })
  });
  if (res.ok) {
    completedWorkloadOps.watch++;
    const acknowledgedRow = readWatchedRow(profileId,video.id);
    if (!acknowledgedRow || acknowledgedRow.watched_seconds !== 300 || acknowledgedRow.duration_seconds !== 600 || acknowledgedRow.watched_ratio !== 0.5) throw Error("Acknowledged watch did not persist exact requested durations/ratio");
    const existing = durableLedger.watched.findIndex(x => x.profileId === profileId && x.videoId === video.id);
    if (existing >= 0) durableLedger.watched.splice(existing, 1);
    durableLedger.watched.push({
      profileId, videoId: video.id, video, watchedSeconds: 300, durationSeconds: 600, row:acknowledgedRow
    });
  } else {
    errorCount++;
  }
  return res.status;
}

async function cycleSwitchProfile() {
  const res = await api("/api/profiles");
  if (res.ok) completedWorkloadOps.switchProfile++; else errorCount++;
  return res.status;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--duration" || argv[i] === "--durationSec") out.durationSec = Number(argv[++i]);
    else if (argv[i] === "--interval" || argv[i] === "--intervalSec") out.intervalSec = Number(argv[++i]);
    else if (argv[i] === "--seed") out.seed = argv[++i];
    else if (argv[i] === "--output") out.output = argv[++i];
    else if (argv[i] === "--server-root") out.serverRoot = argv[++i];
    else if (argv[i] === "--artifact") out.artifact = argv[++i];
    else if (argv[i] === "--mode") out.mode = argv[++i];
    else if (argv[i] === "--strict") out.strict = true;
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- Sample process tree metrics (owned children only) ---
function sampleTreeMetrics(rootPid) {
  const out = { rssKb: 0, cpuTicks: 0, openFds: 0, threads: 0, children: 0, truncated: false, measurementError: null, identities: [] };
  const seen = new Set();
  const queue = [rootPid];
  const start = Date.now();
  while (queue.length && seen.size < 64 && Date.now() - start < 2000) {
    const pid = queue.shift();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const parts = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      out.identities.push(`${pid}:${parts[19]}`);
      out.cpuTicks += Number(parts[11]) + Number(parts[12]); // utime+stime
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const rss = /VmRSS:\s+(\d+)/.exec(status);
      if (rss) out.rssKb += Number(rss[1]); else throw Error("Missing RSS");
      const threads = /Threads:\s+(\d+)/.exec(status);
      if (threads) out.threads += Number(threads[1]);
      const fds = readdirSync(`/proc/${pid}/fd`);
      out.openFds += fds.length;
      const childrenRaw = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      for (const c of childrenRaw.split(/\s+/).filter(Boolean)) queue.push(Number(c));
      out.children = seen.size - 1;
    } catch (error) { out.measurementError = String(error); }
  }
  out.processIdentity = out.identities.sort().join(",");

  // Make truncation visible per review finding 2
  if (queue.length > 0) {
    out.truncated = true;
    recordEvent({ type: "process-sampling-truncated", pidsChecked: seen.size });
  }

  return out;
}

// --- Main soak loop ---
async function main() {
  const serverUp = await startServer();
  if (cancelled) return;
  cases.push(caseResult(
    "soak-server-start",
    "Production server starts in isolated data dir with deterministic env.",
    serverUp ? "pass" : "fail", 0, ["logs/events.jsonl"],
    serverUp ? null : "Server failed to start or respond"
  ));
  if (!serverUp) {
    await stopServer();
    try { safeRemove(outputRoot, runRootObj.runRoot); } catch (error) {
      recordEvent({ type: "cleanup-error", error: String(error) });
    }
    await finalize();
    return;
  }

  // Setup: create profiles via actual API (separate from workload cycles)
  const profiles = [];
  const tagsSets = [["soak-tag-a"], ["soak-tag-b", "soak-tag-c"], ["soak-tag-d"]];
  for (let i = 0; i < 3; i++) {
    const res = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: `Soak Profile ${i}`, tags: tagsSets[i], channels: [] })
    });
    if (res.ok) {
      const data = await res.json();
      profiles.push({ id: data.profileId, tags: tagsSets[i] });
    } else {
      errorCount++;
    }
  }
  cases.push(caseResult(
    "soak-profile-create",
    "Profiles created through actual /api/profiles route.",
    profiles.length === 3 ? "pass" : "fail", 0, ["logs/events.jsonl"],
    profiles.length === 3 ? null : `Only ${profiles.length} profiles created`
  ));

  const seededVideos = seedFeedPools(profiles);

  // Cycle plan with sustained idle windows
  const cyclePlan = ["browse", "impressions", "watch", "refresh", "idle", "switchProfile"];
  const end = Date.now() + durationMs;
  let cycleIdx = 0;
  let lastSample = null;

  while (!cancelled && Date.now() < end) {
    const op = cyclePlan[cycleIdx % cyclePlan.length];
    cycleIdx++;
    const prof = profiles[cycleIdx % Math.max(1, profiles.length)];
    if (!prof) break;

    let opStart = Date.now();
    try {
      if (op === "browse") {
        const result = await cycleBrowse(prof.id, prof.tags, []);
        if (result.videos.length) seededVideos[prof.id] = result.videos;
      } else if (op === "refresh") {
        const result = await cycleRefresh(prof.id, prof.tags, []);
        if (result.videos.length) seededVideos[prof.id] = result.videos;
      } else if (op === "impressions") {
        const vids = (seededVideos[prof.id] || []).slice(0, 2);
        if (vids.length) await cycleImpressions(prof.id, vids, prof.tags, []);
      } else if (op === "watch") {
        await cycleWatch(prof.id, syntheticVideo(`watch-${cycleIdx % 60}`));
      } else if (op === "switchProfile") {
        await cycleSwitchProfile();
      } else if (op === "idle") {
        await runIdlePhase({durationMs: Math.min(600000, end - Date.now()), intervalMs, phaseId: `idle-${cycleIdx}`, cancelled: () => cancelled,
          sample: phase => {
            if (!serverProcess?.pid) return;
            const m = sampleTreeMetrics(serverProcess.pid);
            recordMetric({...m, ...phase, elapsedMs: Date.now() - t0, serverPid: serverProcess.pid, serverGeneration, rssMb: m.rssKb / 1024});
          }
        });
      }
    } catch (e) {
      errorCount++;
      recordEvent({ type: "op-error", op, error: String(e).slice(0, 300) });
    }
    const opDuration = Date.now() - opStart;

    // Sample metrics every interval
    if (op !== "idle" && (!lastSample || Date.now() - lastSample >= intervalMs)) {
      lastSample = Date.now();
      if (serverProcess && serverProcess.pid) {
        const m = sampleTreeMetrics(serverProcess.pid);
        const sample = {
          at: new Date().toISOString(),
          elapsedMs: Date.now() - t0,
          op,
          phase: op === "idle" ? "idle" : "active",
          opDurationMs: opDuration,
          ...m,
          serverPid: serverProcess.pid,
          serverGeneration,
          rssMb: +(m.rssKb / 1024).toFixed(1),
          requestCount,
          errorCount,
          inFlightFeedWork
        };
        recordMetric(sample);
      }
    }
    if (op !== "idle") await sleep(Math.min(intervalMs, 1000));
  }

  if (cancelled) return;

  // --- Restart cycle: verify restart works and state persists ---
  const teardownMs = await stopServer();
  const restartOk = await startServer();
  cases.push(caseResult(
    "soak-restart",
    "Server restarts cleanly within 30s and serves requests after restart.",
    restartOk ? "pass" : "fail", 0, ["logs/events.jsonl"],
    restartOk ? null : "Restart failed"
  ));

  const networkGuard = readNetworkGuardLog();
  const guardReady = networkGuard.some((event) => event.type === "guard-ready");
  const guardEventsValid = networkGuard.every((event) => event.type === "guard-ready" || event.type === "blocked");
  const blockedRequests = networkGuard.filter((event) => event.type === "blocked").length;
  cases.push(caseResult(
    "soak-deterministic-network",
    "Deterministic mode blocks and records every non-loopback HTTP request from the production server.",
    guardReady && guardEventsValid ? "pass" : "fail", 0,
    ["logs/network-guard.jsonl"],
    guardReady && guardEventsValid
      ? `${blockedRequests} outbound request(s) blocked before network I/O`
      : "Network guard did not initialize or contained an unexpected event"
  ));

  cases.push(caseResult(
    "soak-refresh-fixture",
    "Refresh cycles use a deterministic external fixture or a production fixture seam.",
    "blocked", 0, ["logs/network-guard.jsonl"],
    "Unfinished soak tooling: the existing E2E provider fixture is not integrated into this workload; refresh attempts are network-denied"
  ));

  // Post-restart: verify durable history readable and matches acknowledged writes
  let historyOk = true;
  let historyFailureReason = null;
  if (durableLedger.watched.length === 0) {
    historyOk = false;
    historyFailureReason = "No durable watched writes were acknowledged before restart";
  } else {
    for (const prof of profiles) {
      const expectedForProfile = durableLedger.watched.filter((w) => w.profileId === prof.id);
      if (expectedForProfile.length === 0) continue;
      try {
        const res = await api(`/api/history?profileId=${encodeURIComponent(prof.id)}`);
        if (!res.ok) {
          historyOk = false;
          historyFailureReason = `History endpoint returned ${res.status} after restart for profile ${prof.id}`;
          break;
        }
        const data = await res.json().catch(() => ({}));
        const returnedVideos = Array.isArray(data.videos) ? data.videos : [];
        if (returnedVideos.length === 0) {
          historyOk = false;
          historyFailureReason = `History returned empty list for profile ${prof.id} despite ${expectedForProfile.length} acknowledged writes`;
          break;
        }
        const returnedIds = new Set(returnedVideos.map((v) => v.id));
        for (const expected of expectedForProfile) {
          const actual = returnedVideos.find(v => v.id === expected.videoId);
          if (!actual || ["title","author","duration","query"].some(key => actual[key] !== expected.video[key])) {
            historyOk = false;
            historyFailureReason = `Acknowledged video ${expected.videoId} missing from history after restart`;
            break;
          }
        }
        if (!historyOk) break;
      } catch (err) {
        historyOk = false;
        historyFailureReason = `Failed to query history after restart: ${err}`;
        break;
      }
    }
  }
  const durableResult = verifyAcknowledgedRows(durableLedger.watched, readWatchedRow);
  if (!durableResult.ok) {historyOk=false;historyFailureReason=durableResult.reason;}
  cases.push(caseResult(
    "soak-durable-history-post-restart",
    "Watched history remains readable via actual API after restart and matches acknowledged writes.",
    historyOk ? "pass" : "fail", 0, ["logs/events.jsonl"],
    historyFailureReason
  ));

  // Completed operations: require post-setup operations and nonempty feed results
  const totalWorkloadCycles = completedWorkloadOps.browse + completedWorkloadOps.watch +
    completedWorkloadOps.impressions + completedWorkloadOps.refresh + completedWorkloadOps.switchProfile;
  const workloadPassed = totalWorkloadCycles > 0 &&
    completedWorkloadOps.browse > 0 &&
    completedWorkloadOps.nonEmptyBrowse > 0 &&
    completedWorkloadOps.watch > 0;
  cases.push(caseResult(
    "soak-completed-operations",
    "Recorded completed post-setup HTTP operations during soak (browse/watch/impressions with nonempty feed).",
    workloadPassed ? "pass" : "fail", 0, ["logs/metrics.jsonl"],
    workloadPassed ? null : `Insufficient workload cycles: total=${totalWorkloadCycles}, browse=${completedWorkloadOps.browse}, nonEmptyBrowse=${completedWorkloadOps.nonEmptyBrowse}, watch=${completedWorkloadOps.watch}`
  ));

  // Concurrency and task drain gate
  cases.push(caseResult(
    "soak-feed-work-drained",
    "Equivalent feed work never overlaps and all expensive work drains before the next cycle.",
    "blocked", 0, ["logs/metrics.jsonl"],
    "Unfinished soak tooling: provider/task counters from the existing E2E fixture are not integrated into soak"
  ));

  // Unexpected crashes / fatal errors

  cases.push(caseResult(
    "soak-no-fatal-errors",
    "Zero unexpected crashes or unhandled fatal errors in owned app tree.",
    fatalEventCount === 0 ? "pass" : "fail", 0, ["logs/events.jsonl"],
    fatalEventCount === 0 ? null : `${fatalEventCount} fatal exit events`
  ));

  // Teardown within 5 sec
  cases.push(caseResult(
    "soak-teardown-bounded",
    "Server teardown (SIGTERM to owned child) completes within 5 seconds.",
    teardownMs !== null && teardownMs <= 5000 ? "pass" : "fail", 0, ["logs/events.jsonl"],
    teardownMs !== null && teardownMs <= 5000 ? null : `Teardown took ${teardownMs}ms`
  ));

  // Qualification duration gates
  const hasQualificationWindow = durationMs >= 20 * 60 * 1000;
  if (!hasQualificationWindow) {
    cases.push(caseResult(
      "soak-rss-trend",
      "Windowed RSS trend <= 1MiB/hour over >= 2h (requires qualification-duration run).",
      "not_run", 0, ["logs/metrics.jsonl"],
      "Short smoke run does not provide sufficient duration for trend evaluation"
    ));
    cases.push(caseResult(
      "soak-idle-rss-stability",
      "Final 10min median idle RSS <= post-warmup first 10min + max(64MiB, 20%) (requires >= 20min run).",
      "not_run", 0, ["logs/metrics.jsonl"],
      "Short smoke run does not provide sufficient duration"
    ));
    cases.push(caseResult(
      "soak-idle-cpu",
      "Idle CPU mean <= 2% of one core over 10min window (requires >= 20min run).",
      "not_run", 0, ["logs/metrics.jsonl"],
      "Short smoke run does not provide sufficient duration"
    ));
  } else {
    // 10-minute warmup: 0 to 600,000 ms
    const warmupMs = 10 * 60 * 1000;
    const {first:firstIdleWindow, last:finalIdleWindow} = selectIdleWindows(idleSamples.filter(s => s.phaseStart - t0 >= warmupMs));
    cases.push(evaluateIdleRssStability(firstIdleWindow, finalIdleWindow));
    if (coverageLost && recentSamples.length) recentSamples[0].coverageLost = true;
    cases.push(evaluateRssTrend(recentSamples, { minDurationMs: 2 * 60 * 60 * 1000 }));
    cases.push(evaluateIdleCpu(finalIdleWindow));
  }

  await stopServer();
  try { safeRemove(outputRoot, runRootObj.runRoot); } catch (e) {
    recordEvent({ type: "cleanup-error", error: String(e) });
  }

  await finalize();
}

function syntheticVideo(id) {
  return {
    id, title: `Soak watch video ${id}`, author: "Soak Channel",
    duration: "10:00", query: "soak-tag-a", similarityScore: 0.5,
    channelId: "UC-soak", channelKey: "soak channel"
  };
}

function seedFeedPools(profiles) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const dbPath = path.join(runRootObj.dataDir, "gretel.sqlite");
  const database = new Database(dbPath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS feed_pool_state (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      root_discovered_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_expanded_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, pool_key),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS feed_pool_nodes (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      video_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      video_json TEXT NOT NULL,
      parent_video_id TEXT,
      similarity_score REAL NOT NULL,
      parent_engagement_score REAL NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      served_count INTEGER NOT NULL DEFAULT 0,
      impression_count INTEGER NOT NULL DEFAULT 0,
      last_served_at INTEGER,
      PRIMARY KEY (profile_id, pool_key, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS feed_visited_videos (
      profile_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      video_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, pool_key, video_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `);
  ensureColumn(database, "feed_pool_state", "last_expanded_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "feed_pool_nodes", "impression_count", "INTEGER NOT NULL DEFAULT 0");
  const now = Date.now();
  const result = {};
  const insertState = database.prepare(`
    INSERT INTO feed_pool_state (profile_id, pool_key, root_discovered_at, updated_at, last_expanded_at)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(profile_id, pool_key) DO UPDATE SET updated_at = excluded.updated_at
  `);
  const insertNode = database.prepare(`
    INSERT OR REPLACE INTO feed_pool_nodes
      (profile_id, pool_key, video_id, node_id, video_json, parent_video_id,
       similarity_score, parent_engagement_score, first_seen_at, updated_at,
       served_count, impression_count, last_served_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, NULL)
  `);
  const insertVisited = database.prepare(`
    INSERT OR REPLACE INTO feed_visited_videos
      (profile_id, pool_key, video_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = database.transaction(() => {
    for (const profile of profiles) {
      const poolKey = createPoolKey(profile.tags, [], "mixed");
      insertState.run(profile.id, poolKey, now, now);
      const ids = [];
      for (let i = 0; i < 6; i++) {
        const id = `fixture-${profile.id.slice(0, 8)}-${i}`;
        const video = {
          id, title: `Soak fixture ${i}`, author: "Soak Fixture Channel",
          duration: "10:00", query: profile.tags[i % profile.tags.length], similarityScore: 0.9,
          engagementScore: 0.2, channelId: "UC-soak-fixture", channelKey: "soak fixture channel",
          sourceNodeId: "tagSearch"
        };
        const json = JSON.stringify(video);
        insertNode.run(profile.id, poolKey, id, "tagSearch", json, 0.9, 0.2, now, now);
        insertVisited.run(profile.id, poolKey, id, now, now);
        ids.push(id);
      }
      result[profile.id] = ids;
    }
  });
  transaction();
  database.close();
  return result;
}

function createPoolKey(tags, channels, channelSort) {
  const clean = (values) => values.map((value) => String(value).replace(/\s+/g, " ").trim().toLowerCase()).sort();
  return JSON.stringify({ tags: clean(tags), channels: clean(channels), channelSort });
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function readNetworkGuardLog() {
  const file = path.join(outputRoot, "logs", "network-guard.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function finalize() {
  if (finalized) return;
  finalized = true;
  const finishedAt = new Date().toISOString();
  const networkFile = path.join(outputRoot, "logs", "network-guard.jsonl");
  mkdirSync(path.dirname(networkFile), { recursive: true });
  if (!existsSync(networkFile)) writeFileSync(networkFile, "");

  const metricsHash = await streamHash(metricsLogPath);
  const eventsHash = await streamHash(eventsLogPath);

  if (evidenceWriteError) cases.push(caseResult("soak-evidence-write", "Incremental evidence remains complete within explicit 64MiB per-file budgets", "fail", 0, [], evidenceWriteError));
  const report = newReport(runId, mode, seed, cases, {
    startedAt, finishedAt,
    thresholds: {
      logFilesMax: 4, logTotalMaxMiB: 20,
      idleRssAllowanceMiB: 64, idleRssAllowancePct: 20,
      rssTrendMaxMiBPerHour: 1,
      idleCpuMeanMaxPct: 2, idleCpuP95MaxPct: 5,
      teardownMaxMs: 5000,
      defaultDisposableBudgetMiB: 512
    },
    artifactMetadata: {
      ...getArtifactIdentity(serverRoot),
      serverRoot: serverRoot,
      serverMode: hasStandalone ? "standalone" : "next-start",
      evidenceScope: "production-server",
      serverArtifactSha256: hashArtifact(serverRoot),
      packageVersion: readPackageVersion(),
      metricsFile: "logs/metrics.jsonl",
      metricsSha256: metricsHash,
      eventsFile: "logs/events.jsonl",
      eventsSha256: eventsHash,
      networkGuardFile: "logs/network-guard.jsonl"
    }
  });

  const reportPath = path.join(outputRoot, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const counts = summarize(report);
  log(`Soak complete: ${JSON.stringify(counts)}`);
  for (const c of cases) {
    log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id}${c.failureReason ? " — " + c.failureReason : ""}`);
  }

  const anyBad = counts.fail > 0 || counts.blocked > 0 || counts.not_run > 0;
  if (args.strict && anyBad) {
    process.exitCode = 1;
  } else if (counts.fail > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

function hashArtifact(root) {
  const artifact = hasStandalone ? path.join(root, "server.js") : path.join(root, ".next", "BUILD_ID");
  try { return crypto.createHash("sha256").update(readFileSync(artifact)).digest("hex"); } catch { return null; }
}

function readPackageVersion() {
  try { return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version || null; } catch { return null; }
}

async function handleCancellation(signal) {
  if (cancelled || finalized) return;
  cancelled = true;
  cases.push(caseResult(
    "soak-runner-cancelled",
    "Cancellation writes a report and tears down the owned server process tree.",
    "fail", 0, ["logs/events.jsonl"], `Runner cancelled by ${signal}`
  ));
  try { await stopServer(); } catch (error) {
    recordEvent({ type: "cleanup-error", error: String(error) });
  }
  try { safeRemove(outputRoot, runRootObj.runRoot); } catch (error) {
    recordEvent({ type: "cleanup-error", error: String(error) });
  }
  await finalize();
  process.exitCode = signal === "SIGINT" ? 130 : 143;
}

process.once("SIGTERM", () => { void handleCancellation("SIGTERM"); });
process.once("SIGINT", () => { void handleCancellation("SIGINT"); });

main().catch(async (e) => {
  console.error("Soak runner fatal:", e);
  recordEvent({ type: "runner-fatal", error: String(e) });
  try { await stopServer(); } catch {}
  try { safeRemove(outputRoot, runRootObj.runRoot); } catch {}
  await finalize();
  process.exitCode = 1;
});

async function streamHash(file) { const hash = crypto.createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }

function readWatchedRow(profileId, videoId) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(path.join(runRootObj.dataDir,"gretel.sqlite"),{readonly:true});
  try { return db.prepare("SELECT * FROM watched_videos WHERE profile_id = ? AND video_id = ?").get(profileId,videoId); } finally { db.close(); }
}
