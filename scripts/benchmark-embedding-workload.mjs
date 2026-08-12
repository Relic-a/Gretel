import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = process.cwd();
loadEnv(path.join(repoRoot, ".env"));

const config = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "gretel.config.json"), "utf8")
);
const embeddingConfig = config.embeddings;
const apiKey = process.env[embeddingConfig.openRouterApiKeyEnv] || process.env.OPENROUTER_KEY || "";
const dimensions = readIntegerArgument("dimensions", 1024);
const itemCount = readIntegerArgument("items", 100);
const pauseMs = readIntegerArgument("pause-ms", 1000);
const cases = readCasesArgument("cases", [
  { batchSize: 1, concurrency: 100 },
  { batchSize: 4, concurrency: 25 },
  { batchSize: 8, concurrency: 13 },
  { batchSize: 16, concurrency: 7 }
]);

if (!apiKey) {
  throw new Error(
    `Missing OpenRouter key in ${embeddingConfig.openRouterApiKeyEnv} or OPENROUTER_KEY.`
  );
}

const inputs = buildInputs(itemCount);
const results = [];

console.log("Gretel fixed-workload embedding benchmark");
console.log(JSON.stringify({
  model: embeddingConfig.model,
  dimensions,
  itemCount,
  retries: 0,
  cases
}, null, 2));

console.log("\nWarm-up request (excluded from results)...");
await embed(inputs.slice(0, 1));

for (const testCase of cases) {
  await delay(pauseMs);
  const batches = chunk(inputs, testCase.batchSize);
  const startedAt = performance.now();
  const requestResults = await runPool(batches, testCase.concurrency, async (batch) => {
    const requestStartedAt = performance.now();

    try {
      await embed(batch);
      return {
        ok: true,
        itemCount: batch.length,
        durationMs: performance.now() - requestStartedAt
      };
    } catch (error) {
      return {
        ok: false,
        itemCount: batch.length,
        durationMs: performance.now() - requestStartedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  const wallMs = performance.now() - startedAt;
  const successful = requestResults.filter((result) => result.ok);
  const failed = requestResults.filter((result) => !result.ok);
  const requestDurations = successful.map((result) => result.durationMs).sort((a, b) => a - b);
  const errors = Object.entries(groupCounts(failed.map((result) => result.error))).map(
    ([error, count]) => `${count}x ${error}`
  ).join("; ");
  const successfulItems = successful.reduce((sum, result) => sum + result.itemCount, 0);

  const row = {
    batchSize: testCase.batchSize,
    concurrency: Math.min(testCase.concurrency, batches.length),
    requests: batches.length,
    successfulItems,
    failedRequests: failed.length,
    wallMs: round(wallMs),
    itemsPerSecond: round(successfulItems / (wallMs / 1000)),
    requestP50Ms: percentile(requestDurations, 0.5),
    requestP95Ms: percentile(requestDurations, 0.95),
    requestMaxMs: requestDurations.length ? round(requestDurations.at(-1)) : null,
    errors: errors || ""
  };

  results.push(row);
  console.log(`case complete: ${JSON.stringify(row)}`);
}

console.log("\nResults (each row embeds the same fixed workload):");
console.table(results);

async function embed(batch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), embeddingConfig.requestTimeoutMs);

  try {
    const response = await fetch(
      `${embeddingConfig.openRouterBaseUrl.replace(/\/$/, "")}/embeddings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(process.env[embeddingConfig.openRouterSiteUrlEnv]
            ? { "HTTP-Referer": process.env[embeddingConfig.openRouterSiteUrlEnv] }
            : {}),
          ...(process.env[embeddingConfig.openRouterAppNameEnv]
            ? { "X-Title": process.env[embeddingConfig.openRouterAppNameEnv] }
            : {})
        },
        body: JSON.stringify({
          model: embeddingConfig.model,
          input: batch,
          dimensions
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`HTTP ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ""}`);
    }

    const payload = await response.json();
    const vectors = payload.data || [];

    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} vectors, received ${vectors.length}`);
    }

    if (vectors.some((item) => item.embedding?.length !== dimensions)) {
      throw new Error(`Provider returned a vector with unexpected dimensions`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
  return results;
}

function buildInputs(count) {
  const subjects = [
    "distributed consensus", "database indexing", "Rust ownership", "ML inference",
    "event streaming", "cloud observability", "network protocols", "query optimization",
    "container orchestration", "fault-tolerant storage"
  ];

  return Array.from({ length: count }, (_, index) =>
    `Technical lesson ${index + 1}: ${subjects[index % subjects.length]} — practical concepts, architecture, tradeoffs, and production examples.`
  );
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(fraction * sortedValues.length) - 1;
  return round(sortedValues[Math.max(0, index)]);
}

function groupCounts(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function readCasesArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;

  const parsed = raw.split(",").map((entry) => {
    const [batchSize, concurrency] = entry.split(":").map(Number);
    if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`--${name} entries must use positive batch:concurrency pairs`);
    }
    return { batchSize, concurrency };
  });
  return parsed;
}

function readIntegerArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be positive`);
  return parsed;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function loadEnv(envPath) {
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value.replace(/\s+#.*$/, "");
  }
}
