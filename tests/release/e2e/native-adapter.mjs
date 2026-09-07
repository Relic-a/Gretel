#!/usr/bin/env node

/**
 * Protocol adapter for native package verification.
 *
 * Native installer tests must run in a disposable target OS image. This adapter
 * validates the explicit artifact inventory, invokes the supplied target runner
 * according to the documented runner contract, validates the report schema, hashes,
 * and evidence, and emits a structured verification report.
 *
 * It never installs a package on the developer host.
 */

import { runOwned } from "../owned-process.mjs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const args = parseArgs(process.argv.slice(2));
const output = await prepareOutput(args.output);
const runRoot = await mkdtemp(path.join(output, "native-run-"));
const startedAt = new Date().toISOString();
const cases = [];

const oldArtifact = await inspectArtifact(args.oldArtifact, "old");
const newArtifact = await inspectArtifact(args.newArtifact, "new");
const runner = args.runner ? await inspectRunner(args.runner) : { present: false, reason: "No disposable target OS runner supplied." };
const targetOs = args.targetOs || platformName(process.platform);
const packageFormat = args.packageFormat || inferPackageFormat(args.newArtifact || args.oldArtifact || "");
const timeoutMs = Number.isSafeInteger(Number(args.timeout)) && Number(args.timeout) > 0 ? Number(args.timeout) : 60_000;

const formatMatches = packageFormat !== "unknown" && [oldArtifact, newArtifact].every(a => !a.present || inferPackageFormat(a.path) === packageFormat);
const inventoryEvidence = path.relative(output,path.join(runRoot,"inventory.json"));
await writeFile(path.join(output,inventoryEvidence),JSON.stringify({oldArtifact,newArtifact,targetOs,packageFormat,declaredContract:args.protocolTest?"protocol-test":args.disposableContract || null},null,2));
addCase("native.inventory", "Explicit old and new package artifacts are present, non-empty, and identified by hash.", oldArtifact.present && newArtifact.present ? (formatMatches ? "pass" : "fail") : "blocked", {
  reason: oldArtifact.present && newArtifact.present ? (formatMatches ? undefined : "Artifact extension and declared package format mismatch or unknown format") : [oldArtifact.reason, newArtifact.reason].filter(Boolean).join(" "),
  evidence: [inventoryEvidence]
});

const supportedOsList = ["linux", "macos", "windows"];
const declaredBoundary = args.protocolTest || args.disposableContract === "owned-disposable-target-v1";

const targetMatches = declaredBoundary && formatMatches && targetOs && supportedOsList.includes(targetOs) && targetOs === platformName(process.platform);
addCase("native.target-runner", "The adapter executes only inside an explicitly selected disposable target OS runner.", runner.present && targetMatches ? "pass" : "blocked", {
  reason: runner.present ? (targetMatches ? undefined : !declaredBoundary ? "Explicit disposable contract or --protocol-test is required" : !formatMatches ? "Artifact package format mismatch" : `target OS ${targetOs || "(missing)"} does not match host ${platformName(process.platform)}`) : runner.reason,
  evidence: [inventoryEvidence]
});

const matrix = [
  ["native.fresh-install", "Fresh install starts the packaged GUI/shell and reaches a healthy local server."],
  ["native.reinstall-preserve", "Reinstall preserves the isolated user data directory and durable records."],
  ["native.upgrade-preserve", "Old to new package upgrade preserves data and launches the new version."],
  ["native.uninstall-keep", "Explicit uninstall keep-data choice preserves the isolated data directory."],
  ["native.uninstall-remove", "Explicit uninstall remove-data choice deletes only the disposable target data."],
  ["native.gui-shutdown", "The real GUI/shell exits cleanly and leaves no packaged server child behind."],
  ["native.update-tamper", "The real updater verifier rejects a tampered payload and retains the old executable."],
  ["native.update-wrong-signature", "The real updater verifier rejects a payload signed by the wrong key."],
  ["native.update-interruption", "A download interruption leaves the old executable launchable."],
  ["native.update-install-failure", "An install failure leaves the old executable launchable."],
  ["native.update-success", "A verified update relaunches the new version with data unchanged."],
  ["native.arch-manual-update", "Arch packages are verified as manual update paths and never claimed automatic."]
].filter(([id]) => packageFormat === "arch" ? !id.startsWith("native.update-") : id !== "native.arch-manual-update");

