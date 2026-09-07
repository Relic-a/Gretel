#!/usr/bin/env node
import { categorizeCase } from "../case-category.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  createReadStream,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canarySet, scanForCanaries } from "./lib/canaries.mjs";
import { childEnv, makeCase, makeRunRoot } from "./lib/env.mjs";
import { normalizeCase, sha256, writeJson } from "./lib/report.mjs";
import { getArtifactIdentity, getChaosSourceIdentity } from "../artifact-identity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKER = path.join(ROOT, "tests/release/chaos/chaos-worker.mjs");
const BUILD = path.join(ROOT, ".tmp", "chaos-cjs");
const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function parseArgs(argv) {
  const values = { mode: "quick", seed: 424242, strict: false, output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") values.strict = true;
    else if (arg === "--mode") values.mode = argv[++index];
    else if (arg === "--seed") values.seed = Number(argv[++index]);
    else if (arg === "--output") values.output = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node tests/release/chaos/verify-chaos.mjs --output <dir> [--mode quick|full] [--strict] [--seed n]\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!values.output || !path.isAbsolute(values.output)) throw new Error("--output must be an absolute scratch/artifact directory");
  if (!Number.isSafeInteger(values.seed)) throw new Error("--seed must be a safe integer");
  if (!new Set(["quick", "full"]).has(values.mode)) throw new Error("--mode must be quick or full");
  return values;
}

function safeOutputDirectory(candidate) {
  const resolved = path.resolve(candidate);
  const home = process.env.HOME && existsSync(process.env.HOME) ? realpathSync(process.env.HOME) : "";
  const root = realpathSync(ROOT);
  const parent = path.dirname(resolved);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error("Refusing symlink output path");
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const actual = realpathSync(resolved);
  if (actual === "/" || actual === home || actual === root || actual.startsWith(`${root}${path.sep}`)) {
    throw new Error("Refusing repository, home, or filesystem-root output path");
  }
  const info = lstatSync(resolved);
  if (!info.isDirectory()) throw new Error("Output path is not a directory");
  return actual;
}

function compileModules() {
  mkdirSync(BUILD, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(BUILD, "package.json"), '{"type":"commonjs"}\n', { mode: 0o600 });
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".ts")) sourceFiles.push(full);
    }
  };
  visit(path.join(ROOT, "lib"));
  visit(path.join(ROOT, "app/api"));
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "node_modules/typescript/lib/tsc.js"),
    "--outDir", BUILD, "--module", "commonjs", "--target", "ES2022",
    "--skipLibCheck", "--types", "node", "--esModuleInterop", ...sourceFiles
  ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(`TypeScript module compilation failed: ${(result.stderr || result.stdout).slice(0, 2000)}`);
}

