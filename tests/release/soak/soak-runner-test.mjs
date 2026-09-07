// soak-runner-test.mjs: Tests failure propagation, stale report prevention,
// worker crash handling, and process shutdown in the soak layer.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createIsolatedRunRoot } from "./env-isolation.mjs";
import { newReport, caseResult } from "./report-schema.mjs";

const repoRoot = process.cwd();
const runSoakScript = path.join(repoRoot, "tests", "release", "soak", "run-soak-verification.mjs");
const storageScript = path.join(repoRoot, "tests", "release", "soak", "storage-accelerated.mjs");

console.log("[soak-runner-test] Running failure propagation and runner tests...");

// 1. Reusing an output directory with an earlier passing report:
// An earlier passing report is seeded in the output directory.
// A broken run (e.g. invalid server root) is executed into that directory.
// The runner MUST NOT consume the earlier passing report as current evidence!
{
  const out = createIsolatedRunRoot("gretel-test-stale-");
  const oldPassingReport = newReport("old-run-123", "quick", "seed-old", [
    caseResult("soak-server-start", "server starts", "pass", 100, []),
    caseResult("soak-profile-create", "profile created", "pass", 100, [])
  ], {
    startedAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  });
  writeFileSync(path.join(out.runRoot, "report.json"), JSON.stringify(oldPassingReport, null, 2), "utf8");

  // Run with an invalid server root so the soak child fails
  const res = spawnSync(process.execPath, [
    runSoakScript,
    "--skip-storage",
    "--duration", "10",
    "--server-root", path.join(out.runRoot, "nonexistent-server"),
    "--output", out.runRoot,
    "--strict"
  ], { cwd: repoRoot, timeout: 120000, encoding: "utf8" });

  assert.notEqual(res.status, 0, "Wrapper must exit nonzero when child runner fails");
  const finalReport = JSON.parse(readFileSync(path.join(out.runRoot, "report.json"), "utf8"));
  assert.notEqual(finalReport.runId, "old-run-123", "Runner must not consume stale report from earlier run");
  assert.ok(
    finalReport.cases.some((c) => c.status === "fail" || c.status === "blocked"),
    "Final report must reflect current failure/blocked state, not stale pass"
  );
  console.log("✔ Stale report in reused directory is rejected and not consumed as current evidence");
}

// 2. Storage runner with stdin closed (< /dev/null) propagates failure exit code
{
  const out = createIsolatedRunRoot("gretel-test-storage-stdin-");
  const res = spawnSync(process.execPath, [
    storageScript,
    "--days", "14",
    "--output", out.runRoot,
    "--strict", "--simulate-broken-rotation"
  ], {
    cwd: repoRoot,
    timeout: 120000, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"] // stdin closed (/dev/null)
  });

  assert.equal(res.status, 1, `Storage runner with stdin closed must exit 1 on failure, got ${res.status}`);
  const report = JSON.parse(readFileSync(path.join(out.runRoot, "report.json"), "utf8"));
  assert.ok(report.cases.some((c) => c.id === "soak-storage-log-bounds" && c.status === "fail"), "Dedicated no-op logger criterion fails");
  console.log("✔ Storage runner with closed stdin propagates exit code 1 reliably without EOF exit(0) hijack");
}

// 3. Simulated broken rotation fails log bounds
{
  const out = createIsolatedRunRoot("gretel-test-rot-");
  const res = spawnSync(process.execPath, [
    storageScript,
    "--days", "14",
    "--output", out.runRoot,
    "--simulate-broken-rotation"
  ], { cwd: repoRoot, timeout: 120000, encoding: "utf8" });

  assert.equal(res.status, 1, "Simulated broken rotation must exit 1");
  const report = JSON.parse(readFileSync(path.join(out.runRoot, "report.json"), "utf8"));
  const logCase = report.cases.find((c) => c.id === "soak-storage-log-bounds");
  assert.ok(logCase, "Log bounds case must exist");
  assert.equal(logCase.status, "fail", "Log bounds case must fail under broken rotation");
  console.log("✔ Broken rotation fixture is caught by soak-storage-log-bounds");
}

// 4. Zero duration is rejected with nonzero exit
{
  const out = createIsolatedRunRoot("gretel-test-zero-");
  const res = spawnSync(process.execPath, [
    path.join(repoRoot, "tests", "release", "soak", "soak-cli.mjs"),
    "--duration", "0",
    "--output", out.runRoot
  ], { cwd: repoRoot, timeout: 120000, encoding: "utf8" });

  assert.notEqual(res.status, 0, "CLI must reject zero duration with nonzero exit code");
  console.log("✔ Zero duration argument is rejected with nonzero exit code");
}

console.log("\nAll soak runner negative controls and failure propagation tests passed!");