const supported = runner.present && targetMatches && oldArtifact.present && newArtifact.present;

if (!supported) {
  for (const [id, criterion] of matrix) {
    addCase(id, criterion, "blocked", {
      reason: !runner.present
        ? "No disposable target OS runner supplied."
        : !targetMatches
          ? `target OS ${targetOs} does not match host ${platformName(process.platform)}`
          : "Native evidence requires explicit old/new artifacts and a disposable target OS runner.",
      evidence: []
    });
  }
} else {
  // Execute the target runner protocol contract
  const targetScratchDir = path.join(runRoot, "runner-scratch");
  const targetEvidenceDir = path.join(runRoot, "runner-evidence");
  const targetReportFile = path.join(runRoot, "runner-report.json");
  const protocolRunId = `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await mkdir(targetScratchDir, { recursive: true, mode: 0o700 });
  await mkdir(targetEvidenceDir, { recursive: true, mode: 0o700 });

  const runnerResult = await runOwned(runner.path, [
    "--run-id", protocolRunId,
    "--scratch-dir", targetScratchDir,
    "--evidence-dir", targetEvidenceDir,
    "--report-file", targetReportFile,
    "--old-artifact", oldArtifact.path,
    "--old-hash", oldArtifact.sha256,
    "--new-artifact", newArtifact.path,
    "--new-hash", newArtifact.sha256,
    "--target-os", targetOs,
    "--package-format", packageFormat,
    "--architecture", process.arch,
    "--qualification", args.protocolTest ? "protocol-test" : "native-package",
    "--case-ids", matrix.map(([id]) => id).join(",")
  ], { cwd: targetScratchDir, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8", env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: targetScratchDir, TMPDIR: targetScratchDir, LANG: "C.UTF-8" } });

  let targetReport = null;
  let reportValidationError = "";

  if (runnerResult.timedOut || runnerResult.cancelled || runnerResult.survivors.length || runnerResult.leaked.length) {
    reportValidationError = "Target runner timed out, was cancelled, or left owned descendants.";
  } else if (runnerResult.error) {
    reportValidationError = runnerResult.error.code === "ETIMEDOUT"
      ? `Target runner timed out after ${timeoutMs}ms.`
      : `Failed to execute target runner: ${String(runnerResult.error)}`;
  } else if (runnerResult.status !== 0 || runnerResult.signal) {
    reportValidationError = `Target runner failed: exit=${runnerResult.status} signal=${runnerResult.signal || "none"}.`;
  } else if (!existsSync(targetReportFile)) {
    reportValidationError = `Target runner exited with code ${runnerResult.status} but produced no report at ${targetReportFile}.`;
  } else {
    try {
      safeEvidence(runRoot, "runner-report.json");
      targetReport = JSON.parse(await readFile(targetReportFile, "utf8"));
    } catch {
      reportValidationError = "Target runner produced malformed JSON report.";
    }
  }

  if (targetReport && !reportValidationError) {
    if (targetReport.schemaVersion !== 1) {
      reportValidationError = `Unsupported runner report schemaVersion ${targetReport.schemaVersion}; expected 1.`;
    } else if (targetReport.runId !== protocolRunId) {
      reportValidationError = `Stale runner report rejected: report runId ${targetReport.runId} does not match execution token ${protocolRunId}.`;
    } else if (targetReport.targetOs !== targetOs) {
      reportValidationError = `Runner report targetOs ${targetReport.targetOs} does not match expected target ${targetOs}.`;
    } else if (targetReport.oldArtifactHash !== oldArtifact.sha256) {
      reportValidationError = `Old artifact hash mismatch in runner report: expected ${oldArtifact.sha256}, got ${targetReport.oldArtifactHash}.`;
    } else if (targetReport.newArtifactHash !== newArtifact.sha256) {
      reportValidationError = `New artifact hash mismatch in runner report: expected ${newArtifact.sha256}, got ${targetReport.newArtifactHash}.`;
    } else if (targetReport.packageFormat !== packageFormat || targetReport.architecture !== process.arch || targetReport.qualification !== (args.protocolTest ? "protocol-test" : "native-package")) {
      reportValidationError = "Runner package, architecture or qualification identity mismatch.";
    } else if (!Array.isArray(targetReport.cases)) {
      reportValidationError = "Target runner report missing cases array.";
    }
  }

  if (targetReport && !reportValidationError) {
    const ids = targetReport.cases.map(c => c.id);
    if (new Set(ids).size !== ids.length || ids.length !== matrix.length || ids.some(id => !matrix.some(([expected]) => id === expected))) reportValidationError = "Duplicate, unexpected or missing native cases.";
    for (const c of targetReport.cases) {
      if (!["pass", "fail", "blocked", "not_run"].includes(c.status)) reportValidationError = "Invalid case status.";
      if (!Array.isArray(c.evidence) || (c.status === "pass" && !c.evidence.length)) reportValidationError = "Passing native cases require nonempty evidence.";
      try { for (const name of c.evidence || []) safeEvidence(targetEvidenceDir, name); }
      catch (error) { reportValidationError = error.message; }
    }
  }
  const outputEvidenceDir = path.join(runRoot, "evidence");
  await mkdir(outputEvidenceDir, { recursive: true, mode: 0o700 });

  for (const [id, criterion] of matrix) {
    if (reportValidationError) {
      addCase(id, criterion, "fail", { reason: reportValidationError, evidence: [] });
      continue;
    }

    const matchedCase = targetReport.cases.find((c) => c.id === id);
    if (!matchedCase) {
      addCase(id, criterion, "fail", { reason: `Target runner report omitted required matrix case ${id}.`, evidence: [] });
      continue;
    }

    const caseStatus = ["pass", "fail", "blocked", "not_run"].includes(matchedCase.status) ? matchedCase.status : "fail";
    const caseEvidence = [];

    if (Array.isArray(matchedCase.evidence)) {
      for (const evName of matchedCase.evidence) {
        const srcPath = safeEvidence(targetEvidenceDir, evName);
        const destName = `${randomUUID()}.evidence`;
        copyFileSync(srcPath, path.join(outputEvidenceDir, destName), 1);
        caseEvidence.push(path.relative(output, path.join(outputEvidenceDir, destName)));
      }
    }

    addCase(id, criterion, caseStatus, {
      reason: matchedCase.failureReason || undefined,
      durationMs: matchedCase.durationMs || 0,
      evidence: caseEvidence
    });
  }
}

const report = {
  schemaVersion: 1,
  layer: "e2e-native",
  runId: path.basename(runRoot),
  startedAt,
  finishedAt: new Date().toISOString(),
  gitSha: gitSha(),
  dirty: gitDirty(),
  seed: 20260905,
  platform: process.platform,
  architecture: process.arch,
  mode: args.protocolTest ? "protocol-test" : "native-package",
  artifact: { old: oldArtifact, new: newArtifact, targetOs: targetOs || null, packageFormat, runner: runner.present ? args.runner : null },
  thresholds: { startupReadyMs: 30_000, teardownMs: 10_000 },
  cases
};

await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag:"wx" });
console.log(JSON.stringify({ report: path.join(output, "report.json"), runRoot, pass: cases.filter((entry) => entry.status === "pass").length, fail: cases.filter((entry) => entry.status === "fail").length, blocked: cases.filter((entry) => entry.status === "blocked").length }));
process.exitCode = cases.some((entry) => entry.status === "fail" || (args.strict && ["blocked", "not_run"].includes(entry.status))) ? 1 : 0;

function addCase(id, criterion, status, details = {}) {
  cases.push({
    id,
    criterion,
    status,
    durationMs: details.durationMs || 0,
    evidence: details.evidence || [],
    failureReason: details.reason ?? undefined,
    scope: args.protocolTest ? "protocol-test" : "native-package",
    measurements: {}
  });
}

async function inspectArtifact(requested, label) {
  if (!requested) return { label, path: "", present: false, reason: `Missing --${label}-artifact.` };
  const target = path.resolve(requested);
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.size === 0) return { label, path: target, present: false, reason: `${label} artifact is missing or empty.` };
    const contents = await readFile(target);
    return { label, path: target, present: true, bytes: stats.size, sha256: createHash("sha256").update(contents).digest("hex"), fileName: path.basename(target) };
  } catch (error) {
    return { label, path: target, present: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function inspectRunner(requested) {
  const target = path.resolve(requested);
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || !(stats.mode & 0o111)) return { present: false, reason: "--runner must be an executable target OS adapter." };
    return { present: true, path: target };
  } catch (error) {
    return { present: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function inferPackageFormat(filename) {
  if (filename.endsWith(".deb")) return "deb";
  if (filename.endsWith(".rpm")) return "rpm";
  if (filename.endsWith(".AppImage") || filename.endsWith(".appimage")) return "appimage";
  if (filename.endsWith(".pkg.tar.zst") || filename.includes(".arch-package")) return "arch";
  if (filename.endsWith(".dmg")) return "dmg";
  if (filename.endsWith(".app.tar.gz") || filename.endsWith(".tar.gz")) return "tar.gz";
  if (filename.endsWith(".exe")) return "nsis";
  return "unknown";
}

async function prepareOutput(requested) {
  const target = path.resolve(requested || await mkdtemp(path.join(os.tmpdir(), "gretel-native-output-")));
  assertSafeScratchPath(target);
  for (let current=target; current !== path.dirname(current); current=path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error("Output ancestors must not be symlinks");
  }
  if (existsSync(path.join(target,"report.json"))) throw Error("Output already contains a report; choose a fresh output directory");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const stats = await lstat(target);
  if (stats.isSymbolicLink()) throw new Error("Output directory must not be a symlink.");
  return target;
}

function assertSafeScratchPath(target) {
  const resolved = path.resolve(target);
  const forbidden = new Set([path.parse(resolved).root, os.homedir(), repoRoot]);
  if (forbidden.has(resolved)) throw new Error(`Refusing unsafe output path ${resolved}`);
  let parent = path.dirname(resolved);
  while (parent && parent !== path.parse(parent).root && existsSync(parent)) {
    const realParent = realpathSync(parent);
    if (forbidden.has(realParent)) throw new Error(`Refusing output path through protected symlink ${parent}`);
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

function platformName(platform) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--protocol-test") result.protocolTest = true;
    else if (arg === "--disposable-contract") result.disposableContract = argv[++index];
    else if (arg === "--strict") result.strict = true;
    else if (arg.startsWith("--old-artifact=")) result.oldArtifact = arg.slice(15);
    else if (arg === "--old-artifact") result.oldArtifact = argv[++index];
    else if (arg.startsWith("--new-artifact=")) result.newArtifact = arg.slice(15);
    else if (arg === "--new-artifact") result.newArtifact = argv[++index];
    else if (arg.startsWith("--target-os=")) result.targetOs = arg.slice(12);
    else if (arg === "--target-os") result.targetOs = argv[++index];
    else if (arg.startsWith("--package-format=")) result.packageFormat = arg.slice(17);
    else if (arg === "--package-format") result.packageFormat = argv[++index];
    else if (arg.startsWith("--runner=")) result.runner = arg.slice(9);
    else if (arg === "--runner") result.runner = argv[++index];
    else if (arg.startsWith("--timeout=")) result.timeout = Number(arg.slice(10));
    else if (arg === "--timeout") result.timeout = Number(argv[++index]);
    else if (arg.startsWith("--output=")) result.output = arg.slice(9);
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node native-adapter.mjs --old-artifact FILE --new-artifact FILE --target-os linux|macos|windows --runner EXECUTABLE [--package-format FORMAT] [--output DIR] [--strict] [--timeout MS]");
      process.exit(0);
    }
  }
  return result;
}

function gitSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function gitDirty() {
  try { return Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim()); } catch { return true; }
}

function safeEvidence(root, name) {
  if (typeof name !== "string" || !name || path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("Unsafe evidence path.");
  const source = path.resolve(root, name);
  const relative = path.relative(realpathSync(root), realpathSync(source));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Evidence escapes owned root.");
  let current = root;
  for (const part of name.split(/[\\/]/)) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error("Symlink evidence rejected."); }
  const stats = lstatSync(source);
  if (!stats.isFile() || !stats.size) throw new Error("Evidence must be a nonempty regular file.");
  return source;
}