function waitForFile(filePath, timeoutMs = 3_000) {
  if (existsSync(filePath)) return Promise.resolve(true);
  const directory = path.dirname(filePath);
  return new Promise((resolve) => {
    let settled = false;
    const watcher = watch(directory, (_event, filename) => {
      if (filename && path.resolve(directory, String(filename)) === path.resolve(filePath) && existsSync(filePath)) {
        settled = true;
        watcher.close();
        clearTimeout(timer);
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      watcher.close();
      resolve(false);
    }, timeoutMs);
  });
}

function sanitize(text, seed) {
  const values = canarySet(seed);
  return [values.raw, values.encodedBase64, values.encodedUrl, `synthetic-initial-key-${seed}`, `synthetic-updated-key-${seed}`]
    .filter(Boolean)
    .reduce((current, value) => current.split(value).join("[REDACTED_CANARY]"), String(text));
}

let evidenceSequence = 0;
function writeEvidence(output, id, operation, context, stdout, stderr, result) {
  const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeOp = `${operation.replace(/[^a-zA-Z0-9_.-]/g, "_")}.${evidenceSequence++}`;
  const evidenceDir = path.join(output, "evidence");
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const paths = [];
  const rawObservations = [];
  const save = (suffix, contents) => {
    const file = path.join(evidenceDir, `${safeId}.${safeOp}.${suffix}`);
    const raw = String(contents), markers = [...Object.values(canarySet(context.seed)), `synthetic-initial-key-${context.seed}`, `synthetic-updated-key-${context.seed}`].filter(value => typeof value === "string" && value);
    rawObservations.push({source:suffix, channel:suffix === "result.json" ? "fixture-result" : "runtime-or-barrier", syntheticMarkerMatches:markers.filter(value => raw.includes(value)).length});
    writeFileSync(file, sanitize(raw, context.seed), { mode: 0o600 });
    paths.push(path.relative(output, file));
  };
  save("stdout.log", stdout);
  save("stderr.log", stderr);
  if (result !== undefined) save("result.json", JSON.stringify(result, null, 2));
  if (existsSync(context.logFile)) {
    save("gretel.log", readFileSync(context.logFile, "utf8"));
  }
  if (existsSync(context.logsDir)) {
    for (const name of readdirSync(context.logsDir)) {
      const file = path.join(context.logsDir, name);
      if (statSync(file).isFile() && file !== context.logFile) save(`log-${name}`, readFileSync(file, "utf8"));
    }
  }
  // Preserve any barrier files created in case directory
  if (existsSync(context.dir)) {
    for (const name of readdirSync(context.dir)) {
      if (name.endsWith(".barrier.json")) {
        const file = path.join(context.dir, name);
        save(`barrier-${name}`, readFileSync(file, "utf8"));
      }
    }
  }
  const scanPath = path.join(evidenceDir,`${safeId}.${safeOp}.raw-scan.json`);
  writeFileSync(scanPath,JSON.stringify({scannedBeforeSanitizing:true,observations:rawObservations},null,2));
  paths.push(path.relative(output,scanPath));
  return paths;
}

function scanRawForCanaries(context, stdout = "", stderr = "") {
  const values = canarySet(context.seed);
  const leaked = [];
  const check = (text, source) => {
    const matches = scanForCanaries(text, values);
    if (matches.length > 0) leaked.push({ source, count: matches.length });
  };
  if (stdout) check(stdout, "stdout");
  if (stderr) check(stderr, "stderr");
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "evidence") walk(file);
      } else if (entry.isFile()) {
        let contents = "";
        try { contents = readFileSync(file, "utf8"); } catch { continue; }
        const matches = scanForCanaries(contents, values);
        if (matches.length > 0) leaked.push({ source: path.relative(context.dir, file), count: matches.length });
      }
    }
  };
  walk(context.dir);
  return leaked;
}

async function worker(operation, context, output, args = [], options = {}) {
  const resultFile = path.join(context.dir, `${operation}.result.json`);
  const environment = childEnv(context, {
    CHAOS_BUILD_DIR: BUILD,
    CHAOS_CASE_DIR: context.dir,
    CHAOS_RESULT_FILE: resultFile,
    CHAOS_SEED: String(context.seed),
    GRETEL_API_TOKEN: `synthetic-api-token-${context.seed}`,
    ...options.env
  });
  const child = spawn(process.execPath, [WORKER, operation, ...args], {
    cwd: ROOT,
    env: environment,
    // logger.ts exits on stdin EOF; keep an owned pipe open until teardown so
    // an awaited fixture cannot be mistaken for a desktop shutdown.
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const close = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill("SIGKILL");
  }, options.timeoutMs || 15_000);
  if (options.waitForBarrier) {
    await waitForFile(path.join(context.dir, options.waitForBarrier), options.barrierTimeoutMs || 3_000);
  }
  if (options.killAfterBarrier) {
    if (!child.killed) child.kill("SIGKILL");
  }
  const ended = await close;
  clearTimeout(timer);
  let result;
  if (existsSync(resultFile)) {
    try { result = JSON.parse(readFileSync(resultFile, "utf8")); } catch {}
  }
  const rawLeaks = scanRawForCanaries(context, stdout, stderr);
  const evidence = writeEvidence(output, context.id, operation, context, stdout, stderr, result);
  return { ...ended, timedOut, result, stdout, stderr, evidence, rawLeaks };
}

function caseResult(id, criterion, status, startedAt, evidence, reason, metrics = {}) {
  const seed = metrics.seed || 0;
  const sanitizedReason = reason !== undefined ? sanitize(String(reason), seed) : undefined;
  return normalizeCase({
    id, criterion, status, durationMs: Math.max(0, Date.now() - startedAt),
    evidence, reason: sanitizedReason, metrics
  });
}

