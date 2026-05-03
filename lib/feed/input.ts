import { getGretelConfig } from "./config";
import type { ChannelSort } from "./types";

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
