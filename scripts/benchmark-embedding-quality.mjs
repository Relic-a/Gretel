import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = process.cwd();
loadEnv(path.join(repoRoot, ".env"));

const config = JSON.parse(readFileSync(path.join(repoRoot, "config", "gretel.config.json"), "utf8"));
const corpus = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "embedding-quality-corpus.json"), "utf8")
);
const embeddingConfig = config.embeddings;
const apiKey = process.env[embeddingConfig.openRouterApiKeyEnv] || process.env.OPENROUTER_KEY || "";
const dimensions = readIntegerListArgument("dimensions", [256, 512, 1024, 2048, 4096]);
const batchSize = readIntegerArgument("batch-size", 16);
const concurrency = readIntegerArgument("concurrency", 3);
const threshold = readNumberArgument("threshold", config.feed.similarityThreshold);

if (!apiKey) {
  throw new Error(`Missing OpenRouter key in ${embeddingConfig.openRouterApiKeyEnv} or OPENROUTER_KEY.`);
}

const documents = corpus.flatMap((scenario) => [
  ...scenario.seeds.map((text, seedIndex) => ({
    id: `${scenario.name}:seed:${seedIndex}`,
    scenario: scenario.name,
    kind: "seed",
    text
  })),
  ...scenario.candidates.map((candidate, candidateIndex) => ({
    id: `${scenario.name}:candidate:${candidateIndex}`,
    scenario: scenario.name,
    kind: "candidate",
    relevant: candidate.relevant,
    text: candidate.text
  }))
]);

console.log("Gretel embedding filtering quality benchmark");
console.log(JSON.stringify({
  model: embeddingConfig.model,
  dimensions,
  scenarios: corpus.length,
  seeds: documents.filter((document) => document.kind === "seed").length,
  candidates: documents.filter((document) => document.kind === "candidate").length,
  threshold,
  batchSize,
  concurrency
}, null, 2));

const runs = new Map();

for (const dimension of dimensions) {
  const startedAt = performance.now();
  const vectors = await embedDocuments(documents, dimension);
  const durationMs = performance.now() - startedAt;
  const evaluation = evaluate(vectors);
  runs.set(dimension, { vectors, durationMs, ...evaluation });
  console.log(`dimensions=${dimension} embedded=${vectors.size} durationMs=${durationMs.toFixed(1)}`);
}

const baselineDimension = Math.max(...dimensions);
const baseline = runs.get(baselineDimension);
const summary = dimensions.map((dimension) => {
  const run = runs.get(dimension);
  const comparison = compareWithBaseline(run, baseline);

  return {
    dimensions: dimension,
    durationMs: round(run.durationMs),
    precision: round(run.metrics.precision, 3),
    recall: round(run.metrics.recall, 3),
    f1: round(run.metrics.f1, 3),
    accuracy: round(run.metrics.accuracy, 3),
    auc: round(run.metrics.auc, 3),
    meanPrecisionAt6: round(run.metrics.meanPrecisionAt6, 3),
    relevantMean: round(run.metrics.relevantMean, 3),
    irrelevantMean: round(run.metrics.irrelevantMean, 3),
    decisionChangesVsBaseline: comparison.decisionChanges,
    meanTop6OverlapVsBaseline: round(comparison.meanTop6Overlap, 3),
    scoreMaeVsBaseline: round(comparison.scoreMae, 4)
  };
});

console.log(`\nAggregate quality (baseline=${baselineDimension} dimensions):`);
console.table(summary);

console.log("\nPer-scenario filtering metrics:");
console.table(dimensions.flatMap((dimension) =>
  runs.get(dimension).scenarioMetrics.map((metrics) => ({ dimensions: dimension, ...metrics }))
));

function evaluate(vectors) {
  const predictions = new Map();
  const scenarioMetrics = [];
  const allRows = [];

  for (const scenario of corpus) {
    const seedVectors = scenario.seeds.map((_text, index) => vectors.get(`${scenario.name}:seed:${index}`));
    const centroid = averageNormalizedVectors(seedVectors);
    const rows = scenario.candidates.map((candidate, index) => {
      const id = `${scenario.name}:candidate:${index}`;
      const score = cosineSimilarity(vectors.get(id), centroid);
      const predictedRelevant = score >= threshold;
      const row = { id, scenario: scenario.name, relevant: candidate.relevant, predictedRelevant, score };
      predictions.set(id, row);
      return row;
    });
    allRows.push(...rows);
    const metrics = classificationMetrics(rows);
    const ranked = [...rows].sort((left, right) => right.score - left.score);
    scenarioMetrics.push({
      scenario: scenario.name,
      precision: round(metrics.precision, 3),
      recall: round(metrics.recall, 3),
      f1: round(metrics.f1, 3),
      auc: round(auc(rows), 3),
      precisionAt6: round(ranked.slice(0, 6).filter((row) => row.relevant).length / 6, 3),
      admitted: rows.filter((row) => row.predictedRelevant).length
    });
  }

  const metrics = classificationMetrics(allRows);
  const relevantScores = allRows.filter((row) => row.relevant).map((row) => row.score);
  const irrelevantScores = allRows.filter((row) => !row.relevant).map((row) => row.score);

  return {
    predictions,
    scenarioMetrics,
    metrics: {
      ...metrics,
      auc: auc(allRows),
      meanPrecisionAt6: mean(scenarioMetrics.map((item) => item.precisionAt6)),
      relevantMean: mean(relevantScores),
      irrelevantMean: mean(irrelevantScores)
    }
  };
}

