#!/usr/bin/env node
// Self-contained entrypoint for the soak verification layer.
//
// Usage:
//   node tests/release/soak/run-soak-verification.mjs [options]
//
// Modes:
//   --storage-days N   accelerated storage workload length in simulated days
//                      (default 180; 365 optional)
//   --duration S       wall-clock soak seconds (quick smoke: 60-120; CI: 1800;
//                      qualification: 86400/172800)
//   --interval S       sampling interval seconds (default 5)
//   --seed S           deterministic seed
//   --output DIR       artifact output scratch directory (validated)
//   --strict           nonzero exit if any case fail/blocked/not_run
//   --skip-storage     skip accelerated storage workload
//   --skip-soak        skip wall-clock soak run
//   --storage-only     run only the accelerated storage workload
//   --simulate-broken-rotation test flag for negative rotation control

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runAcceleratedStorage } from "./storage-accelerated.mjs";
import { newReport, caseResult, strictExit, summarize } from "./report-schema.mjs";
import { getArtifactIdentity } from "../artifact-identity.mjs";
import { createIsolatedRunRoot } from "./env-isolation.mjs";
import { validateScratchRoot, safeRemove } from "./scrub-runner.mjs";

const argv = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const storageDays = Number(flag("--storage-days", 180));
const soakDuration = Number(flag("--duration", 60));
const interval = Number(flag("--interval", 5));
const seed = String(flag("--seed", "soak-" + crypto.randomUUID().slice(0, 6)));
const strict = argv.includes("--strict");
const skipStorage = argv.includes("--skip-storage");
const skipSoak = argv.includes("--skip-soak");
const storageOnly = argv.includes("--storage-only");
const brokenRotation = argv.includes("--simulate-broken-rotation");
const outputArg = flag("--output");
const serverRootArg = flag("--server-root") || flag("--artifact");

let outputRoot;
if (outputArg) {
  mkdirSync(String(outputArg), { recursive: true });
  outputRoot = validateScratchRoot(String(outputArg));
} else {
  outputRoot = createIsolatedRunRoot("gretel-soak-verify-").runRoot;
}

