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
const minBatch = readIntegerArgument("min-batch", 1);
const maxBatch = readIntegerArgument("max-batch", 8);
const trials = readIntegerArgument("trials", 3);
const pauseMs = readIntegerArgument("pause-ms", 250);
const dimensions = readIntegerListArgument("dimensions", [embeddingConfig.dimensions]);
const benchmarkInputs = [
  "Introduction to Distributed Systems\nMartin Kleppmann\ndistributed systems",
  "Consensus Algorithms Explained: Raft and Paxos\nComputerphile\ndistributed systems",
  "Designing Data-Intensive Applications\nEngineering Talks\ndatabase architecture",
  "Rust Ownership and Borrowing in Practice\nSystems Academy\nRust programming",
  "How Large Language Model Inference Works\nML Systems\nmachine learning",
  "Building Reliable Event-Driven Systems\nBackend Engineering\nevent streaming",
  "Database Indexes and Query Planning\nComputer Science\ndatabase performance",
  "Observability for Distributed Applications\nCloud Native Engineering\nproduction monitoring"
];

if (!apiKey) {
  throw new Error(
    `Missing OpenRouter key in ${embeddingConfig.openRouterApiKeyEnv} or OPENROUTER_KEY.`
  );
}

if (minBatch < 1 || maxBatch < minBatch || maxBatch > benchmarkInputs.length) {
  throw new Error(
    `Batch range must satisfy 1 <= --min-batch <= --max-batch <= ${benchmarkInputs.length}.`
  );
}

console.log("Gretel live embedding benchmark");
console.log(JSON.stringify({
  model: embeddingConfig.model,
  dimensions,
  minBatch,
  maxBatch,
  trials,
  pauseMs
}, null, 2));

console.log("\nWarm-up request (excluded from results)...");
await embed(benchmarkInputs.slice(0, 1), dimensions[0]);

const batchSizes = Array.from(
  { length: maxBatch - minBatch + 1 },
  (_, index) => minBatch + index
);
const samples = new Map();

for (const dimension of dimensions) {
  for (const batchSize of batchSizes) {
    samples.set(sampleKey(dimension, batchSize), []);
  }
}

for (let trial = 0; trial < trials; trial += 1) {
  const sizes = trialOrder(trial, batchSizes);
  const trialDimensions = trial % 2 === 0 ? dimensions : [...dimensions].reverse();

  for (const dimension of trialDimensions) {
    for (const batchSize of sizes) {
      await delay(pauseMs);
      const startedAt = performance.now();
      const vectors = await embed(benchmarkInputs.slice(0, batchSize), dimension);
      const durationMs = performance.now() - startedAt;

      samples.get(sampleKey(dimension, batchSize)).push(durationMs);
      console.log(
        `trial=${trial + 1} dimensions=${dimension} batch=${batchSize} vectors=${vectors.length} durationMs=${durationMs.toFixed(1)}`
      );
    }
  }
}

const results = dimensions.flatMap((dimension) => batchSizes.map((batchSize) => {
    const durations = samples.get(sampleKey(dimension, batchSize));
    const sorted = [...durations].sort((left, right) => left - right);
    const medianMs = median(sorted);

    return {
      dimensions: dimension,
      batchSize,
      trials: durations.length,
      minMs: round(sorted[0]),
      medianMs: round(medianMs),
      maxMs: round(sorted.at(-1)),
      medianMsPerEmbedding: round(medianMs / batchSize),
      medianEmbeddingsPerSecond: round(batchSize / (medianMs / 1000))
    };
  }));

console.log("\nResults (request latency includes network + OpenRouter inference):");
console.table(results);

async function embed(inputs, requestedDimensions) {
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
          input: inputs,
          dimensions: requestedDimensions
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`OpenRouter embedding request failed with ${response.status}`);
    }

    const payload = await response.json();
    const vectors = [...(payload.data || [])].sort(
      (left, right) => (left.index ?? 0) - (right.index ?? 0)
    );

    if (vectors.length !== inputs.length) {
      throw new Error(`Expected ${inputs.length} vectors, received ${vectors.length}.`);
    }

    for (const [index, item] of vectors.entries()) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== requestedDimensions) {
        throw new Error(
          `Vector ${index} has ${item.embedding?.length || 0} dimensions; expected ${requestedDimensions}.`
        );
      }
    }

    return vectors;
  } finally {
    clearTimeout(timeout);
  }
}

function trialOrder(trial, sizes) {
  const ascending = [...sizes];

  if (trial % 3 === 0) {
    return ascending;
  }

  if (trial % 3 === 1) {
    return ascending.reverse();
  }

  return [...ascending.filter((size) => size % 2 === 0).reverse(), ...ascending.filter((size) => size % 2 === 1)];
}

function sampleKey(dimensions, batchSize) {
  return `${dimensions}:${batchSize}`;
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readIntegerArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }

  return parsed;
}

function readIntegerListArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

  if (raw === undefined) {
    return fallback;
  }

  const values = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));

  if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error(`--${name} must be a comma-separated list of positive integers.`);
  }

  return [...new Set(values)];
}

function loadEnv(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    const value = match[2].trim();
    process.env[match[1]] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value.replace(/\s+#.*$/, "");
  }
}
