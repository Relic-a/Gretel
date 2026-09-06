#!/usr/bin/env node
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
  return [values.raw, values.encodedBase64, values.encodedUrl]
    .filter(Boolean)
    .reduce((current, value) => current.split(value).join("[REDACTED_CANARY]"), String(text));
}

function writeEvidence(output, id, context, stdout, stderr, result) {
  const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const evidenceDir = path.join(output, "evidence");
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const paths = [];
  const save = (suffix, contents) => {
    const file = path.join(evidenceDir, `${safeId}.${suffix}`);
    writeFileSync(file, sanitize(contents, context.seed), { mode: 0o600 });
    paths.push(path.relative(output, file));
  };
  save("stdout.log", stdout);
  save("stderr.log", stderr);
  if (result !== undefined) save("result.json", JSON.stringify(result, null, 2));
  if (existsSync(context.logFile)) {
    save("gretel.log", readFileSync(context.logFile, "utf8"));
  }
  for (const name of readdirSync(context.logsDir)) {
    const file = path.join(context.logsDir, name);
    if (statSync(file).isFile() && file !== context.logFile) save(`log-${name}`, readFileSync(file, "utf8"));
  }
  return paths;
}

function scanContextForCanaries(context) {
  const values = canarySet(context.seed);
  const leaked = [];
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
        if (matches.length > 0) leaked.push(path.relative(context.dir, file));
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
  const evidence = writeEvidence(output, context.id, context, stdout, stderr, result);
  return { ...ended, timedOut, result, stdout, stderr, evidence };
}

