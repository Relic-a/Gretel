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

import { runAcceleratedStorage } from "./storage-accelerated.mjs";
import { newReport, caseResult, strictExit, summarize } from "./report-schema.mjs";
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
const cases = [];
let soakArtifactMetadata = {};

console.log(`[run-soak-verification] runId=${runId} seed=${seed} output=${outputRoot}`);
console.log(`  storageDays=${skipStorage ? "skipped" : storageDays} soakDuration=${skipSoak ? "skipped" : soakDuration}s strict=${strict}`);

// --- Accelerated storage workload ---
if (!skipStorage) {
  console.log(`\n[storage] Running accelerated ${storageDays}-day workload with 3 profiles...`);
  try {
    const result = await runAcceleratedStorage({ days: storageDays, profiles: 3, outputRoot });
    const storageCases = result.cases.map((item) => ({
      ...item,
      evidence: item.evidence.map((entry) => entry === "logs/storage-snapshot.json"
        ? "storage/storage-snapshot.json" : entry)
    }));
    cases.push(...storageCases);
    // Copy sanitized evidence into output
    const dest = path.join(outputRoot, "storage");
    mkdirSync(dest, { recursive: true });
    // Merge in the full sanitized snapshot (pool key counts, log bounds,
    // file fixture counts) from the storage runner's own evidence file.
    let extraSnap = {};
    try {
      const { readFileSync } = await import("node:fs");
      extraSnap = JSON.parse(readFileSync(path.join(result.evidenceDir, "storage-snapshot.json"), "utf8"));
    } catch {}
    writeFileSync(path.join(dest, "storage-snapshot.json"),
      JSON.stringify({
        days: result.days, profiles: result.profiles,
        poolSizeCap: extraSnap.poolSizeCap,
        poolKeysSeen: extraSnap.poolKeysSeen,
        embeddingModelKeys: extraSnap.embeddingModelKeys,
        durableCounts: extraSnap.durableCounts,
        durableBaseline: extraSnap.durableBaseline,
        durableAfter: extraSnap.durableAfter,
        logFiles: extraSnap.logFiles, logTotalBytes: extraSnap.logTotalBytes,
        logOvershootBytes: extraSnap.logOvershootBytes,
        staleFilesCount: extraSnap.staleFilesCount, freshFilesCount: extraSnap.freshFilesCount,
        disposableBytes: extraSnap.disposableBytes,
        disposableBudgetBytes: extraSnap.disposableBudgetBytes,
        before: result.before, after: result.after,
        cases: result.cases
      }, null, 2));
    // The workload scratch root is nested below the validated report root and
    // can be removed after its sanitized snapshot is copied.
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
}
else {
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
if (!skipSoak && !storageOnly) {
  console.log(`\n[soak] Running wall-clock soak for ${soakDuration}s (smoke; qualification needs >=86400s)...`);
  const { spawnSync } = await import("node:child_process");
  const cliPath = path.join(import.meta.dirname, "soak-cli.mjs");
  const soakArgs = [
    cliPath,
    "--duration", String(soakDuration),
    "--interval", String(interval),
    "--seed", seed,
    "--output", outputRoot
  ];
  if (serverRootArg) soakArgs.push("--server-root", String(serverRootArg));
  const r = spawnSync(process.execPath, soakArgs, { cwd: process.cwd(), encoding: "utf8", stdio: "inherit", timeout: (soakDuration + 180) * 1000 });
  // Soak CLI writes its own report.json; merge its cases
  try {
    const soakReport = JSON.parse(
      (await import("node:fs")).readFileSync(path.join(outputRoot, "report.json"), "utf8")
    );
    if (soakReport.cases) cases.push(...soakReport.cases);
    soakArtifactMetadata = soakReport.artifactMetadata || {};
  } catch {}
  if (r.error) {
    cases.push(caseResult("soak-soak-runner", "Soak CLI runs without error.", "fail", 0, [], String(r.error)));
  }
}
else {
  cases.push(caseResult(
    "soak-wall-clock-skipped",
    "Wall-clock production-server soak is executed before release qualification.",
    "not_run", 0, [], storageOnly ? "Explicitly skipped with --storage-only" : "Explicitly skipped with --skip-soak"
  ));
}

// --- Final report ---
const report = newReport(runId, storageOnly ? "storage" : (soakDuration <= 120 ? "quick-smoke" : "soak"),
  seed, cases, {
    startedAt,
    thresholds: {
      logFilesMax: 4, logTotalMaxMiB: 20,
      logMaxRecordOvershootKiB: 16,
      metricsRetentionDays: 30,
      poolCapPolicy: "per profile/pool_key (documented gap: stale keys unbounded)",
      staleKeyPolicyRequired: true,
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
      ...soakArtifactMetadata,
      packageVersion: soakArtifactMetadata.packageVersion || readPackageVersion()
    }
});

function readPackageVersion() {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version || null; }
  catch { return null; }
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
if (strict && anyBad) process.exitCode = 1;
else if (counts.fail > 0 || counts.blocked > 0) process.exitCode = 1;
