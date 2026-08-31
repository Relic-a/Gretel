import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "logger-test");
const workDir = mkdtempSync(path.join(os.tmpdir(), "gretel-logger-test-"));
const logFile = path.join(workDir, "gretel.log");
const originalLogFile = process.env.GRETEL_LOG_FILE;
const originalLogLevel = process.env.GRETEL_LOG_LEVEL;
const originalInsightInterval = process.env.GRETEL_INSIGHT_INTERVAL;
process.env.GRETEL_LOG_FILE = logFile;
process.env.GRETEL_LOG_LEVEL = "info";
process.env.GRETEL_INSIGHT_INTERVAL = "1000000";

function compileLogger() {
  rmSync(buildDir, { force: true, recursive: true });
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
    "--outDir", buildDir,
    "--module", "commonjs",
    "--target", "ES2022",
    "--skipLibCheck",
    "--types", "node",
    "--esModuleInterop",
    "lib/logger.ts"
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

compileLogger();
const require = createRequire(import.meta.url);
const logger = require(path.join(buildDir, "logger.js"));

test("redacts sensitive fields and aggregates compact insights", async () => {
  logger.resetLogInsights();
  const circular = {};
  circular.self = circular;
  logger.logInfo("test.request", {
    apiKey: "do-not-write",
    totalMs: 42,
    operations: [{ name: "fetch", status: "ok", durationMs: 17 }],
    circular
  });
  await logger.flushLogFileWrites();

  const line = readFileSync(logFile, "utf8").trim().split("\n").at(-1);
  assert.ok(line);
  assert.doesNotMatch(line, /do-not-write/);
  assert.match(line, /\[REDACTED\]/);
  assert.match(line, /\[Circular\]/);
  const insight = logger.getLogInsights()["test.request"];
  assert.equal(insight.count, 1);
  assert.equal(insight.totalMs, 42);
  assert.equal(insight.operations.fetch.totalMs, 17);
});

test("rotation replaces destinations and retains only the configured window", async () => {
  const maxBytes = 5 * 1024 * 1024;
  writeFileSync(logFile, Buffer.alloc(maxBytes, "x"));
  writeFileSync(`${logFile}.1`, "one");
  writeFileSync(`${logFile}.2`, "two");
  writeFileSync(`${logFile}.3`, "three");

  logger.logInfo("rotation.check", { ok: true });
  await logger.flushLogFileWrites();

  assert.equal(readFileSync(`${logFile}.1`, "utf8").length, maxBytes);
  assert.equal(readFileSync(`${logFile}.2`, "utf8"), "one");
  assert.equal(readFileSync(`${logFile}.3`, "utf8"), "two");
  assert.equal(existsSync(`${logFile}.4`), false);
  assert.ok(statSync(logFile).size < maxBytes);
});

test("file write failures do not reject the logging queue", async () => {
  const directoryPath = path.join(workDir, "not-a-file");
  mkdirSync(directoryPath);
  process.env.GRETEL_LOG_FILE = directoryPath;
  logger.logInfo("write.failure", { expected: true });
  await assert.doesNotReject(logger.flushLogFileWrites());
  process.env.GRETEL_LOG_FILE = logFile;
});

after(() => {
  if (originalLogFile === undefined) delete process.env.GRETEL_LOG_FILE;
  else process.env.GRETEL_LOG_FILE = originalLogFile;
  if (originalLogLevel === undefined) delete process.env.GRETEL_LOG_LEVEL;
  else process.env.GRETEL_LOG_LEVEL = originalLogLevel;
  if (originalInsightInterval === undefined) delete process.env.GRETEL_INSIGHT_INTERVAL;
  else process.env.GRETEL_INSIGHT_INTERVAL = originalInsightInterval;
  rmSync(buildDir, { force: true, recursive: true });
  rmSync(workDir, { force: true, recursive: true });
});
