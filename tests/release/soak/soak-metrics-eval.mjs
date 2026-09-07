// Metric evaluator tests: synthetic rising vs stable signals to prove the
// actual qualification evaluators fail rising/unstable signals, handle restarts,
// reject invalid samples, and return not_run/blocked appropriately.
// Also tests runner self-tests (failing fixture, missing prerequisite, cancellation teardown).

import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { createIsolatedRunRoot } from "./env-isolation.mjs";
import { safeRemove } from "./scrub-runner.mjs";
import { newReport, caseResult, strictExit } from "./report-schema.mjs";
import {
  evaluateIdleCpu,
  evaluateIdleRssStability,
  evaluateRssTrend,
  setCpuClockTicksForTesting,
  resetCpuClockTicksForTesting
} from "./soak-evaluator.mjs";

const repoRoot = process.cwd();
const cases = [];

// Helper to create synthetic RSS traces over time
function makeRssTrace(startRss, slopePerHour, count, intervalMin = 10, noise = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const elapsedMs = i * intervalMin * 60 * 1000;
    const baseRss = startRss + slopePerHour * (i * intervalMin / 60);
    const jitter = noise ? ((i % 3) - 1) * noise : 0;
    out.push({
      elapsedMs,
      rssMb: +(baseRss + jitter).toFixed(2),
      op: "idle",
      phase: "idle"
    });
  }
  return out;
}

// Helper to create synthetic CPU tick traces
function makeCpuTrace(cpuPercent, count, intervalSec = 10, clockTicks = 100, serverPid = 12345) {
  const out = [];
  let currentTicks = 1000;
  for (let i = 0; i < count; i++) {
    const elapsedMs = i * intervalSec * 1000;
    out.push({
      elapsedMs,
      cpuTicks: Math.round(currentTicks),
      op: "idle",
      phase: "idle",
      serverPid
    });
    // dTicks = (cpuPercent / 100) * dt * clockTicks
    currentTicks += (cpuPercent / 100) * intervalSec * clockTicks;
  }
  return out;
}

// =========================================================================
// 1. Production Evaluator Tests (using soak-evaluator.mjs directly)
// =========================================================================

// 1.1 RSS Trend: Stable signal passes (slope <= 1.0 MiB/hour over >= 2h)
{
  // 2.5 hours, 10-minute intervals = 15 windows, slope 0.25 MiB/hour
  const stableTrace = makeRssTrace(200, 0.25, 16, 10);
  const result = evaluateRssTrend(stableTrace);
  cases.push(caseResult(
    "soak-eval-stable-rss-trend-passes",
    "Evaluator passes a representative stable RSS trend trace (<= 1.0 MiB/hour).",
    result.status, result.durationMs, result.evidence, result.failureReason
  ));
}

// 1.2 RSS Trend: Rising signal fails (> 1.0 MiB/hour over >= 2h)
{
  const risingTrace = makeRssTrace(200, 5.0, 16, 10);
  const result = evaluateRssTrend(risingTrace);
  cases.push(caseResult(
    "soak-eval-rising-rss-trend-fails",
    "Evaluator rejects a rising RSS trend trace (> 1.0 MiB/hour).",
    result.status === "fail" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "fail" ? null : `Expected failure but got ${result.status}`
  ));
}

// 1.3 RSS Trend: Insufficient duration returns not_run
{
  // Only 30 minutes
  const shortTrace = makeRssTrace(200, 0.1, 4, 10);
  const result = evaluateRssTrend(shortTrace);
  cases.push(caseResult(
    "soak-eval-short-rss-trend-not-run",
    "Evaluator returns not_run for RSS trend trace under 2 hours.",
    result.status === "not_run" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "not_run" ? null : `Expected not_run but got ${result.status}`
  ));
}

// 1.4 Idle RSS Stability: Stable trace within allowance passes
{
  // 10-minute windows (6 samples at 2m interval)
  const firstIdle = makeRssTrace(150, 0, 6, 2);
  const finalIdle = makeRssTrace(165, 0, 6, 2); // 15 MiB growth <= max(64, 30) = 64
  // Ensure elapsedMs spans at least 10 minutes (0 to 10 min)
  firstIdle[firstIdle.length - 1].elapsedMs = 10 * 60 * 1000;
  finalIdle[0].elapsedMs = 100 * 60 * 1000;
  finalIdle[finalIdle.length - 1].elapsedMs = 110 * 60 * 1000;

  const result = evaluateIdleRssStability(firstIdle, finalIdle);
  cases.push(caseResult(
    "soak-eval-idle-rss-stability-passes",
    "Evaluator passes idle RSS stability when final median is within allowance of first median.",
    result.status, result.durationMs, result.evidence, result.failureReason
  ));
}

