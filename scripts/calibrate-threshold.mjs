import { readFileSync } from "node:fs";
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
const dimensions = readIntegerArgument("dimensions", embeddingConfig.dimensions);
const batchSize = readIntegerArgument("batch-size", 16);
const concurrency = readIntegerArgument("concurrency", 3);

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

console.log("================================================================================");
console.log("Gretel Systematic Threshold Calibration Tool");
console.log("================================================================================");
console.log(`Model: ${embeddingConfig.model} | Dimensions: ${dimensions}`);
console.log(`Scenarios: ${corpus.length} | Candidates: ${documents.filter((d) => d.kind === "candidate").length}\n`);

console.log("Embedding documents...");
const startedAt = performance.now();
const vectors = await embedDocuments(documents, dimensions);
console.log(`Embedded ${vectors.size} items in ${(performance.now() - startedAt).toFixed(1)}ms.\n`);

// 1. Compute candidate scores against their scenario topic centroid
const scoredCandidates = [];
const scenarioCentroids = new Map();

for (const scenario of corpus) {
  const seedVectors = scenario.seeds.map((_text, index) => vectors.get(`${scenario.name}:seed:${index}`));
  const centroid = averageNormalizedVectors(seedVectors);
  scenarioCentroids.set(scenario.name, centroid);

  for (let index = 0; index < scenario.candidates.length; index++) {
    const candidate = scenario.candidates[index];
    const id = `${scenario.name}:candidate:${index}`;
    const vector = vectors.get(id);
    const score = cosineSimilarity(vector, centroid);
    scoredCandidates.push({
      id,
      scenario: scenario.name,
      relevant: candidate.relevant,
      score
    });
  }
}

// 2. Compute candidate scores against multi-topic MaxSim across ALL scenario topics
// This simulates a profile with all topics active at once
const allCentroids = [...scenarioCentroids.entries()].map(([topic, vector]) => ({ topic, vector }));
const maxSimCandidates = scoredCandidates.map((candidate) => {
  const vector = vectors.get(candidate.id);
  let bestSim = -1;
  let bestTopic = "";
  for (const tc of allCentroids) {
    const s = cosineSimilarity(vector, tc.vector);
    if (s > bestSim) {
      bestSim = s;
      bestTopic = tc.topic;
    }
  }
  return {
    ...candidate,
    maxSimScore: bestSim,
    matchedTopic: bestTopic
  };
});

// 3. Sweep thresholds
const thresholds = [];
for (let t = 0.30; t <= 0.82; t += 0.02) {
  thresholds.push(Number(t.toFixed(2)));
}

const sweepResults = thresholds.map((tau) => {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const c of maxSimCandidates) {
    const predicted = c.maxSimScore >= tau;
    if (c.relevant && predicted) tp++;
    else if (!c.relevant && predicted) fp++;
    else if (!c.relevant && !predicted) tn++;
    else if (c.relevant && !predicted) fn++;
  }

  const precision = divide(tp, tp + fp);
  const recall = divide(tp, tp + fn);
  const f1 = divide(2 * precision * recall, precision + recall);
  const f05 = divide((1 + 0.25) * precision * recall, 0.25 * precision + recall);
  const accuracy = divide(tp + tn, maxSimCandidates.length);
  const tpr = recall;
  const fpr = divide(fp, fp + tn);
  const youdenJ = tpr - fpr;

  return {
    threshold: tau,
    precision: round(precision, 3),
    recall: round(recall, 3),
    f1: round(f1, 3),
    f05: round(f05, 3),
    accuracy: round(accuracy, 3),
    youdenJ: round(youdenJ, 3),
    admitted: tp + fp,
    falsePositives: fp
  };
});

console.log("Threshold Sweep Results (Multi-Topic MaxSim Evaluation):");
console.table(sweepResults);

// Identify optimal thresholds
const bestF05 = [...sweepResults].sort((a, b) => b.f05 - a.f05 || b.precision - a.precision)[0];
const bestF1 = [...sweepResults].sort((a, b) => b.f1 - a.f1 || b.precision - a.precision)[0];
const prec90 = sweepResults.find((r) => r.precision >= 0.90 && r.recall >= 0.80) || sweepResults.find((r) => r.precision >= 0.90);
const prec95 = sweepResults.find((r) => r.precision >= 0.95 && r.recall >= 0.80) || sweepResults.find((r) => r.precision >= 0.95);

const relevantScores = maxSimCandidates.filter((c) => c.relevant).map((c) => c.maxSimScore);
const irrelevantScores = maxSimCandidates.filter((c) => !c.relevant).map((c) => c.maxSimScore);
const relMean = mean(relevantScores);
const irrelMean = mean(irrelevantScores);
const irrelStd = Math.sqrt(mean(irrelevantScores.map((s) => (s - irrelMean) ** 2)));
const fisherCutoff = round(irrelMean + 2 * irrelStd, 3);

console.log("\nDistribution Analysis:");
console.log(`- Relevant Score Distribution:   Mean = ${round(relMean, 3)} (Min = ${round(Math.min(...relevantScores), 3)}, Max = ${round(Math.max(...relevantScores), 3)})`);
console.log(`- Irrelevant Score Distribution: Mean = ${round(irrelMean, 3)}, StdDev = ${round(irrelStd, 3)} (Max = ${round(Math.max(...irrelevantScores), 3)})`);
console.log(`- Statistical Separation Margin (mu_irrel + 2*sigma): ${fisherCutoff}`);

console.log("\nCalibration Recommendations:");
console.log(`1. High-Precision Operating Point (Precision >= 95%): threshold = ${prec95 ? prec95.threshold : "N/A"}`);
console.log(`2. Balanced Intentional Feed (Optimal F0.5):          threshold = ${bestF05.threshold} (Precision: ${bestF05.precision}, Recall: ${bestF05.recall})`);
console.log(`3. Balanced Classification (Optimal F1):             threshold = ${bestF1.threshold} (Precision: ${bestF1.precision}, Recall: ${bestF1.recall})`);
console.log(`4. Target >= 90% Precision:                          threshold = ${prec90 ? prec90.threshold : "N/A"}`);

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
  return dot;
}

function averageNormalizedVectors(vectors) {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) result[i] += v[i];
  }
  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += result[i] * result[i];
  const norm = Math.sqrt(sumSq) || 1;
  return result.map((x) => x / norm);
}

function readIntegerArgument(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((e) => e.startsWith(prefix));
  return arg ? parseInt(arg.slice(prefix.length), 10) : fallback;
}

function loadEnv(envPath) {
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  } catch {}
}

async function embedDocuments(items, requestedDimensions) {
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  const resultVectors = new Map();
  let nextBatch = 0;
  const workers = Math.min(concurrency, batches.length);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        const embedded = await embed(batch.map((item) => item.text), requestedDimensions);
        batch.forEach((item, index) => resultVectors.set(item.id, embedded[index]));
      }
    })
  );

  return resultVectors;
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
    const data = [...(payload.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return data.map((item) => {
      const vector = item.embedding || [];
      let sumSq = 0;
      for (const x of vector) sumSq += x * x;
      const norm = Math.sqrt(sumSq) || 1;
      return vector.map((x) => x / norm);
    });
  } finally {
    clearTimeout(timeout);
  }
}