async function processKillCases(args, cases) {
  const count = args.mode === "full" ? 10 : 2;
  for (let index = 0; index < count; index += 1) {
    const caseSeed = args.seed + index * 7919;
    const id = `chaos.process-kill.seed-${caseSeed}`;
    const started = Date.now();
    const context = makeCase(cases.runRoot, id);
    context.seed = caseSeed;
    const seeded = await worker("profile-seed", context, args.output, [], {
      env: { CHAOS_HOLD: "1" }, waitForBarrier: "write-committed.barrier.json", killAfterBarrier: true
    });
    const verified = await worker("profile-verify", context, args.output, [], { timeoutMs: 10_000 });
    const barrier = existsSync(path.join(context.dir, "write-committed.barrier.json"));
    const good = barrier && seeded.signal === "SIGKILL" && verified.result?.ok === true;
    const evidence = [...seeded.evidence, ...verified.evidence];
    cases.items.push(caseResult(id, "process kill after acknowledged committed application write preserves profile/history/feed state", good ? "pass" : "fail", started, evidence, good ? undefined : "The owned child did not reach the acknowledged write barrier or restart verification failed.", { seed: caseSeed, barrier, restart: verified.result || null }));
  }
}

async function networkCases(args, cases) {
  const modes = args.mode === "full"
    ? ["429", "500", "timeout", "reset", "partial", "malformed", "wrong-length", "nan", "success"]
    : ["429", "reset", "partial", "nan", "success"];
  for (const mode of modes) {
    const id = `chaos.network.${mode}`;
    const started = Date.now();
    const context = makeCase(cases.runRoot, id);
    context.seed = args.seed + modes.indexOf(mode) + 100;
    const run = await worker("network", context, args.output, [mode], { timeoutMs: 12_000 });
    const result = run.result || {};
    const expected = mode === "success" ? result.succeeded === true : result.ok === true && Boolean(result.errorClass);
    const bounded = Number(result.requestCount) >= 1 && Number(result.requestCount) <= 3;
    const good = run.code === 0 && result.ok === true && bounded && expected;
    cases.items.push(caseResult(id, `provider-component fixture ${mode} has bounded behavior and recovers without hanging`, good ? "pass" : "fail", started, run.evidence, good ? undefined : `Observed fixture result did not meet the bounded ${mode} expectation.`, { seed: context.seed, mode, requestCount: result.requestCount, errorClass: result.errorClass, bounded }));
  }
  const id = "chaos.network.in-flight-kill";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 190;
  const run = await worker("network-hold", context, args.output, [], { env: { CHAOS_HOLD: "1" }, waitForBarrier: "provider-in-flight.barrier.json", killAfterBarrier: true, timeoutMs: 8_000 });
  const restarted = await worker("profile-verify", context, args.output, [], { timeoutMs: 10_000 });
  const good = existsSync(path.join(context.dir, "provider-in-flight.barrier.json")) && run.signal === "SIGKILL" && restarted.result?.ok === true;
  cases.items.push(caseResult(id, "kill during provider response leaves isolated process and prior data recoverable", good ? "pass" : "blocked", started, [...run.evidence, ...restarted.evidence], good ? undefined : "No event-driven provider in-flight acknowledgement was observed before bounded teardown.", { seed: context.seed, barrier: existsSync(path.join(context.dir, "provider-in-flight.barrier.json")), restart: restarted.result || null }));

  const cacheId = "chaos.cache.thumbnail-write-in-flight";
  const cacheStarted = Date.now();
  const cacheContext = makeCase(cases.runRoot, cacheId);
  cacheContext.seed = args.seed + 191;
  const cacheRun = await worker("thumbnail-hold", cacheContext, args.output, [], { env: { CHAOS_HOLD: "1" }, waitForBarrier: "thumbnail-write-in-flight.barrier.json", killAfterBarrier: true, timeoutMs: 8_000 });
  const cacheChecked = await worker("thumbnail-verify", cacheContext, args.output, [], { timeoutMs: 8_000 });
  const cacheGood = existsSync(path.join(cacheContext.dir, "thumbnail-write-in-flight.barrier.json")) && cacheRun.signal === "SIGKILL" && cacheChecked.result?.ok === true;
  cases.items.push(caseResult(cacheId, "kill during thumbnail disk write leaves no partial or corrupted cache file", cacheGood ? "pass" : "blocked", cacheStarted, [...cacheRun.evidence, ...cacheChecked.evidence], cacheGood ? undefined : "No event-driven thumbnail disk write acknowledgement was observed before bounded teardown.", { seed: cacheContext.seed, barrier: existsSync(path.join(cacheContext.dir, "thumbnail-write-in-flight.barrier.json")), verify: cacheChecked.result || null }));
}

