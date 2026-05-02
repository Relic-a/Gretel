import { getGretelConfig } from "./config";
import type { ChannelSort, FeedNodeId, FeedNodeWeights } from "./types";

export function createQueries(tags: string[]) {
  return tags.slice(0, getGretelConfig().feed.maxQueries);
}

export function parseTags(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return cleanQueries(
    values.flatMap((entry) => (typeof entry === "string" ? entry.split(/[,\n]/) : []))
  );
}

export function parseChannelSort(value: unknown): ChannelSort {
  return "mixed";
}

export function parseFeedNodeWeights(value: unknown): FeedNodeWeights {
  const config = getGretelConfig();
  const source = value && typeof value === "object" ? value : {};
  const weights = { ...config.feed.defaultNodeWeights };

  for (const id of Object.keys(weights) as FeedNodeId[]) {
    if (!(id in source)) {
      continue;
    }

    weights[id] = clampWeight((source as Record<string, unknown>)[id], config.feed.maxNodeWeight);
  }

  return weights;
}

function cleanQueries(values: unknown[]) {
  const maxQueries = getGretelConfig().feed.maxQueries;
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

    if (queries.length === maxQueries) {
      break;
    }
  }

  return queries;
}

function clampWeight(value: unknown, maxNodeWeight: number) {
  const weight = Number(value);

  if (!Number.isFinite(weight)) {
    return 0;
  }

  return Math.min(maxNodeWeight, Math.max(0, Math.round(weight)));
}
