#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const adapter = path.join(repoRoot, "tests/release/e2e/native-adapter.mjs");
const mockRunner = path.join(repoRoot, "tests/release/e2e/fixtures/mock-native-runner.mjs");
const failingRunner = path.join(repoRoot, "tests/release/e2e/fixtures/failing-native-runner.mjs");
const staleRunner = path.join(repoRoot, "tests/release/e2e/fixtures/stale-native-runner.mjs");

const scratchRoot = mkdtempSync(path.join(tmpdir(), "gretel-native-adapter-test-"));
const oldArtifact = path.join(scratchRoot, "gretel_0.5.2_amd64.deb");
const newArtifact = path.join(scratchRoot, "gretel_0.5.3_amd64.deb");
writeFileSync(oldArtifact, "fake-old-deb-content-0.5.2\n");
writeFileSync(newArtifact, "fake-new-deb-content-0.5.3\n");

function runAdapter(args = []) {
  const outputDir = mkdtempSync(path.join(scratchRoot, "out-"));
  const res = spawnSync(process.execPath, [adapter, ...args, "--output", outputDir], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  let report = null;
  const reportPath = path.join(outputDir, "report.json");
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {}
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, report, outputDir };
}

try {
  console.log("[native-adapter-test] Running protocol validation tests...");

  // 1. Missing runner: returns blocked without failing non-strict, but fails strict
  {
    const nonStrict = runAdapter(["--old-artifact", oldArtifact, "--new-artifact", newArtifact]);
    assert.equal(nonStrict.status, 0, "Non-strict without runner should exit 0");
    assert(nonStrict.report, "Report should be created");
    const blockedCount = nonStrict.report.cases.filter((c) => c.status === "blocked").length;
    assert.equal(blockedCount, 13, "Should have 13 blocked cases when runner is missing");

    const strict = runAdapter(["--old-artifact", oldArtifact, "--new-artifact", newArtifact, "--strict"]);
    assert.equal(strict.status, 1, "Strict without runner should exit 1");
    console.log("✔ Missing runner correctly emits blocked cases and obeys strict exit policy");
  }

  // 2. Harmless mock runner: implements runner contract and passes all matrix cases
  {
    const res = runAdapter([
      "--old-artifact", oldArtifact,
      "--new-artifact", newArtifact,
      "--target-os", "linux",
      "--package-format", "deb",
      "--runner", mockRunner
    ]);
    assert.equal(res.status, 0, `Mock runner should exit 0: ${res.stderr}`);
    assert(res.report, "Report should exist");
    const passCount = res.report.cases.filter((c) => c.status === "pass").length;
    assert.equal(passCount, 14, `All 14 cases should pass with mock runner (got ${passCount})`);
    const installCase = res.report.cases.find((c) => c.id === "native.fresh-install");
    assert(installCase.evidence.length > 0, "Evidence file should be copied to report evidence dir");
    console.log("✔ Target runner protocol successfully executes, ingests cases, and preserves evidence");
  }

  // 3. Failing runner: reports failure in matrix cases and exits nonzero
  {
    const res = runAdapter([
      "--old-artifact", oldArtifact,
      "--new-artifact", newArtifact,
      "--target-os", "linux",
      "--package-format", "deb",
      "--runner", failingRunner
    ]);
    assert.equal(res.status, 1, "Failing runner must cause adapter to exit 1");
    assert(res.report, "Report should exist");
    const freshInstall = res.report.cases.find((c) => c.id === "native.fresh-install");
    assert.equal(freshInstall.status, "fail", "Failed case in runner report must be marked fail");
    console.log("✔ Target runner failure propagation works accurately");
  }

  // 4. Stale runner / hash mismatch: rejects stale report and exits nonzero
  {
    const res = runAdapter([
      "--old-artifact", oldArtifact,
      "--new-artifact", newArtifact,
      "--target-os", "linux",
      "--package-format", "deb",
      "--runner", staleRunner
    ]);
    assert.equal(res.status, 1, "Stale report must cause adapter to exit 1");
    assert(res.report, "Report should exist");
    const anyFailed = res.report.cases.some((c) => c.status === "fail" && /stale|mismatch/i.test(c.failureReason || ""));
    assert(anyFailed, "Report validation error must be recorded on cases");
    console.log("✔ Stale report and artifact hash mismatch are strictly rejected");
  }

  console.log("\nAll native adapter protocol tests passed!\n");
} finally {
  try { rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
}
