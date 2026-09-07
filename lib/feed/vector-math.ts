export function normalizeVector(vector: number[]) {
  if (vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("Vector components must be finite numbers");
  }
  // Scale first so valid large components cannot overflow the norm.
  const scale = vector.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (scale ? value / scale : 0) ** 2, 0));

  if (magnitude === 0) {
    return vector.map(() => 0);
  }

  return vector.map((value) => (value / scale) / magnitude);
}

export function averageNormalizedVectors(vectors: number[][]) {
  if (vectors.length === 0) {
    return [];
  }

  const totals = Array.from({ length: vectors[0].length }, () => 0);

  for (const vector of vectors) {
    for (let index = 0; index < totals.length; index += 1) {
      totals[index] += vector[index] || 0;
    }
  }

  return normalizeVector(totals.map((value) => value / vectors.length));
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function driftCentroid(current: number[], video: number[], learningRate: number) {
  return normalizeVector(
    current.map((value, index) => value * (1 - learningRate) + (video[index] || 0) * learningRate)
  );
}
