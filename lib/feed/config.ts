import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_GRETEL_CONFIG, type GretelConfig } from "./config-defaults";
import type { FeedNodeId, FeedNodeWeights } from "./types";
import { errorFields, logInfo, logWarn } from "../logger";

type ConfigInput = Partial<{
  feed: Partial<
    Omit<GretelConfig["feed"], "defaultNodeWeights"> & {
      defaultNodeWeights: Partial<FeedNodeWeights>;
    }
  >;
  learning: Partial<GretelConfig["learning"]>;
  client: Partial<GretelConfig["client"]>;
}>;

const CONFIG_ENV_KEY = "GRETEL_CONFIG";
const DEFAULT_CONFIG_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "config",
  "gretel.config.json"
);

let lastConfigWarning = "";
let lastConfigLogSignature = "";

export function getGretelConfig() {
  const input = readConfigInput();
  const config = mergeConfig(DEFAULT_GRETEL_CONFIG, input);

  logConfigIfChanged(config);

  return config;
}

export function getPublicGretelConfig() {
  const config = getGretelConfig();

  return {
    feed: {
      maxNodeWeight: config.feed.maxNodeWeight,
      defaultNodeWeights: config.feed.defaultNodeWeights
    },
    learning: {
      watchSaveThreshold: config.learning.watchSaveThreshold
    },
    client: {
      watchProgressPollMs: config.client.watchProgressPollMs
    }
  };
}

export function getConfigPath() {
  return process.env[CONFIG_ENV_KEY] || DEFAULT_CONFIG_PATH;
}

function readConfigInput(): ConfigInput {
  const configPath = getConfigPath();

  if (!existsSync(/*turbopackIgnore: true*/ configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (lastConfigWarning !== message) {
      logWarn("config.read_failed", {
        path: configPath,
        ...errorFields(error)
      });
      lastConfigWarning = message;
    }

    return {};
  }
}

function logConfigIfChanged(config: GretelConfig) {
  const signature = JSON.stringify(config);

  if (signature === lastConfigLogSignature) {
    return;
  }

  lastConfigLogSignature = signature;
  logInfo("config.applied", {
    path: getConfigPath(),
    feed: config.feed,
    learning: config.learning,
    client: config.client
  });
}

function mergeConfig(defaults: GretelConfig, input: ConfigInput): GretelConfig {
  const feed = input.feed || {};
  const learning = input.learning || {};
  const client = input.client || {};

  return {
    feed: {
      maxQueries: integer(feed.maxQueries, defaults.feed.maxQueries, 1, 50),
      maxVideos: integer(feed.maxVideos, defaults.feed.maxVideos, 1, 200),
      cacheTargetVideos: integer(feed.cacheTargetVideos, defaults.feed.cacheTargetVideos, 1, 1000),
      cacheRefreshHours: numberInRange(
        feed.cacheRefreshHours,
        defaults.feed.cacheRefreshHours,
        0,
        24 * 30
      ),
      subscriptionRefreshMinutes: numberInRange(
        feed.subscriptionRefreshMinutes,
        defaults.feed.subscriptionRefreshMinutes,
        0,
        24 * 60 * 30
      ),
      recommendationSeeds: integer(feed.recommendationSeeds, defaults.feed.recommendationSeeds, 0, 50),
      watchedRecommendationSeeds: integer(
        feed.watchedRecommendationSeeds,
        defaults.feed.watchedRecommendationSeeds,
        0,
        50
      ),
      maxNodeWeight: integer(feed.maxNodeWeight, defaults.feed.maxNodeWeight, 1, 20),
      cacheReadMultiplier: numberInRange(
        feed.cacheReadMultiplier,
        defaults.feed.cacheReadMultiplier,
        1,
        20
      ),
      minVideosPerQuery: integer(feed.minVideosPerQuery, defaults.feed.minVideosPerQuery, 1, 100),
      minVideosPerChannel: integer(
        feed.minVideosPerChannel,
        defaults.feed.minVideosPerChannel,
        1,
        100
      ),
      maxSharePerNode: share(feed.maxSharePerNode, defaults.feed.maxSharePerNode),
      maxSharePerChannel: share(feed.maxSharePerChannel, defaults.feed.maxSharePerChannel),
      defaultNodeWeights: nodeWeights(
        feed.defaultNodeWeights,
        defaults.feed.defaultNodeWeights,
        integer(feed.maxNodeWeight, defaults.feed.maxNodeWeight, 1, 20)
      )
    },
    learning: {
      watchSaveThreshold: share(learning.watchSaveThreshold, defaults.learning.watchSaveThreshold),
      nodeAffinityStep: numberInRange(
        learning.nodeAffinityStep,
        defaults.learning.nodeAffinityStep,
        0,
        20
      ),
      channelAffinityStep: numberInRange(
        learning.channelAffinityStep,
        defaults.learning.channelAffinityStep,
        0,
        20
      ),
      maxAffinityBoost: numberInRange(
        learning.maxAffinityBoost,
        defaults.learning.maxAffinityBoost,
        0,
        50
      )
    },
    client: {
      watchProgressPollMs: integer(client.watchProgressPollMs, defaults.client.watchProgressPollMs, 250, 60000)
    }
  };
}

function nodeWeights(
  input: Partial<FeedNodeWeights> | undefined,
  defaults: FeedNodeWeights,
  maxNodeWeight: number
) {
  const source = input && typeof input === "object" ? input : {};
  const weights = { ...defaults };

  for (const id of Object.keys(weights) as FeedNodeId[]) {
    if (id in source) {
      weights[id] = integer(source[id], weights[id], 0, maxNodeWeight);
    }
  }

  return weights;
}

function share(value: unknown, fallback: number) {
  return numberInRange(value, fallback, 0, 1);
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(numberInRange(value, fallback, min, max));
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
