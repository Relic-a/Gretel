import { DEFAULT_FEED_NODE_WEIGHTS, MAX_NODE_WEIGHT, MAX_QUERIES } from "./config";
import type { ChannelSort, FeedNodeId, FeedNodeWeights } from "./types";

export function createQueries(tags: string[]) {
  return tags.slice(0, MAX_QUERIES);
}

export function parseTags(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return cleanQueries(
    values.flatMap((entry) => (typeof entry === "string" ? entry.split(/[,\n]/) : []))
  );
}

export function parseChannelSort(value: unknown): ChannelSort {
  return value === "popular" ? "popular" : "latest";
}

export function parseFeedNodeWeights(value: unknown): FeedNodeWeights {
  const source = value && typeof value === "object" ? value : {};
  const weights = { ...DEFAULT_FEED_NODE_WEIGHTS } as FeedNodeWeights;

  for (const id of Object.keys(weights) as FeedNodeId[]) {
    if (!(id in source)) {
      continue;
    }

    weights[id] = clampWeight((source as Record<string, unknown>)[id]);
  }

  return weights;
}

function cleanQueries(values: unknown[]) {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const query = value.replace(/\s+/g, " ").trim();
    const key = query.toLowerCase();

    if (query.length > 2 && !seen.has(key)) {
      seen.add(key);
      queries.push(query.slice(0, 120));
    }

    if (queries.length === MAX_QUERIES) {
      break;
    }
  }

  return queries;
}

function clampWeight(value: unknown) {
  const weight = Number(value);

  if (!Number.isFinite(weight)) {
    return 0;
  }

  return Math.min(MAX_NODE_WEIGHT, Math.max(0, Math.round(weight)));
}
