#!/usr/bin/env node
// Gretel Release-Verification Unified Orchestrator
// Coordinates E2E, Chaos, Soak, and Native Adapter protocol suites.
//
// Usage:
//   node tests/release/run-all.mjs [options]
//
// Options:
//   --output <dir>       Artifact output scratch directory (validated safe path)
//   --strict             Exit 1 if ANY case fails, is blocked, or is not_run
//   --quick, --fast      Fast mode (quick chaos, fast soak)
//   --storage-only       Soak layer executes only accelerated storage workload
//   --self-test          Run all negative controls, protocol tests, and unit self-tests
//   --skip-e2e           Skip E2E verification layer
//   --skip-chaos         Skip Chaos verification layer
//   --skip-soak          Skip Soak verification layer
//   --skip-protocol      Skip Native Adapter and evaluator protocol checks
//   --artifact <path>    Path to standalone production artifact (default: .next/standalone)

import { runOwned } from "./owned-process.mjs";
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  lstatSync,
  realpathSync,
  mkdtempSync
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getArtifactIdentity, getChaosSourceIdentity } from "./artifact-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

function parseArgs(argv) {
  const options = {
    output: "",
    strict: false,
    quick: false,
    storageOnly: false,
    selfTest: false,
    skipE2e: false,
    skipChaos: false,
    skipSoak: false,
    skipProtocol: false,
    artifactPath: path.join(REPO_ROOT, ".next/standalone"),
    seed: 20260905
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--quick" || arg === "--fast") options.quick = true;
    else if (arg === "--storage-only") options.storageOnly = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--skip-e2e") options.skipE2e = true;
    else if (arg === "--skip-chaos") options.skipChaos = true;
    else if (arg === "--skip-soak") options.skipSoak = true;
    else if (arg === "--skip-protocol") options.skipProtocol = true;
    else if (arg === "--output") options.output = argv[++i];
    else if (arg === "--artifact") options.artifactPath = path.resolve(argv[++i]);
    else if (arg === "--fixture-layer") options.fixtureLayer = path.resolve(argv[++i]);
    else if (arg === "--timeout") options.timeout = Number(argv[++i]);
    else if (arg === "--seed") options.seed = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.fixtureLayer && !options.selfTest) throw Error("Fixture layers require explicit --self-test scope");
  return options;
}

function printHelp() {
  process.stdout.write(`Gretel Release-Verification Unified Orchestrator

Usage:
  node tests/release/run-all.mjs [options]

Options:
  --output <dir>       Artifact output scratch directory (validated safe path)
  --strict             Exit 1 if ANY case fails, is blocked, or is not_run
  --quick, --fast      Fast mode (quick chaos, fast soak)
  --storage-only       Soak layer executes only accelerated storage workload
  --self-test          Run all negative controls, protocol tests, and unit self-tests
  --skip-e2e           Skip E2E verification layer
  --skip-chaos         Skip Chaos verification layer
  --skip-soak          Skip Soak verification layer
  --skip-protocol      Skip Native Adapter and evaluator protocol checks
  --artifact <path>    Path to standalone production artifact (default: .next/standalone)
  --help, -h           Show this help message
`);
}