const runId = `soak-verify-${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
const startedTimestamp = Date.now();
const cases = [];
let soakArtifactMetadata = {};
let soakChildProcess = null;
let cancelled = false;

console.log(`[run-soak-verification] runId=${runId} seed=${seed} output=${outputRoot}`);
console.log(`  storageDays=${skipStorage ? "skipped" : storageDays} soakDuration=${skipSoak || storageOnly ? "skipped" : soakDuration}s strict=${strict}`);

// --- Accelerated storage workload ---
if (!skipStorage) {
  console.log(`\n[storage] Running accelerated ${storageDays}-day workload with 3 profiles...`);
  try {
    const result = await runAcceleratedStorage({
      days: storageDays,
      profiles: 3,
      outputRoot,
      brokenRotation
    });

    const storageCases = result.cases.map((item) => ({
      ...item,
      evidence: (item.evidence || []).map((entry) => entry === "logs/storage-snapshot.json"
        ? "storage/storage-snapshot.json" : entry)
    }));
    cases.push(...storageCases);

    // Copy sanitized snapshot into output/storage/
    const dest = path.join(outputRoot, "storage");
    mkdirSync(dest, { recursive: true });
    writeFileSync(
      path.join(dest, "storage-snapshot.json"),
      JSON.stringify(result.snapshot, null, 2),
      "utf8"
    );

    try { safeRemove(outputRoot, result.runRoot); } catch (cleanupError) {
      cases.push(caseResult(
        "soak-storage-cleanup",
        "Accelerated workload removes its owned scratch root after evidence is copied.",
        "fail", 0, [], String(cleanupError).slice(0, 300)
      ));
    }
    console.log(`[storage] done in ${result.durationMs}ms`);
  } catch (e) {
    cleanupStorageScratchChildren();
    cases.push(caseResult(
      "soak-storage-runner",
      "Accelerated storage workload completes without runner error.",
      "fail", 0, [], `Runner error: ${String(e).slice(0, 300)}`
    ));
    console.error("[storage] failed:", e);
  }
} else {
  cases.push(caseResult(
    "soak-storage-skipped",
    "Accelerated storage workload is executed before release qualification.",
    "not_run", 0, [], "Explicitly skipped with --skip-storage"
  ));
}

function cleanupStorageScratchChildren() {
  try {
    for (const name of readdirSync(outputRoot)) {
      if (!name.startsWith("gretel-soak-storage-")) continue;
      try { safeRemove(outputRoot, path.join(outputRoot, name)); } catch {}
    }
  } catch {}
}

// --- Wall-clock soak ---
if (!skipSoak && !storageOnly && !cancelled) {
  console.log(`\n[soak] Running wall-clock soak for ${soakDuration}s (smoke; qualification needs >=86400s)...`);
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "soak-cli.mjs");

  // Prevent stale report reuse: run soak CLI in its own isolated subfolder within outputRoot
  const soakOutDir = path.join(outputRoot, `soak-${runId}`);
  mkdirSync(soakOutDir, { recursive: true });

  const soakArgs = [
    cliPath,
    "--duration", String(soakDuration),
    "--interval", String(interval),
    "--seed", seed,
    "--output", soakOutDir
  ];
  if (serverRootArg) soakArgs.push("--server-root", String(serverRootArg));
  if (strict) soakArgs.push("--strict");

  const timeoutMs = (soakDuration + 180) * 1000;
  const soakExit = await new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (soakChildProcess) {
        try { soakChildProcess.kill("SIGKILL"); } catch {}
      }
    }, timeoutMs);

    soakChildProcess = spawn(process.execPath, soakArgs, {
      cwd: process.cwd(),
      stdio: "inherit"
    });

    soakChildProcess.on("close", (code, signal) => {
      clearTimeout(timer);
      soakChildProcess = null;
      resolve({ code, signal, timedOut });
    });
  });

  const soakReportPath = path.join(soakOutDir, "report.json");
  let soakReport = null;

  if (existsSync(soakReportPath)) {
    try {
      const parsed = JSON.parse(readFileSync(soakReportPath, "utf8"));
      // Reject stale reports or mismatched identities
      const reportStarted = new Date(parsed.startedAt || 0).getTime();
      if (reportStarted >= startedTimestamp - 5000 && parsed.schemaVersion === 1) {
        soakReport = parsed;
      } else {
        cases.push(caseResult(
          "soak-report-stale",
          "Soak CLI report is fresh and matches current execution identity.",
          "fail", 0, [],
          `Report rejected as stale or invalid: startedAt=${parsed.startedAt} vs runStartedAt=${startedAt}`
        ));
      }
    } catch (parseErr) {
      cases.push(caseResult(
        "soak-report-schema",
        "Soak CLI produces valid JSON report.",
        "fail", 0, [],
        `Failed to parse soak report JSON: ${String(parseErr).slice(0, 200)}`
      ));
    }
  }

  if (soakExit.timedOut) {
    cases.push(caseResult(
      "soak-soak-runner",
      "Soak CLI completes within timeout.",
      "fail", 0, [],
      `Soak CLI timed out after ${timeoutMs}ms`
    ));
  } else if (soakExit.code !== 0 || soakExit.signal !== null) {
    cases.push(caseResult(
      "soak-soak-runner",
      "Soak CLI runs without error.",
      "fail", 0, [],
      `Soak CLI exited with code ${soakExit.code}${soakExit.signal ? ` (signal ${soakExit.signal})` : ""}`
    ));
  }

  if (soakReport) {
    // Validate required case inventory
    const requiredCaseIds = [
      "soak-server-start",
      "soak-profile-create",
      "soak-restart",
      "soak-deterministic-network",
      "soak-durable-history-post-restart",
      "soak-completed-operations",
      "soak-no-fatal-errors",
      "soak-teardown-bounded"
    ];
    const reportedIds = new Set((soakReport.cases || []).map((c) => c.id));
    const missingIds = requiredCaseIds.filter((id) => !reportedIds.has(id));

    if (missingIds.length > 0) {
      cases.push(caseResult(
        "soak-report-completeness",
        "Soak CLI report contains all required release verification cases.",
        "fail", 0, [],
        `Missing required cases in report: ${missingIds.join(", ")}`
      ));
    }

    if (soakReport.cases) {
      cases.push(...soakReport.cases);
    }
    soakArtifactMetadata = soakReport.artifactMetadata || {};

    // Copy logs into outputRoot/logs
    const subLogsDir = path.join(soakOutDir, "logs");
    if (existsSync(subLogsDir)) {
      const targetLogsDir = path.join(outputRoot, "logs");
      mkdirSync(targetLogsDir, { recursive: true });
      for (const name of readdirSync(subLogsDir)) {
        try {
          writeFileSync(
            path.join(targetLogsDir, name),
            readFileSync(path.join(subLogsDir, name))
          );
        } catch {}
      }
    }
  } else if (!soakExit.timedOut && soakExit.code === 0) {
    cases.push(caseResult(
      "soak-report-missing",
      "Soak CLI writes report.json upon successful completion.",
      "fail", 0, [],
      "Report file was missing after soak CLI finished"
    ));
  }
} else if (storageOnly) {
  cases.push(caseResult(
    "soak-wall-clock-skipped",
    "Wall-clock production-server soak is executed before release qualification.",
    "not_run", 0, [], "Explicitly skipped with --storage-only"
  ));
} else if (skipSoak) {
  cases.push(caseResult(
    "soak-wall-clock-skipped",
    "Wall-clock production-server soak is executed before release qualification.",
    "not_run", 0, [], "Explicitly skipped with --skip-soak"
  ));
}

// --- Final report ---
const report = newReport(
  runId,
  storageOnly ? "storage" : (soakDuration <= 120 ? "quick-smoke" : "soak"),
  seed,
  cases,
  {
    startedAt,
    thresholds: {
      logFilesMax: 4, logTotalMaxMiB: 20,
      logMaxRecordOvershootKiB: 16,
      metricsRetentionDays: 30,
      poolCapPolicy: "per profile/pool_key",
      idleRssAllowanceMiB: 64, idleRssAllowancePct: 20,
      rssTrendMaxMiBPerHour: 1, rssTrendMinHours: 2,
      idleCpuMeanMaxPct: 2, idleCpuP95MaxPct: 5,
      teardownMaxMs: 5000,
      defaultDisposableBudgetMiB: 512
    },
    artifactMetadata: {
      reportPath: path.join(outputRoot, "report.json"),
      storageDir: "storage/",
      logsDir: "logs/",
      ...getArtifactIdentity(path.join(process.cwd(), ".next/standalone")),
      ...soakArtifactMetadata,
      packageVersion: soakArtifactMetadata.packageVersion || readPackageVersion()
    }
  }
);

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
const counts = summarize(report);
console.log(`\n=== Soak verification summary ===`);
console.log(`  pass: ${counts.pass}  fail: ${counts.fail}  blocked: ${counts.blocked}  not_run: ${counts.not_run}`);
for (const c of cases) {
  console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id}${c.failureReason ? " — " + c.failureReason.slice(0, 140) : ""}`);
}
console.log(`Report: ${path.join(outputRoot, "report.json")}`);

const anyBad = counts.fail > 0 || counts.blocked > 0 || counts.not_run > 0;
if (strict && anyBad) {
  process.exitCode = 1;
} else if (counts.fail > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}

// Cleanup cancellation handling
async function handleCancellation(signal) {
  if (cancelled) return;
  cancelled = true;
  console.log(`\n[run-soak-verification] Received ${signal}; stopping children...`);
  if (soakChildProcess) {
    try {
      soakChildProcess.kill("SIGTERM");
      setTimeout(() => {
        try { soakChildProcess?.kill("SIGKILL"); } catch {}
      }, 5000);
    } catch {}
  }
  process.exitCode = signal === "SIGINT" ? 130 : 143;
}

process.once("SIGINT", () => { void handleCancellation("SIGINT"); });
process.once("SIGTERM", () => { void handleCancellation("SIGTERM"); });
