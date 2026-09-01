#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const concurrency = 13;
const expectedStatus = 401;
const attempts = 2;
const minNodeMajor = 24;

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "", 10);
if (nodeMajor < minNodeMajor) {
  console.error(
    `Bundled Node runtime must be >= v${minNodeMajor}; received ${process.versions.node}.`
  );
  process.exit(1);
}

if (process.argv.includes("--probe")) {
  const results = await Promise.all(
    Array.from({ length: concurrency }, async (_, index) => {
      const startedAt = performance.now();

      try {
        const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: "Bearer gretel-packaging-smoke-test-invalid",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "qwen/qwen3-embedding-8b",
            input: Array.from({ length: 16 }, () => "Gretel packaged-runtime network smoke test"),
            dimensions: 1024
          }),
          signal: AbortSignal.timeout(15_000)
        });
        await response.body?.cancel();

        return {
          index,
          ok: response.status === expectedStatus,
          status: response.status,
          totalMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        return {
          index,
          ok: false,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCode: getErrorCode(error),
          totalMs: Math.round(performance.now() - startedAt)
        };
      }
    })
  );

  console.log(JSON.stringify(results));
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
} else {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe"], {
      encoding: "utf8",
      timeout: 30_000
    });
    const output = result.stdout.trim();

    if (result.status === 0) {
      console.log(`Bundled Node network smoke test passed (${concurrency}/${concurrency}, attempt ${attempt}).`);
      process.exit(0);
    }

    console.error(`Bundled Node network smoke test failed on attempt ${attempt}.`);
    if (output) console.error(output);
    if (result.stderr.trim()) console.error(result.stderr.trim());

    if (attempt < attempts) {
      await delay(1_000);
    }
  }

  process.exit(1);
}

function getErrorCode(error) {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }

  const cause = error.cause;
  return cause && typeof cause === "object" && "code" in cause
    ? String(cause.code)
    : undefined;
}