function validateScratchDirectory(targetDir) {
  if (!targetDir) {
    return mkdtempSync(path.join(tmpdir(), "gretel-release-verify-"));
  }
  const resolved = path.resolve(targetDir);
  const home = homedir() ? realpathSync(homedir()) : "";
  const root = realpathSync(REPO_ROOT);

  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`Output path cannot be a symbolic link: ${resolved}`);
  }
  for (let current=resolved; current !== path.dirname(current); current=path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error("Output ancestors must not be symlinks");
  }
  if (resolved === "/" || resolved === home || resolved === root || resolved.startsWith(root + path.sep)) throw Error("Unsafe output directory");
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const actual = realpathSync(resolved);
  if (actual === "/" || actual === home || actual === root || actual.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing unsafe output path inside repository or home: ${actual}`);
  }
  return actual;
}

function gitInfo() {
  let sha = "unknown";
  let dirty = true;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim());
  } catch {}
  return { sha, dirty };
}

async function runSubprocess(cmd, args, label, options = {}) {
  process.stdout.write(`\n--- [${label}] Running ${cmd} ${args.join(" ")} ---\n`);
  const started = Date.now();
  const res = await runOwned(cmd, args, {cwd:REPO_ROOT, env:{PATH:process.env.PATH || "/usr/bin:/bin", HOME:options.home, LANG:"C.UTF-8", ...options.env}, timeout:options.timeout || 600000});
  cancelled ||= res.cancelled;

  if (options.log) writeFileSync(options.log, JSON.stringify(res, null, 2));
  return { ...res, status: res.status ?? 128, durationMs: Date.now() - started };

}

let cancelled = false;
process.on("SIGINT", () => {cancelled=true;});
process.on("SIGTERM", () => {cancelled=true;});
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputParent = validateScratchDirectory(options.output);
  const outputRoot = mkdtempSync(path.join(outputParent, "invocation-"));
  const childHome = path.join(outputRoot,"child-home"); mkdirSync(childHome,{mode:0o700});
  const runId = `release-verify-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const git = gitInfo();

  process.stdout.write(`========================================================\n`);
  process.stdout.write(`Gretel 0.5.3 Release Verification Orchestrator\n`);
  process.stdout.write(`Run ID:    ${runId}\n`);
  process.stdout.write(`Git SHA:   ${git.sha} (dirty: ${git.dirty})\n`);
  process.stdout.write(`Output:    ${outputRoot}\n`);
  process.stdout.write(`Strict:    ${options.strict}\n`);
  process.stdout.write(`========================================================\n\n`);

  // 1. Artifact Identity
  const artifact = getArtifactIdentity(options.artifactPath, PACKAGE_JSON.version);
  if (!artifact.present) {
    process.stderr.write(`Error: Standalone artifact missing at ${options.artifactPath}\n`);
    process.stderr.write(`Build it first with: npm run build\n`);
    writeFileSync(path.join(outputRoot,"report.json"),JSON.stringify({schemaVersion:1,layer:"combined",runId,artifact,cases:[{id:"qualification.artifact",status:"fail",category:"platform",failureReason:"Selected artifact is missing or has incomplete identity coverage",evidence:[]}]}));
    process.exit(1);
  }
  process.stdout.write(`Artifact Identity: manifest SHA ${artifact.manifestSha256.slice(0, 16)}... (${artifact.filesCount} files, ${(artifact.totalBytes / (1024 * 1024)).toFixed(1)} MB)\n\n`);

  const layerResults = {};
  const allCases = [];
  const inventory = JSON.parse(readFileSync(path.join(__dirname, "case-inventory.json")));
  inventory.chaos = inventory.chaos.filter(id => !id.startsWith("chaos.process-kill.seed-")).concat(Array.from({length: options.quick ? 2 : 10}, (_, i) => `chaos.process-kill.seed-${options.seed + i * 7919}`));
  if (!options.storageOnly && !options.quick) inventory.soak = inventory.soak.filter(id => id !== "soak-wall-clock-skipped").concat(["soak-server-start","soak-profile-create","soak-restart","soak-deterministic-network","soak-refresh-fixture","soak-durable-history-post-restart","soak-completed-operations","soak-feed-work-drained","soak-no-fatal-errors","soak-teardown-bounded","soak-rss-trend","soak-idle-rss-stability","soak-idle-cpu"]);
  if (!options.quick) inventory.chaos.push(...["500", "timeout", "malformed", "wrong-length"].map(x => `chaos.network.${x}`));
  function tooling(layer, reason) { allCases.push({id: `tooling.${layer}.${allCases.length}`, layer, status: "fail", category: "tooling", failureReason: reason, evidence: []}); }
  function validate(report, layer, run) {
    if (report.schemaVersion !== 1 || report.layer !== layer || report.executionToken !== runId || report.gitSha !== git.sha || report.platform !== process.platform || report.architecture !== process.arch) throw Error("Report schema/execution/code/platform identity mismatch");
    if (!Array.isArray(report.cases) || !report.cases.length) throw Error("Empty/missing case inventory");
    const expectedMode = layer === "e2e" ? "all" : layer === "chaos" ? (options.quick ? "quick" : "full") : ((options.storageOnly || options.quick) ? "storage" : "quick-smoke");
    if (report.mode !== expectedMode) throw Error("Wrong report mode");
    if (layer !== "chaos" && report.artifact?.manifestSha256 !== artifact.manifestSha256) throw Error("Wrong executed artifact identity");
    if (layer === "chaos" && report.artifact?.manifestSha256 !== getChaosSourceIdentity(REPO_ROOT).manifestSha256) throw Error("Wrong source-module identity");
    const ids = report.cases.map(c => c.id);
    const extraFailures = new Set(["e2e.runner","e2e.prerequisites","soak-storage-runner","soak-storage-cleanup","soak-storage-error","soak-soak-runner","soak-report-schema","soak-report-completeness","soak-report-missing","soak-owned-lifecycle","soak-cancelled"]);
    for (const c of report.cases) if (!inventory[layer].includes(c.id) && !(extraFailures.has(c.id) && c.status !== "pass")) throw Error(`Unexpected case ${c.id}`);
    if (new Set(ids).size !== ids.length) throw Error("Duplicate cases");
    for (const id of inventory[layer].filter(id => id !== "soak-wall-clock-skipped" || options.storageOnly || options.quick)) if (!ids.includes(id)) throw Error(`Missing required case ${id}`);
    for (const c of report.cases) {
      if (!["pass", "fail", "blocked", "not_run"].includes(c.status)) throw Error(`Invalid status ${c.id}`);
      if (!Array.isArray(c.evidence) || (c.status === "pass" && !c.evidence.length)) throw Error(`Missing evidence ${c.id}`);
      c.evidence = c.evidence.map(ev => {
        if (typeof ev !== "string" || path.isAbsolute(ev) || ev.split(/[\\/]/).includes("..")) throw Error("Unsafe evidence path");
        const base = path.join(outputRoot, layer), full = path.join(base, ev);
        if (!realpathSync(full).startsWith(realpathSync(base) + path.sep) || !statSync(full).isFile()) throw Error("Missing or escaping evidence");
        return path.join(layer, ev);
      });
    }
    if (run.signal || run.timedOut || run.cancelled || run.survivors.length || run.leaked.length || (run.status !== 0 && !(run.status === 1 && report.cases.some(c => c.status !== "pass")))) throw Error(`Subprocess failure exit=${run.status} signal=${run.signal} timeout=${run.timedOut}`);
    if (run.status === 0 && report.cases.some(c => c.status === "fail")) tooling(layer, "Layer returned success with failing cases");
    return report.cases;
  }
  for (const [layer, skipped] of [["e2e", options.skipE2e], ["chaos", options.skipChaos], ["soak", options.skipSoak], ["protocol", options.skipProtocol]]) if (skipped) {
    layerResults[layer] = {status:"not_run"};
    for (const id of inventory[layer] || []) allCases.push({id,layer,category:"tooling",status:"not_run",failureReason:"Required layer explicitly skipped",evidence:[]});
    allCases.push({id:`qualification.${layer}.skipped`, layer, category:"tooling", status:"not_run", failureReason:"Required layer explicitly skipped; run cannot qualify a release.", evidence:[]});
  }

  // 2. Self-Tests and Protocol Controls
  if (!options.skipProtocol) {
    process.stdout.write(`[Protocol & Negative Controls]\n`);
    const protocolOutput = path.join(outputRoot, "protocol");
    mkdirSync(protocolOutput, { recursive: true, mode: 0o700 });

    const protocolTests = [
      { name: "artifact-identity-test", script: "tests/release/artifact-identity-test.mjs", args: [] },
      { name: "unified-runner-test", script: "tests/release/run-all-test.mjs", args: [] },
      { name: "storage-rotation-test", script: "tests/release/soak/storage-rotation-test.mjs", args: [] },
      { name: "lifecycle-test", script: "tests/release/lifecycle-test.mjs", args: [] },
      { name: "soak-metrics-eval", script: "tests/release/soak/soak-metrics-eval.mjs", args: [] },
      { name: "soak-runner-test", script: "tests/release/soak/soak-runner-test.mjs", args: [] },
      { name: "native-adapter-test", script: "tests/release/e2e/native-adapter-test.mjs", args: [] },
      { name: "e2e-self-test", script: "tests/release/e2e/run.mjs", args: ["--self-test"] }
    ];

    let protoPass = 0;
    let protoFail = 0;
    for (const test of protocolTests) {
      const run = await runSubprocess(process.execPath, options.fixtureLayer ? [options.fixtureLayer, "--protocol"] : [path.join(REPO_ROOT, test.script), ...test.args], test.name, {home: childHome, log: path.join(protocolOutput, `${test.name}.json`)});
      if (run.status === 0) {
        protoPass++;
        allCases.push({
          id: `protocol.${test.name}`,
          layer: "protocol",
          category: "tooling",
          criterion: `Unit self-tests and negative controls for ${test.name} pass cleanly.`,
          status: "pass",
          durationMs: run.durationMs,
          evidence: [`protocol/${test.name}.json`]
        });
      } else {
        protoFail++;
        allCases.push({
          id: `protocol.${test.name}`,
          layer: "protocol",
          category: "tooling",
          criterion: `Unit self-tests and negative controls for ${test.name} pass cleanly.`,
          status: "fail",
          durationMs: run.durationMs,
          reason: `Process exited with code ${run.status}`,
          failureReason: `Process exited with code ${run.status}`,
          evidence: [`protocol/${test.name}.json`]
        });
      }
    }
    layerResults.protocol = {
      status: protoFail === 0 ? "pass" : "fail",
      casesCount: protocolTests.length,
      pass: protoPass,
      fail: protoFail,
      blocked: 0,
      not_run: 0
    };
  }

  // 3. E2E Layer
  if (!options.skipE2e && !cancelled) {
    const e2eOutput = path.join(outputRoot, "e2e");
    mkdirSync(e2eOutput, { recursive: true, mode: 0o700 });
    const e2eArgs = [
      path.join(REPO_ROOT, "tests/release/e2e/run.mjs"),
      "--mode", "all",
      "--artifact", options.artifactPath,
      "--output", e2eOutput
    ];
    if (options.strict) e2eArgs.push("--strict");

    if (options.fixtureLayer) { e2eArgs[0] = options.fixtureLayer; e2eArgs.push("--layer", "e2e", "--identity", JSON.stringify(artifact), "--inventory", JSON.stringify(inventory.e2e)); }
    const e2eRun = await runSubprocess(process.execPath, e2eArgs, "E2E Layer", {home: childHome, env: {GRETEL_VERIFICATION_TOKEN: runId}, timeout: options.timeout, log: path.join(e2eOutput, "process.json")});
    const e2eReportPath = path.join(e2eOutput, "report.json");
    if (existsSync(e2eReportPath)) {
      try {
        const e2eReport = JSON.parse(readFileSync(e2eReportPath, "utf8"));
        const cases = validate(e2eReport, "e2e", e2eRun);
        for (const c of cases) {
          allCases.push({ ...c, layer: "e2e" });
        }
        const p = cases.filter((c) => c.status === "pass").length;
        const f = cases.filter((c) => c.status === "fail").length;
        const b = cases.filter((c) => c.status === "blocked").length;
        const nr = cases.filter((c) => c.status === "not_run").length;
        layerResults.e2e = {
          status: e2eRun.status === 0 ? "pass" : f > 0 ? "fail" : "blocked",
          exitCode: e2eRun.status,
          reportPath: "e2e/report.json",
          casesCount: cases.length,
          pass: p,
          fail: f,
          blocked: b,
          not_run: nr
        };
      } catch (err) {
        tooling("e2e", String(err));
        layerResults.e2e = { status: "fail", exitCode: e2eRun.status, error: String(err) };
      }
    } else {
      tooling("e2e", "report.json missing");
      layerResults.e2e = { status: "fail", exitCode: e2eRun.status, error: "report.json missing" };
    }
  }

  // 4. Chaos Layer
  if (!options.skipChaos && !cancelled) {
    const chaosOutput = path.join(outputRoot, "chaos");
    mkdirSync(chaosOutput, { recursive: true, mode: 0o700 });
    const chaosArgs = [
      path.join(REPO_ROOT, "tests/release/chaos/verify-chaos.mjs"),
      "--output", chaosOutput,
      "--mode", options.quick ? "quick" : "full",
      "--seed", String(options.seed)
    ];
    if (options.strict) chaosArgs.push("--strict");

    if (options.fixtureLayer) { chaosArgs[0] = options.fixtureLayer; chaosArgs.push("--layer", "chaos", "--identity", JSON.stringify(getChaosSourceIdentity(REPO_ROOT)), "--inventory", JSON.stringify(inventory.chaos)); }
    const chaosRun = await runSubprocess(process.execPath, chaosArgs, "Chaos Layer", {home: childHome, env: {GRETEL_VERIFICATION_TOKEN: runId}, timeout: options.timeout, log: path.join(chaosOutput, "process.json")});
    const chaosReportPath = path.join(chaosOutput, "report.json");
    if (existsSync(chaosReportPath)) {
      try {
        const chaosReport = JSON.parse(readFileSync(chaosReportPath, "utf8"));
        const cases = validate(chaosReport, "chaos", chaosRun);
        for (const c of cases) {
          allCases.push({ ...c, layer: "chaos" });
        }
        const p = cases.filter((c) => c.status === "pass").length;
        const f = cases.filter((c) => c.status === "fail").length;
        const b = cases.filter((c) => c.status === "blocked").length;
        const nr = cases.filter((c) => c.status === "not_run").length;
        layerResults.chaos = {
          status: chaosRun.status === 0 ? "pass" : f > 0 ? "fail" : "blocked",
          exitCode: chaosRun.status,
          reportPath: "chaos/report.json",
          casesCount: cases.length,
          pass: p,
          fail: f,
          blocked: b,
          not_run: nr
        };
      } catch (err) {
        tooling("chaos", String(err));
        layerResults.chaos = { status: "fail", exitCode: chaosRun.status, error: String(err) };
      }
    } else {
      tooling("chaos", "report.json missing");
      layerResults.chaos = { status: "fail", exitCode: chaosRun.status, error: "report.json missing" };
    }
  }

  // 5. Soak Layer
  if (!options.skipSoak && !cancelled) {
    const soakOutput = path.join(outputRoot, "soak");
    mkdirSync(soakOutput, { recursive: true, mode: 0o700 });
    const soakArgs = [
      path.join(REPO_ROOT, "tests/release/soak/run-soak-verification.mjs"),
      "--output", soakOutput,
      "--storage-days", "180",
      "--artifact", options.artifactPath
    ];
    if (options.storageOnly || options.quick) {
      soakArgs.push("--storage-only");
    } else {
      soakArgs.push("--duration", "60");
    }
    if (options.strict) soakArgs.push("--strict");

    if (options.fixtureLayer) { soakArgs[0] = options.fixtureLayer; soakArgs.push("--layer", "soak", "--identity", JSON.stringify(artifact), "--inventory", JSON.stringify(inventory.soak)); }
    const soakRun = await runSubprocess(process.execPath, soakArgs, "Soak Layer", {home: childHome, env: {GRETEL_VERIFICATION_TOKEN: runId}, timeout: options.timeout, log: path.join(soakOutput, "process.json")});
    const soakReportPath = path.join(soakOutput, "report.json");
    if (existsSync(soakReportPath)) {
      try {
        const soakReport = JSON.parse(readFileSync(soakReportPath, "utf8"));
        const cases = validate(soakReport, "soak", soakRun);
        for (const c of cases) {
          allCases.push({ ...c, layer: "soak" });
        }
        const p = cases.filter((c) => c.status === "pass").length;
        const f = cases.filter((c) => c.status === "fail").length;
        const b = cases.filter((c) => c.status === "blocked").length;
        const nr = cases.filter((c) => c.status === "not_run").length;
        layerResults.soak = {
          status: soakRun.status === 0 ? "pass" : f > 0 ? "fail" : "blocked",
          exitCode: soakRun.status,
          reportPath: "soak/report.json",
          casesCount: cases.length,
          pass: p,
          fail: f,
          blocked: b,
          not_run: nr
        };
      } catch (err) {
        tooling("soak", String(err));
        layerResults.soak = { status: "fail", exitCode: soakRun.status, error: String(err) };
      }
    } else {
      tooling("soak", "report.json missing");
      layerResults.soak = { status: "fail", exitCode: soakRun.status, error: "report.json missing" };
    }
  }

  if (cancelled) tooling("lifecycle", "Cancelled; unexecuted layers remain unqualified");
  // 6. Aggregate Summary and Defect Categorization
  const totalCases = allCases.length;
  const passCount = allCases.filter((c) => c.status === "pass").length;
  const failCount = allCases.filter((c) => c.status === "fail").length;
  const blockedCount = allCases.filter((c) => c.status === "blocked").length;
  const notRunCount = allCases.filter((c) => c.status === "not_run").length;

  const productBugs = allCases.filter(c => c.category === "product" && c.status === "fail");
  const externalBlockers = allCases.filter(c => c.category === "platform" && c.status !== "pass");

  const combinedReport = {
    schemaVersion: 1,
    layer: "combined",
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    gitSha: git.sha,
    dirty: git.dirty,
    seed: options.seed,
    platform: process.platform,
    architecture: process.arch,
    strict: options.strict,
    scope: options.selfTest ? "self-test" : options.quick ? "smoke" : "qualification",
    cancelled,
    artifact,
    layers: layerResults,
    requiredInventory: inventory,
    summary: {
      totalCases,
      pass: passCount,
      fail: failCount,
      blocked: blockedCount,
      not_run: notRunCount,
      productBugsCount: productBugs.length,
      externalBlockersCount: externalBlockers.length,
      toolingFailuresCount: allCases.filter(c => c.category === "tooling" && c.status === "fail").length,
      toolingGapsCount: allCases.filter(c => c.category === "tooling" && ["blocked","not_run"].includes(c.status)).length,
      productCapabilityGapsCount: allCases.filter(c => c.category === "product-capability" && c.status !== "pass").length
    },
    cases: allCases
  };

  const finalReportPath = path.join(outputRoot, "report.json");
  writeFileSync(finalReportPath, JSON.stringify(combinedReport, null, 2) + "\n", "utf8");

  // Summary Markdown
  const summaryLines = [
    `# Gretel 0.5.3 Release Verification Summary`,
    ``,
    `- **Run ID:** \`${runId}\``,
    `- **Started:** ${startedAt}`,
    `- **Git Commit:** \`${git.sha}\` (dirty: ${git.dirty})`,
    `- **Platform:** ${process.platform} (${process.arch}), Node ${process.version}`,
    `- **Artifact Manifest SHA:** \`${artifact.manifestSha256}\` (${artifact.filesCount} files)`,
    ``,
    `## Results by Layer`,
    ``,
    `| Layer | Status | Cases | Pass | Fail | Blocked | Not Run |`,
    `| --- | --- | --- | --- | --- | --- | --- |`
  ];

  for (const [name, res] of Object.entries(layerResults)) {
    summaryLines.push(
      `| **${name.toUpperCase()}** | \`${res.status}\` | ${res.casesCount || 0} | ${res.pass || 0} | ${res.fail || 0} | ${res.blocked || 0} | ${res.not_run || 0} |`
    );
  }

  summaryLines.push(
    `| **TOTAL** | \`${failCount === 0 ? (blockedCount === 0 ? "pass" : "blocked") : "fail"}\` | **${totalCases}** | **${passCount}** | **${failCount}** | **${blockedCount}** | **${notRunCount}** |`,
    ``,
    `## Identified Product Bugs (Honest Reporting)`,
    ``
  );

  if (productBugs.length === 0) {
    summaryLines.push(`_No product bugs caught in this run._\n`);
  } else {
    summaryLines.push(`| Case ID | Layer | Reason / Defect Description |`);
    summaryLines.push(`| --- | --- | --- |`);
    for (const b of productBugs) {
      summaryLines.push(`| \`${b.id}\` | ${b.layer} | ${b.failureReason || b.reason || "Unknown failure"} |`);
    }
    summaryLines.push(``);
  }

  summaryLines.push(`## Blocked & Unavailable External Prerequisites\n`);
  if (externalBlockers.length === 0) {
    summaryLines.push(`_None._\n`);
  } else {
    summaryLines.push(`| Case ID | Layer | Requirement / Blocker Reason |`);
    summaryLines.push(`| --- | --- | --- |`);
    for (const b of externalBlockers) {
      summaryLines.push(`| \`${b.id}\` | ${b.layer} | ${b.failureReason || b.reason || "Prerequisite unavailable"} |`);
    }
    summaryLines.push(``);
  }

  const summaryPath = path.join(outputRoot, "summary.md");
  writeFileSync(summaryPath, summaryLines.join("\n") + "\n", "utf8");

  process.stdout.write(`\n========================================================\n`);
  process.stdout.write(`Verification Run Complete\n`);
  process.stdout.write(`Summary: ${passCount} passed, ${failCount} failed, ${blockedCount} blocked, ${notRunCount} not run (${totalCases} total)\n`);
  process.stdout.write(`Report:  ${finalReportPath}\n`);
  process.stdout.write(`Summary: ${summaryPath}\n`);
  process.stdout.write(`========================================================\n\n`);

  // Exit code policy:
  // Strict mode exits 1 if fail, blocked, or not_run > 0.
  // Non-strict mode exits 1 ONLY if fail > 0.
  if (options.strict) {
    if (failCount > 0 || blockedCount > 0 || notRunCount > 0) {
      process.exit(1);
    }
  } else {
    if (failCount > 0) {
      process.exit(1);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal error in run-all orchestrator: ${err.stack || err}\n`);
  process.exit(1);
});
