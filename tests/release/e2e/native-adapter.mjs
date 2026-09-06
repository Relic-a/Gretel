#!/usr/bin/env node

/**
 * Protocol adapter for native package verification.
 *
 * Native installer tests must run in a disposable target OS image. This adapter
 * validates the explicit artifact inventory and emits a blocked report until a
 * target runner is supplied. It never installs a package on the developer host.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
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
const targetOs = args.targetOs || "";

addCase("native.inventory", "Explicit old and new package artifacts are present, non-empty, and identified by hash.", oldArtifact.present && newArtifact.present ? "pass" : "blocked", {
  reason: oldArtifact.present && newArtifact.present ? undefined : [oldArtifact.reason, newArtifact.reason].filter(Boolean).join(" "),
  evidence: []
});

const targetMatches = targetOs && ["linux", "macos", "windows"].includes(targetOs) && targetOs === platformName(process.platform);
addCase("native.target-runner", "The adapter executes only inside an explicitly selected disposable target OS runner.", runner.present && targetMatches ? "pass" : "blocked", {
  reason: runner.present ? (targetMatches ? undefined : `target OS ${targetOs || "(missing)"} does not match host ${platformName(process.platform)}`) : runner.reason,
  evidence: []
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
  ["native.arch-manual-update", "Arch packages are verified as manual update paths and never claimed automatic."
  ]
];

for (const [id, criterion] of matrix) {
  const supported = runner.present && targetMatches && oldArtifact.present && newArtifact.present;
  addCase(id, criterion, supported ? "blocked" : "blocked", {
    reason: supported
      ? "Runner supplied but no validated native protocol result was returned; implement the target runner contract before claiming a pass."
      : "Native evidence requires explicit old/new artifacts and a disposable target OS runner.",
    evidence: []
  });
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
  mode: "native-package",
  artifact: { old: oldArtifact, new: newArtifact, targetOs: targetOs || null, runner: runner.present ? args.runner : null },
  thresholds: { startupReadyMs: 30_000, teardownMs: 10_000 },
  cases
};
await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ report: path.join(output, "report.json"), runRoot, blocked: cases.filter((entry) => entry.status === "blocked").length }));
process.exitCode = cases.some((entry) => entry.status === "fail" || (args.strict && ["blocked", "not_run"].includes(entry.status))) ? 1 : 0;

function addCase(id, criterion, status, details) {
  cases.push({
    id,
    criterion,
    status,
    durationMs: 0,
    evidence: details.evidence || [],
    failureReason: details.reason,
    scope: "native-package",
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

async function prepareOutput(requested) {
  const target = path.resolve(requested || await mkdtemp(path.join(os.tmpdir(), "gretel-native-output-")));
  assertSafeScratchPath(target);
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
    if (arg === "--strict") result.strict = true;
    else if (arg.startsWith("--old-artifact=")) result.oldArtifact = arg.slice(15);
    else if (arg === "--old-artifact") result.oldArtifact = argv[++index];
    else if (arg.startsWith("--new-artifact=")) result.newArtifact = arg.slice(15);
    else if (arg === "--new-artifact") result.newArtifact = argv[++index];
    else if (arg.startsWith("--target-os=")) result.targetOs = arg.slice(12);
    else if (arg === "--target-os") result.targetOs = argv[++index];
    else if (arg.startsWith("--runner=")) result.runner = arg.slice(9);
    else if (arg === "--runner") result.runner = argv[++index];
    else if (arg.startsWith("--output=")) result.output = arg.slice(9);
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node native-adapter.mjs --old-artifact FILE --new-artifact FILE --target-os linux|macos|windows --runner EXECUTABLE [--output DIR] [--strict]");
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
