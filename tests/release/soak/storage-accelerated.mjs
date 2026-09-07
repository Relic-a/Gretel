#!/usr/bin/env node
// storage-accelerated.mjs: Orchestrator for accelerated storage workload.
// Runs storage logic in an isolated child process (storage-worker.mjs) with
// an allowlisted environment and controlled stdin lifecycle.
// The orchestrator owns report creation, exit policy, timeout, and cleanup.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createIsolatedRunRoot } from "./env-isolation.mjs";
import { validateScratchRoot, safeRemove } from "./scrub-runner.mjs";
import { newReport, caseResult, strictExit, summarize } from "./report-schema.mjs";

export const STORAGE_DAYS_DEFAULT = 180;

/**
 * Run the accelerated storage workload via isolated child worker.
 * Returns a structured result with per-table counts and cases.
 */
export async function runAcceleratedStorage({
  days = STORAGE_DAYS_DEFAULT,
  profiles = 3,
  outputRoot,
  brokenRotation = false,
  timeoutMs = 180000
} = {}) {
  const started = Date.now();
  const runRootObj = createIsolatedRunRoot("gretel-soak-storage-orch-", outputRoot || os.tmpdir());
  const runRoot = runRootObj.runRoot;
  const resultFile = path.join(runRoot, `worker-result-${crypto.randomUUID()}.json`);

  const workerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "storage-worker.mjs");
  const workerArgs = [
    workerScript,
    "--days", String(days),
    "--profiles", String(profiles),
    "--output", runRoot,
    "--result-file", resultFile
  ];
  if (brokenRotation) {
    workerArgs.push("--simulate-broken-rotation");
  }

  // Filter allowlisted environment for child worker
  const childEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    HOME: runRootObj.homeDir,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8"
  };

  const child = spawn(process.execPath, workerArgs, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += String(d); });
  child.stderr.on("data", (d) => { stderr += String(d); });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const exitPromise = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  const { code, signal } = await exitPromise;

  // Verify worker exit and result file
  let workerResult = null;
  if (existsSync(resultFile)) {
    try {
      workerResult = JSON.parse(readFileSync(resultFile, "utf8"));
    } catch {}
  }

  const cases = [];

  if (timedOut) {
    cases.push(caseResult(
      "soak-storage-runner",
      "Accelerated storage workload completes within timeout.",
      "fail", Date.now() - started, [],
      `Storage worker timed out after ${timeoutMs}ms`
    ));
  } else if (code !== 0 || signal !== null || !workerResult) {
    const errorDetail = signal
      ? `Worker killed with signal ${signal}`
      : `Worker exited with code ${code}`;
    const stdErrSnippet = stderr.slice(-400).trim();
    cases.push(caseResult(
      "soak-storage-runner",
      "Accelerated storage workload worker completes without error.",
      "fail", Date.now() - started, [],
      `${errorDetail}${stdErrSnippet ? ` - stderr: ${stdErrSnippet}` : ""}`
    ));
  }

  if (workerResult && Array.isArray(workerResult.cases)) {
    cases.push(...workerResult.cases);
  }

  // Evidence snapshot handling
  const evidenceDir = path.join(runRoot, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const snapshot = workerResult?.snapshot || {};
  const snapshotFile = path.join(evidenceDir, "storage-snapshot.json");
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), "utf8");

  const durationMs = Date.now() - started;

  return {
    days,
    profiles,
    cases,
    before: workerResult?.before || {},
    after: workerResult?.after || {},
    snapshot,
    runRoot,
    evidenceDir,
    stdout,
    stderr,
    workerExitCode: code,
    workerSignal: signal,
    durationMs
  };
}

// CLI entrypoint
async function cli() {
  const argv = process.argv.slice(2);
  let days = STORAGE_DAYS_DEFAULT;
  let profiles = 3;
  let output = null;
  let strict = false;
  let brokenRotation = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days" || argv[i] === "--storage-days") days = Number(argv[++i]);
    else if (argv[i] === "--profiles") profiles = Number(argv[++i]);
    else if (argv[i] === "--output") output = argv[++i];
    else if (argv[i] === "--strict") strict = true;
    else if (argv[i] === "--simulate-broken-rotation") brokenRotation = true;
  }

  let outputRoot;
  if (output) {
    mkdirSync(output, { recursive: true });
    outputRoot = validateScratchRoot(output);
  } else {
    outputRoot = createIsolatedRunRoot("gretel-soak-storage-cli-").runRoot;
  }

  const runId = `soak-storage-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  console.log(`[storage-accelerated] Starting ${days}-day storage verification (strict: ${strict})...`);
  const result = await runAcceleratedStorage({ days, profiles, outputRoot, brokenRotation });

  // Materialize evidence snapshot into output/storage/storage-snapshot.json
  const storageDest = path.join(outputRoot, "storage");
  mkdirSync(storageDest, { recursive: true });
  writeFileSync(
    path.join(storageDest, "storage-snapshot.json"),
    JSON.stringify(result.snapshot, null, 2),
    "utf8"
  );

  const report = newReport(runId, "storage", "storage-seed", result.cases, {
    startedAt,
    thresholds: {
      logFilesMax: 4,
      logTotalMaxMiB: 20,
      logMaxRecordOvershootKiB: 16,
      metricsRetentionDays: 30,
      poolCapPolicy: "per profile/pool_key",
      defaultDisposableBudgetMiB: 512
    },
    artifactMetadata: {
      storageDir: "storage/",
      evidenceDir: "evidence/"
    }
  });

  const reportPath = path.join(outputRoot, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  const counts = summarize(report);
  console.log(`\n=== Storage Verification Summary ===`);
  console.log(`  pass: ${counts.pass}  fail: ${counts.fail}  blocked: ${counts.blocked}  not_run: ${counts.not_run}`);
  for (const c of result.cases) {
    console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id}${c.failureReason ? " — " + c.failureReason.slice(0, 140) : ""}`);
  }
  console.log(`Report: ${reportPath}`);

  // Safe cleanup of internal runner root
  try { safeRemove(outputRoot, result.runRoot); } catch {}

  const hasFailing = counts.fail > 0;
  const hasBlockedOrNotRun = counts.blocked > 0 || counts.not_run > 0;

  if (hasFailing || (strict && hasBlockedOrNotRun)) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((err) => {
    console.error("Storage CLI fatal:", err);
    process.exit(1);
  });
}