function compareWithBaseline(run, baseline) {
  let decisionChanges = 0;
  let scoreDifference = 0;

  for (const [id, prediction] of run.predictions) {
    const baselinePrediction = baseline.predictions.get(id);
    decisionChanges += prediction.predictedRelevant !== baselinePrediction.predictedRelevant ? 1 : 0;
    scoreDifference += Math.abs(prediction.score - baselinePrediction.score);
  }

  const overlaps = corpus.map((scenario) => {
    const ids = scenario.candidates.map((_candidate, index) => `${scenario.name}:candidate:${index}`);
    const topIds = (predictions) => new Set(
      ids
        .map((id) => predictions.get(id))
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map((row) => row.id)
    );
    const current = topIds(run.predictions);
    const expected = topIds(baseline.predictions);
    return [...current].filter((id) => expected.has(id)).length / 6;
  });

  return {
    decisionChanges,
    meanTop6Overlap: mean(overlaps),
    scoreMae: scoreDifference / run.predictions.size
  };
}

function classificationMetrics(rows) {
  const truePositive = rows.filter((row) => row.relevant && row.predictedRelevant).length;
  const falsePositive = rows.filter((row) => !row.relevant && row.predictedRelevant).length;
  const trueNegative = rows.filter((row) => !row.relevant && !row.predictedRelevant).length;
  const falseNegative = rows.filter((row) => row.relevant && !row.predictedRelevant).length;
  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);

  return {
    precision,
    recall,
    f1: divide(2 * precision * recall, precision + recall),
    accuracy: divide(truePositive + trueNegative, rows.length)
  };
}

function auc(rows) {
  const positives = rows.filter((row) => row.relevant);
  const negatives = rows.filter((row) => !row.relevant);
  let wins = 0;

  for (const positive of positives) {
    for (const negative of negatives) {
      wins += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0;
    }
  }

  return divide(wins, positives.length * negatives.length);
}

async function embedDocuments(items, requestedDimensions) {
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  const vectors = new Map();
  let nextBatch = 0;
  const workers = Math.min(concurrency, batches.length);

  await Promise.all(Array.from({ length: workers }, async () => {
    while (nextBatch < batches.length) {
      const batch = batches[nextBatch++];
      const embedded = await embed(batch.map((item) => item.text), requestedDimensions);
      batch.forEach((item, index) => vectors.set(item.id, embedded[index]));
    }
  }));

  return vectors;
}

async function embed(inputs, requestedDimensions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), embeddingConfig.requestTimeoutMs);

  try {
    const response = await fetch(`${embeddingConfig.openRouterBaseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: embeddingConfig.model,
        input: inputs,
        dimensions: requestedDimensions
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OpenRouter embedding request failed with ${response.status}`);
    }

    const payload = await response.json();
    const data = [...(payload.data || [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

    if (data.length !== inputs.length) {
      throw new Error(`Expected ${inputs.length} vectors, received ${data.length}.`);
    }

    return data.map((item, index) => {
      if (!Array.isArray(item.embedding) || item.embedding.length !== requestedDimensions) {
        throw new Error(`Vector ${index} has an unexpected dimension.`);
      }
      return normalizeVector(item.embedding);
    });
  } finally {
    clearTimeout(timeout);
  }
}

function averageNormalizedVectors(vectors) {
  const totals = Array.from({ length: vectors[0].length }, () => 0);
  for (const vector of vectors) {
    vector.forEach((value, index) => { totals[index] += value; });
  }
  return normalizeVector(totals.map((value) => value / vectors.length));
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector.map(() => 0) : vector.map((value) => value / magnitude);
}

function cosineSimilarity(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readIntegerArgument(name, fallback) {
  const raw = readArgument(name);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

function readNumberArgument(name, fallback) {
  const raw = readArgument(name);
  const value = raw === undefined ? fallback : Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number.`);
  return value;
}

function readIntegerListArgument(name, fallback) {
  const raw = readArgument(name);
  if (raw === undefined) return fallback;
  const values = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));
  if (values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error(`--${name} must be a comma-separated list of positive integers.`);
  }
  return [...new Set(values)];
}

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function loadEnv(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value.replace(/\s+#.*$/, "");
  }
}