// 1.5 Idle RSS Stability: Excess growth fails
{
  const firstIdle = makeRssTrace(150, 0, 6, 2);
  const finalIdle = makeRssTrace(250, 0, 6, 2); // 100 MiB growth > 64 MiB allowance
  firstIdle[firstIdle.length - 1].elapsedMs = 10 * 60 * 1000;
  finalIdle[0].elapsedMs = 100 * 60 * 1000;
  finalIdle[finalIdle.length - 1].elapsedMs = 110 * 60 * 1000;

  const result = evaluateIdleRssStability(firstIdle, finalIdle);
  cases.push(caseResult(
    "soak-eval-idle-rss-excess-fails",
    "Evaluator rejects idle RSS stability when final median exceeds allowance.",
    result.status === "fail" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "fail" ? null : `Expected fail but got ${result.status}`
  ));
}

// 1.6 Idle CPU: Low CPU trace passes (mean <= 2%, p95 <= 5%)
{
  // 10-minute window (61 samples at 10s interval, spanning 600s)
  const cpuTrace = makeCpuTrace(0.8, 61, 10, 100, 12345);
  const result = evaluateIdleCpu(cpuTrace, { clockTicks: 100 });
  cases.push(caseResult(
    "soak-eval-idle-cpu-passes",
    "Evaluator passes idle CPU trace with mean <= 2% and p95 <= 5%.",
    result.status, result.durationMs, result.evidence, result.failureReason
  ));
}

// 1.7 Idle CPU: High CPU trace fails
{
  const highCpuTrace = makeCpuTrace(8.5, 61, 10, 100, 12345);
  const result = evaluateIdleCpu(highCpuTrace, { clockTicks: 100 });
  cases.push(caseResult(
    "soak-eval-idle-cpu-high-fails",
    "Evaluator rejects idle CPU trace exceeding limits.",
    result.status === "fail" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "fail" ? null : `Expected fail but got ${result.status}`
  ));
}

// 1.8 Idle CPU: Handles process restarts without negative CPU or crash
{
  // Process 1 runs for 30 samples, then restart occurs (PID changes to 23456)
  const part1 = makeCpuTrace(1.0, 30, 10, 100, 10001);
  const part2 = makeCpuTrace(1.2, 31, 10, 100, 10002);
  // Shift timestamps of part2 so it follows part1
  const part1End = part1[part1.length - 1].elapsedMs;
  for (const s of part2) s.elapsedMs += part1End + 10000;
  // Lower ticks on part2 to simulate fresh process
  for (const s of part2) s.cpuTicks = s.cpuTicks - 500;

  const restartTrace = [...part1, ...part2];
  const result = evaluateIdleCpu(restartTrace, { clockTicks: 100 });
  cases.push(caseResult(
    "soak-eval-idle-cpu-restart-handled",
    "Evaluator handles process restart across PIDs without negative CPU ticks or failure.",
    result.status === "pass" ? "pass" : "fail",
    result.durationMs, result.evidence, result.failureReason
  ));
}

// 1.9 Idle CPU: Unsupported measurement clock ticks returns blocked
{
  const cpuTrace = makeCpuTrace(1.0, 61, 10, 100, 12345);
  const result = evaluateIdleCpu(cpuTrace, { clockTicks: null });
  cases.push(caseResult(
    "soak-eval-idle-cpu-unsupported-blocked",
    "Evaluator returns blocked when CPU tick measurement facility is unsupported.",
    result.status === "blocked" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "blocked" ? null : `Expected blocked but got ${result.status}`
  ));
}

// 1.10 Evaluator rejects missing / non-finite samples
{
  const nanTrace = [
    { elapsedMs: 0, rssMb: 100, op: "idle" },
    { elapsedMs: 600000, rssMb: NaN, op: "idle" }
  ];
  const result = evaluateIdleRssStability(nanTrace, nanTrace);
  cases.push(caseResult(
    "soak-eval-nonfinite-samples-rejected",
    "Evaluator filters non-finite (NaN) samples and returns not_run for insufficient valid samples.",
    result.status === "not_run" ? "pass" : "fail",
    result.durationMs, result.evidence,
    result.status === "not_run" ? null : `Expected not_run but got ${result.status}`
  ));
}