async function feedRefreshCases(args, cases) {
  const id = "chaos.feed.failed-refresh-preserves-prior-feed";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 250;
  const seeded = await worker("feed-refresh-seed", context, args.output, [], { timeoutMs: 12_000 });
  const samePoolContext = makeCase(cases.runRoot,"chaos.feed.same-pool-failure");samePoolContext.seed=args.seed+251;
  const samePoolSeed = await worker("feed-refresh-seed",samePoolContext,args.output,[],{timeoutMs:12000});
  const samePool = await worker("same-pool-fault", samePoolContext, args.output, [], {timeoutMs:12000});
  cases.items.push(caseResult("chaos.feed.same-pool-failure", "Same active pool retains exact nodes after acknowledged candidate response and embedding failure", samePool.result?.ok ? "pass" : "fail", started, [...samePoolSeed.evidence,...samePool.evidence], samePool.result?.ok ? undefined : "Same-pool fault boundary or exact preservation assertion failed", {result:samePool.result}));
  const faulted = await worker("feed-refresh-fault", context, args.output, [], { timeoutMs: 12_000 });
  const recovered = await worker("feed-refresh-recover", context, args.output, [], { timeoutMs: 12_000 });
  const good = seeded.result?.ok === true && faulted.result?.ok === true && recovered.result?.ok === true;
  const evidence = [...seeded.evidence, ...faulted.evidence, ...recovered.evidence];
  cases.items.push(caseResult(id, "failed different-pool build preserves the original pool across source-module worker restart and recovers on retry", good ? "pass" : "fail", started, evidence, good ? undefined : "Feed refresh fault corrupted prior feed or failed to recover upon retry.", { seed: context.seed, seedResult: seeded.result, faultResult: faulted.result, recoverResult: recovered.result }));
}

async function configCases(args, cases) {
  const modes = ["malformed-config", "absent-config", "invalid-types", "malformed-settings", "malformed-pool", "corrupt-sqlite"];
  for (const mode of modes) {
    const id = `chaos.config.${mode}`;
    const started = Date.now();
    const context = makeCase(cases.runRoot, id);
    context.seed = args.seed + modes.indexOf(mode) + 300;
    const prerequisite = mode === "corrupt-sqlite"
      ? await worker("db-fault", context, args.output, ["seed"], { timeoutMs: 10_000 })
      : null;
    const run = await worker("config", context, args.output, [mode], { timeoutMs: 10_000 });
    const result = run.result || {};
    const status = result.ok === true && run.code === 0 ? "pass" : "fail";
    const reason = status === "pass" ? undefined : "Corrupt configuration/cache did not meet the safe-default or explicit-recovery assertion.";
    cases.items.push(caseResult(id, `recover from ${mode} without crash-loop or silent reset`, status, started, [...(prerequisite?.evidence || []), ...run.evidence], reason, { seed: context.seed, ...result }));
  }

  // Dedicated behavioral settings-crash case
  const crashId = "chaos.config.settings-crash";
  const crashStarted = Date.now();
  const crashContext = makeCase(cases.runRoot, crashId);
  crashContext.seed = args.seed + 350;
  const crashHold = await worker("settings-hold", crashContext, args.output, ["production"], {
    env: { CHAOS_HOLD: "1" },
    waitForBarrier: "settings-write.barrier.json",
    killAfterBarrier: true,
    timeoutMs: 8_000
  });
  const barrier = existsSync(path.join(crashContext.dir, "settings-write.barrier.json"));
  let verified = null;
  if (barrier && crashHold.signal === "SIGKILL") {
    verified = await worker("settings-verify", crashContext, args.output, [], { timeoutMs: 5_000 });
  }
  const good = barrier && verified?.result?.ok === true;
  const reason = good
    ? undefined
    : !barrier
      ? "Settings write barrier was not reached before bounded teardown."
      : `Interrupted in-place settings write lost data; getUserSettings() returned empty/corrupt state: ${JSON.stringify(verified?.result?.recovered)}`;
  cases.items.push(caseResult(crashId, "interrupted settings write preserves old or new valid state", good ? "pass" : "fail", crashStarted, [...crashHold.evidence, ...(verified?.evidence || [])], reason, { seed: crashContext.seed, barrier, recovered: verified?.result?.recovered }));

  // Database faults: testing both observation of fault AND recovery after fault release
  const id = "chaos.database.faults";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 390;
  const seeded = await worker("db-fault", context, args.output, ["seed"], { timeoutMs: 10_000 });
  const readonly = await worker("db-fault", context, args.output, ["readonly-check"], { timeoutMs: 10_000 });
  const recoveredRo = await worker("db-fault", context, args.output, ["readonly-recover"], { timeoutMs: 10_000 });
  const busy = await worker("db-fault", context, args.output, ["busy"], { timeoutMs: 12_000 });
  const dbGood = readonly.result?.observed === true && recoveredRo.result?.recovered === true &&
    busy.result?.observed === true && busy.result?.recovered === true;
  cases.items.push(caseResult(id, "owned read-only and SQLite busy faults are observed and recovered without host storage damage", dbGood ? "pass" : "fail", started, [...seeded.evidence, ...readonly.evidence, ...recoveredRo.evidence, ...busy.evidence], dbGood ? undefined : "A contained database fault was not observed or failed to recover upon lock/permission release.", { seed: context.seed, readonly: readonly.result, recoveredRo: recoveredRo.result, busy: busy.result }));
}

