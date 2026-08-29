import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

const root = process.cwd();
const buildDir = path.join(root, ".tmp", "network-retry-test");

rmSync(buildDir, { force: true, recursive: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const result = spawnSync(process.execPath, [
  path.join(root, "node_modules", "typescript", "lib", "tsc.js"),
  "--outDir", buildDir,
  "--module", "commonjs",
  "--target", "ES2022",
  "--ignoreConfig",
  "--ignoreDeprecations", "6.0",
  "--skipLibCheck",
  "--types", "node",
  "lib/network-retry.ts"
], { cwd: root, encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);

const require = createRequire(import.meta.url);
const { fetchWithNetworkRetry } = require(path.join(buildDir, "network-retry.js"));

test("retries transport failures with exponential backoff", async () => {
  let calls = 0;
  const delays = [];
  const response = new Response(null, { status: 200 });

  const value = await fetchWithNetworkRetry("https://example.test", {}, {
    timeoutMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
      }
      return response;
    },
    sleep: async (delayMs) => delays.push(delayMs)
  });

  assert.equal(value, response);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("does not retry HTTP responses or non-network errors", async () => {
  let httpCalls = 0;
  const httpResponse = await fetchWithNetworkRetry("https://example.test", {}, {
    timeoutMs: 1_000,
    fetchImpl: async () => {
      httpCalls += 1;
      return new Response(null, { status: 429 });
    },
    sleep: async () => assert.fail("HTTP responses must not be retried")
  });

  assert.equal(httpResponse.status, 429);
  assert.equal(httpCalls, 1);

  let errorCalls = 0;
  await assert.rejects(
    fetchWithNetworkRetry("https://example.test", {}, {
      timeoutMs: 1_000,
      fetchImpl: async () => {
        errorCalls += 1;
        throw new Error("invalid request");
      },
      sleep: async () => assert.fail("Non-network errors must not be retried")
    }),
    /invalid request/
  );
  assert.equal(errorCalls, 1);
});

function fetchFailure(code) {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error(code), { code });
  return error;
}

after(() => rmSync(buildDir, { force: true, recursive: true }));