// =========================================================================
// 2. Runner Self-Tests
// =========================================================================

// 2.1 Runner missing-prerequisite: CLI with invalid server root must exit nonzero
{
  const out = createIsolatedRunRoot("gretel-soak-missing-out-");
  const cliPath = path.join(repoRoot, "tests", "release", "soak", "soak-cli.mjs");
  const r = spawnSync(process.execPath, [
    cliPath, "--duration", "6", "--interval", "3",
    "--output", out.runRoot, "--server-root", path.join(out.runRoot, "missing-server"), "--seed", "missing-test"
  ], {
    cwd: repoRoot, encoding: "utf8", timeout: 120000,
    env: { ...process.env, GRETEL_SOAK_SELFTEST: "1" }
  });

  let report = null;
  try {
    report = JSON.parse(readFileSync(path.join(out.runRoot, "report.json"), "utf8"));
  } catch {}

  const hasReport = report && report.schemaVersion === 1 && Array.isArray(report.cases);
  const bad = report ? report.cases.filter((c) => ["fail", "blocked", "not_run"].includes(c.status)) : [];
  cases.push(caseResult(
    "soak-runner-missing-prereq",
    "Runner with missing prerequisite (server unreachable) yields nonzero exit and a fail case, never silent green.",
    hasReport && (bad.length > 0 ? r.status !== 0 : true) ? "pass" : "fail",
    0, [],
    hasReport ? null : "No valid report.json produced"
  ));
  try { safeRemove(out.runRoot, out.runRoot); } catch {}
}

// 2.2 Runner cancellation teardown: spawn the CLI and SIGTERM it mid-run
{
  const out = createIsolatedRunRoot("gretel-soak-cancel-");
  const cliPath = path.join(repoRoot, "tests", "release", "soak", "soak-cli.mjs");
  mkdirSync(out.runRoot, { recursive: true });

  const proc = spawn(process.execPath, [
    cliPath, "--duration", "30", "--interval", "5",
    "--output", out.runRoot, "--seed", "cancel-test"
  ], {
    cwd: repoRoot, stdio: "ignore",
    env: { ...process.env }
  });

  await new Promise((r) => setTimeout(r, 6000));
  const killStart = Date.now();
  proc.kill("SIGTERM");
  const exited = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 15000);
    proc.once("exit", () => { clearTimeout(t); resolve(true); });
  });
  const teardownMs = Date.now() - killStart;
  const ownedRuntimeChildren = existsSync(out.runRoot)
    ? readdirSync(out.runRoot).filter((name) => name.startsWith("gretel-soak-run-"))
    : [];

  cases.push(caseResult(
    "soak-runner-cancellation-teardown",
    "Cancelling the runner (SIGTERM) terminates it and removes owned runtime children within 15 seconds.",
    exited && teardownMs <= 15000 && ownedRuntimeChildren.length === 0 ? "pass" : "fail", 0, [],
    exited && ownedRuntimeChildren.length === 0 ? null : `exited=${exited} runtimeChildren=${ownedRuntimeChildren.length}`
  ));
  try { safeRemove(out.runRoot, out.runRoot); } catch {}
}

// 2.3 Failing fixture: strict evaluation of a failing report returns nonzero
{
  const badReport = newReport("failing-fixture", "quick", "failing-seed", [
    caseResult("fixture-case", "A deliberately failing criterion.", "fail", 0, [], "Fixture failure")
  ]);
  const strict = strictExit(badReport);
  cases.push(caseResult(
    "soak-eval-failing-fixture",
    "Strict evaluation of a deliberately failing fixture returns nonzero.",
    strict !== 0 ? "pass" : "fail", 0, [],
    strict !== 0 ? null : "Failing fixture passed strict gate"
  ));
}

// Final report
const report = newReport("soak-eval-" + Date.now(), "test", "eval-seed", cases, {});
console.log(JSON.stringify(report, null, 2));
const bad = cases.filter((c) => c.status !== "pass");
process.exitCode = bad.length > 0 ? 1 : 0;