async function authCases(args, cases) {
  const id = "chaos.api.auth";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 400;
  const run = await worker("api-auth", context, args.output, [], { timeoutMs: 15_000 });
  const good = run.result?.ok === true && run.code === 0;
  cases.items.push(caseResult(id, "all sensitive production route handlers reject missing or incorrect token without mutation", good ? "pass" : "fail", started, run.evidence, good ? undefined : "At least one sensitive route did not return the expected 401 for an incorrect token.", { seed: context.seed, ...run.result }));
}

async function privacyCases(args, cases) {
  const id = "chaos.privacy.canary";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 500;
  const run = await worker("privacy", context, args.output, [], { timeoutMs: 10_000 });
  const rawLeaks = scanRawForCanaries(context, run.stdout, run.stderr);
  const good = run.code === 0 && rawLeaks.length === 0;
  cases.items.push(caseResult(id, "synthetic secrets are absent from logs, stdout, and saved diagnostic evidence", good ? "pass" : "fail", started, run.evidence, good ? undefined : `Synthetic canary appeared in ${rawLeaks.length} owned runtime artifact(s); free-text/error privacy redaction is incomplete.`, { seed: context.seed, leakedArtifacts: rawLeaks.length, leakSources: rawLeaks.map((l) => l.source) }));
}

async function concurrencyCases(args, cases) {
  const id = "chaos.concurrency.build-reset";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 600;
  const run = await worker("concurrency", context, args.output, [], { timeoutMs: 15_000 });
  const status = run.result?.barrier ? (run.result.ok ? "pass" : "fail") : "blocked";
  cases.items.push(caseResult(id, "20 same-profile builds and destructive operation have acknowledged in-flight serialization and profile deletion remains durable", status, started, run.evidence, status === "pass" ? undefined : run.result?.barrier ? "Concurrent production build requests exposed duplicate provider work; deletion succeeded and no stale resurrection was observed." : "No deterministic provider boundary acknowledgement was available for the in-flight build workload.", { seed: context.seed, ...run.result }));
}

async function diagnosticsCases(args, cases) {
  const id = "chaos.diagnostics.bundle";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 700;
  const run = await worker("diagnostics", context, args.output, [], { timeoutMs: 10_000 });
  cases.items.push(caseResult(id, "user-obtainable diagnostics capability is a sanitized support bundle or explicit gate", "blocked", started, run.evidence, "No user-obtainable sanitized support bundle/action exists; the local /diagnostics page exposes performance analytics only. A sanitized test evidence bundle is not a user support path.", { seed: context.seed, ...run.result }));
}

function unavailableCases(args, cases) {
  const gaps = [
    ["chaos.process-kill.before-commit", "kill at real application BEGIN before COMMIT has deterministic transaction barrier", "The production profile store exposes no test-only BEGIN/before-COMMIT acknowledgement; a toy SQLite transaction would not satisfy this gate."],
    ["chaos.database.enospc", "contained SQLITE_ENOSPC injection is observed without host disk pressure", "No owned filesystem or disposable storage fault injector is available in this environment; host disk exhaustion is prohibited, so this required gate remains blocked."],
    ["chaos.browser.feed-preservation", "browser-visible prior feed remains after failed refresh", "Playwright/browser harness is not installed in this worktree; HTTP/module evidence cannot assert rendered UI preservation or inert fetched HTML."],
  ];
  for (const [id, criterion, reason] of gaps) {
    const started = Date.now();
    cases.items.push(caseResult(id, criterion, "blocked", started, [], reason, { seed: args.seed }));
  }
}