function caseResult(id, criterion, status, startedAt, evidence, reason, metrics = {}) {
  return normalizeCase({
    id, criterion, status, durationMs: Math.max(0, Date.now() - startedAt),
    evidence, reason, metrics
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
  const modes = args.mode === "full" ? ["429", "500", "timeout", "reset", "malformed", "wrong-length", "nan", "success"] : ["429", "reset", "wrong-length", "success"];
  for (const mode of modes) {
    const id = `chaos.network.${mode}`;
    const started = Date.now();
    const context = makeCase(cases.runRoot, id);
    context.seed = args.seed + modes.indexOf(mode) + 100;
    const run = await worker("network", context, args.output, [mode], { timeoutMs: 12_000 });
    const result = run.result || {};
    const expected = mode === "success" ? result.succeeded === true : result.succeeded === false && Boolean(result.errorClass);
    const bounded = Number(result.requestCount) >= 1 && Number(result.requestCount) <= 3;
    const good = run.code === 0 && result.ok === true && bounded && expected;
    cases.items.push(caseResult(id, `provider fixture ${mode} has bounded behavior and recovers without hanging`, good ? "pass" : "fail", started, run.evidence, good ? undefined : `Observed fixture result did not meet the bounded ${mode} expectation.`, { mode, requestCount: result.requestCount, errorClass: result.errorClass, bounded }));
  }
  const id = "chaos.network.in-flight-kill";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 190;
  const run = await worker("network-hold", context, args.output, [], { env: { CHAOS_HOLD: "1" }, waitForBarrier: "provider-in-flight.barrier.json", killAfterBarrier: true, timeoutMs: 8_000 });
  const restarted = await worker("profile-verify", context, args.output, [], { timeoutMs: 10_000 });
  const good = existsSync(path.join(context.dir, "provider-in-flight.barrier.json")) && run.signal === "SIGKILL" && restarted.result?.ok === true;
  cases.items.push(caseResult(id, "kill during provider response leaves isolated process and prior data recoverable", good ? "pass" : "blocked", started, [...run.evidence, ...restarted.evidence], good ? undefined : "No event-driven provider in-flight acknowledgement was observed before bounded teardown.", { barrier: existsSync(path.join(context.dir, "provider-in-flight.barrier.json")), restart: restarted.result || null }));

  const cacheId = "chaos.cache.thumbnail-write-in-flight";
  const cacheStarted = Date.now();
  const cacheContext = makeCase(cases.runRoot, cacheId);
  cacheContext.seed = args.seed + 191;
  const cacheRun = await worker("thumbnail-hold", cacheContext, args.output, [], { env: { CHAOS_HOLD: "1" }, waitForBarrier: "thumbnail-write-in-flight.barrier.json", killAfterBarrier: true, timeoutMs: 8_000 });
  const cacheChecked = await worker("thumbnail-verify", cacheContext, args.output, [], { timeoutMs: 8_000 });
  const cacheGood = existsSync(path.join(cacheContext.dir, "thumbnail-write-in-flight.barrier.json")) && cacheRun.signal === "SIGKILL" && cacheChecked.result?.ok === true;
  cases.items.push(caseResult(cacheId, "kill during real thumbnail response leaves no partial cache file", cacheGood ? "pass" : "blocked", cacheStarted, [...cacheRun.evidence, ...cacheChecked.evidence], cacheGood ? undefined : "No event-driven thumbnail fetch acknowledgement was observed before bounded teardown.", { barrier: existsSync(path.join(cacheContext.dir, "thumbnail-write-in-flight.barrier.json")), verify: cacheChecked.result || null }));
}

async function configCases(args, cases) {
  const modes = ["malformed-config", "absent-config", "invalid-types", "malformed-settings", "malformed-pool", "settings-crash", "corrupt-sqlite"];
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
    const status = mode === "settings-crash" ? "fail" : result.ok === true && run.code === 0 ? "pass" : "fail";
    const reason = status === "pass" ? undefined : mode === "settings-crash" ? "Reproduced loss of previously valid settings after an in-place truncated JSON write; settings writes are not atomic." : "Corrupt configuration/cache did not meet the safe-default or explicit-recovery assertion.";
    cases.items.push(caseResult(id, `recover from ${mode} without crash-loop or silent reset`, status, started, [...(prerequisite?.evidence || []), ...run.evidence], reason, result));
  }
  const id = "chaos.database.faults";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 390;
  const seeded = await worker("db-fault", context, args.output, ["seed"], { timeoutMs: 10_000 });
  const readonly = await worker("db-fault", context, args.output, ["readonly-check"], { timeoutMs: 10_000 });
  const busy = await worker("db-fault", context, args.output, ["busy"], { timeoutMs: 12_000 });
  const good = readonly.result?.observed === true && busy.result?.observed === true;
  cases.items.push(caseResult(id, "owned read-only and SQLite busy faults are observed without host storage damage", good ? "pass" : "fail", started, [...seeded.evidence, ...readonly.evidence, ...busy.evidence], good ? undefined : "A contained database fault was not observed by the real profile store.", { readonly: readonly.result, busy: busy.result }));
}

async function authCases(args, cases) {
  const id = "chaos.api.auth";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 400;
  const run = await worker("api-auth", context, args.output, [], { timeoutMs: 15_000 });
  const good = run.result?.ok === true && run.code === 0;
  cases.items.push(caseResult(id, "all sensitive production route handlers reject missing or incorrect token without mutation", good ? "pass" : "fail", started, run.evidence, good ? undefined : "At least one sensitive route did not return the expected 401 for an incorrect token.", run.result));
}

async function privacyCases(args, cases) {
  const id = "chaos.privacy.canary";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 500;
  const run = await worker("privacy", context, args.output, [], { timeoutMs: 10_000 });
  const leaked = scanContextForCanaries(context);
  const good = run.code === 0 && leaked.length === 0;
  cases.items.push(caseResult(id, "synthetic secrets are absent from logs, stdout, and saved diagnostic evidence", good ? "pass" : "fail", started, run.evidence, good ? undefined : `Synthetic canary appeared in ${leaked.length} owned runtime artifact(s); free-text/error privacy redaction is incomplete.`, { leakedArtifacts: leaked.length }));
}

async function concurrencyCases(args, cases) {
  const id = "chaos.concurrency.build-reset";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 600;
  const run = await worker("concurrency", context, args.output, [], { timeoutMs: 15_000 });
  const status = run.result?.barrier ? (run.result.ok ? "pass" : "fail") : "blocked";
  cases.items.push(caseResult(id, "20 same-profile builds and destructive operation have acknowledged in-flight serialization and no stale resurrection", status, started, run.evidence, status === "pass" ? undefined : run.result?.barrier ? "Concurrent production build requests exposed duplicate work or stale-operation behavior." : "No deterministic provider boundary acknowledgement was available for the in-flight build workload.", run.result));
}

async function diagnosticsCases(args, cases) {
  const id = "chaos.diagnostics.bundle";
  const started = Date.now();
  const context = makeCase(cases.runRoot, id);
  context.seed = args.seed + 700;
  const run = await worker("diagnostics", context, args.output, [], { timeoutMs: 10_000 });
  cases.items.push(caseResult(id, "user-obtainable diagnostics capability is a sanitized support bundle or explicit gate", "blocked", started, run.evidence, "No user-obtainable sanitized support bundle/action exists; the local /diagnostics page exposes performance analytics only. A sanitized test evidence bundle is not a user support path.", run.result));
}

function unavailableCases(args, cases) {
  const gaps = [
    ["chaos.process-kill.before-commit", "kill at real application BEGIN before COMMIT has deterministic transaction barrier", "The production profile store exposes no test-only BEGIN/before-COMMIT acknowledgement; a toy SQLite transaction would not satisfy this gate."],
    ["chaos.database.enospc", "contained SQLITE_ENOSPC injection is observed without host disk pressure", "No owned filesystem or disposable storage fault injector is available in this environment; host disk exhaustion is prohibited, so this required gate remains blocked."],
    ["chaos.browser.feed-preservation", "browser-visible prior feed remains after failed refresh", "Playwright/browser harness is not installed in this worktree; HTTP/module evidence cannot assert rendered UI preservation or inert fetched HTML."],
  ];
  for (const [id, criterion, reason] of gaps) {
    const started = Date.now();
    cases.items.push(caseResult(id, criterion, "blocked", started, [], reason));
  }
}

async function negativeCases(args, cases) {
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
  cases.items.push(caseResult(id, "runner observes intentional failure, missing prerequisite, and cancellation as non-passing states", good ? "pass" : "fail", started, [...failed.evidence, ...cancelled.evidence], good ? undefined : "Runner negative fixture did not produce the expected bounded failure/cleanup observation.", { intentionalExit: failed.code, cancelled: cancelled.signal, missingPrerequisite }));
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
    artifact: { path: args.output, version: packageJson.version, sha256: await sha256(path.join(ROOT, "package.json"), { createReadStream }) },
    thresholds: { fullProcessKillSeeds: 10, maxNetworkAttempts: 3, concurrentBuilds: 20 },
    cases: cases.items
  };
  await writeJson(path.join(args.output, "report.json"), report);
  const failing = cases.items.filter((item) => item.status !== "pass");
  process.stdout.write(`CHAOS report: ${cases.items.length} cases; ${cases.items.length - failing.length} pass; ${failing.length} fail/blocked\n`);
  if (failing.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`CHAOS runner failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 2;
});