async function negativeCases(args, cases) {
  // Negative control: atomic settings write fixture (demonstrates that atomic writes pass where non-atomic fail)
  const atomicId = "chaos.runner.settings-atomic-control";
  const atomicStarted = Date.now();
  const atomicContext = makeCase(cases.runRoot, atomicId);
  atomicContext.seed = args.seed + 780;
  const atomicHold = await worker("settings-hold", atomicContext, args.output, ["atomic-fixture"], {
    env: { CHAOS_HOLD: "1", CHAOS_SETTINGS_ATOMIC: "1" },
    waitForBarrier: "settings-write.barrier.json",
    killAfterBarrier: true,
    timeoutMs: 8_000
  });
  const atomicBarrier = existsSync(path.join(atomicContext.dir, "settings-write.barrier.json"));
  let atomicVerified = null;
  if (atomicBarrier && atomicHold.signal === "SIGKILL") {
    atomicVerified = await worker("settings-verify", atomicContext, args.output, [], { timeoutMs: 5_000 });
  }
  const atomicPass = atomicBarrier && atomicVerified?.result?.ok === true;
  cases.items.push(caseResult(atomicId, "negative control: atomic temp-file settings write preserves valid state after interruption", atomicPass ? "pass" : "fail", atomicStarted, [...atomicHold.evidence, ...(atomicVerified?.evidence || [])], atomicPass ? undefined : "Atomic settings negative control failed to recover valid settings.", { seed: atomicContext.seed, barrier: atomicBarrier, recovered: atomicVerified?.result?.recovered }));

  // Runner negative controls
  const id = "chaos.runner.negative";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 800;
  const failed = await worker("negative-fail", context, args.output, [], { timeoutMs: 5_000 });
  const cancelContext = makeCase(cases.runRoot, `${id}.cancel`);
  cancelContext.seed = context.seed + 1;
  const cancelled = await worker("negative-hold", cancelContext, args.output, [], { waitForBarrier: "negative-cancellation.barrier.json", killAfterBarrier: true, timeoutMs: 5_000 });
  const missingPrerequisite = !existsSync(path.join(ROOT, "tests/release/chaos/fixtures/does-not-exist.json"));
  const good = failed.code !== 0 && existsSync(path.join(cancelContext.dir, "negative-cancellation.barrier.json")) && cancelled.signal === "SIGKILL" && missingPrerequisite;
  cases.items.push(caseResult(id, "runner observes intentional failure, missing prerequisite, and cancellation as non-passing states", good ? "pass" : "fail", started, [...failed.evidence, ...cancelled.evidence], good ? undefined : "Runner negative fixture did not produce the expected bounded failure/cleanup observation.", { seed: context.seed, intentionalExit: failed.code, cancelled: cancelled.signal, missingPrerequisite }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.output = safeOutputDirectory(args.output);
  compileModules();
  const runRoot = makeRunRoot(`gretel-chaos-${args.seed}-`);
  const cases = { runRoot, items: [] };
  const startedAt = new Date().toISOString();
  await processKillCases(args, cases);
  await networkCases(args, cases);
  await feedRefreshCases(args, cases);
  await configCases(args, cases);
  await authCases(args, cases);
  await privacyCases(args, cases);
  await concurrencyCases(args, cases);
  await diagnosticsCases(args, cases);
  unavailableCases(args, cases);
  await negativeCases(args, cases);
  const finishedAt = new Date().toISOString();
  const gitSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const dirty = Boolean(spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" }).stdout.trim());
  const report = {
    schemaVersion: 1,
    executionToken: process.env.GRETEL_VERIFICATION_TOKEN || null,
    layer: "chaos",
    runId: `chaos-${args.seed}-${Date.now()}`,
    startedAt,
    finishedAt,
    gitSha,
    dirty,
    seed: args.seed,
    platform: process.platform,
    architecture: process.arch,
    mode: args.mode,
    strict: args.strict,
    artifact: getChaosSourceIdentity(ROOT),
    thresholds: { fullProcessKillSeeds: 10, maxNetworkAttempts: 3, concurrentBuilds: 20 },
    cases: cases.items.map(categorizeCase)
  };
  writeFileSync(path.join(args.output, "report.json"), sanitize(JSON.stringify(report, null, 2), args.seed).replace(/synthetic-(initial|updated)-key-[0-9]+/g, "[REDACTED_SYNTHETIC_KEY]"));
  const failing = cases.items.filter((item) => item.status !== "pass");
  process.stdout.write(`CHAOS report: ${cases.items.length} cases; ${cases.items.length - failing.length} pass; ${failing.length} fail/blocked\n`);
  if (failing.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`CHAOS runner failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 2;
});
