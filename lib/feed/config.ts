import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { DEFAULT_GRETEL_CONFIG, type GretelConfig } from "./config-defaults";
import { loadDotEnvFile } from "../env";
import { errorFields, logInfo, logWarn } from "../logger";

type ConfigInput = Partial<{
  serving: Partial<GretelConfig["serving"]>;
  expansion: Partial<GretelConfig["expansion"]>;
  transcription: Partial<GretelConfig["transcription"]>;
  feed: Partial<GretelConfig["feed"]>;
  learning: Partial<GretelConfig["learning"]>;
  embeddings: Partial<GretelConfig["embeddings"]>;
  client: Partial<GretelConfig["client"]>;
  youtube: Partial<GretelConfig["youtube"]>;
}>;

const CONFIG_ENV_KEY = "GRETEL_CONFIG";
const DEFAULT_CONFIG_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "config",
  "gretel.config.json"
);

let lastConfigWarning = "";
let lastConfigLogSignature = "";
const configInputCache = new Map<string, {
  input: ConfigInput;
  mtimeMs: number;
  size: number;
}>();

export function getGretelConfig() {
  loadDotEnvFile();
  const input = readConfigInput();
  const config = mergeConfig(DEFAULT_GRETEL_CONFIG, input);

  logConfigIfChanged(config);

  return config;
}

export function getPublicGretelConfig() {
  const config = getGretelConfig();

  return {
    serving: config.serving,
    expansion: config.expansion,
    transcription: config.transcription,
    feed: {
      maxVideos: config.feed.maxVideos
    },
    learning: {
      watchSaveThreshold: config.learning.watchSaveThreshold,
      watchCompletionThreshold: config.learning.watchCompletionThreshold
    },
    embeddings: {
      provider: config.embeddings.provider,
      store: config.embeddings.store,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions
    },
    client: {
      watchProgressPollMs: config.client.watchProgressPollMs
    },
    youtube: {
      language: config.youtube.language
    }
  };
}

export function getConfigPath() {
  loadDotEnvFile();
  return process.env[CONFIG_ENV_KEY] || DEFAULT_CONFIG_PATH;
}

function readConfigInput(): ConfigInput {
  const configPath = getConfigPath();

  if (!existsSync(/*turbopackIgnore: true*/ configPath)) {
    configInputCache.delete(configPath);
    return {};
  }

  try {
    const stats = statSync(/*turbopackIgnore: true*/ configPath);
    const cached = configInputCache.get(configPath);

    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.input;
    }

    const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ configPath, "utf8"));
    const input = parsed && typeof parsed === "object" ? parsed : {};

    configInputCache.set(configPath, {
      input,
      mtimeMs: stats.mtimeMs,
      size: stats.size
    });

    return input;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warningSignature = JSON.stringify({ path: configPath, message });

    if (lastConfigWarning !== warningSignature) {
      logWarn("config.read_failed", {
        path: configPath,
        ...errorFields(error)
      });
      lastConfigWarning = warningSignature;
    }

    try {
      const stats = statSync(/*turbopackIgnore: true*/ configPath);
      configInputCache.set(configPath, {
        input: {},
        mtimeMs: stats.mtimeMs,
        size: stats.size
      });
    } catch {}

    return {};
  }
}

function logConfigIfChanged(config: GretelConfig) {
  const configPath = getConfigPath();
  const signature = JSON.stringify({ path: configPath, config });

  if (signature === lastConfigLogSignature) {
    return;
  }

  lastConfigLogSignature = signature;
  logInfo("config.applied", {
    path: configPath,
    serving: config.serving,
    expansion: config.expansion,
    transcription: config.transcription,
    feed: config.feed,
    learning: config.learning,
    embeddings: {
      provider: config.embeddings.provider,
      store: config.embeddings.store,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
      batchSize: config.embeddings.batchSize,
      maxConcurrentRequests: config.embeddings.maxConcurrentRequests
    },
    client: config.client,
    youtube: config.youtube
  });
}

function mergeConfig(defaults: GretelConfig, input: ConfigInput): GretelConfig {
  const serving = input.serving || {};
  const expansion = input.expansion || {};
  const transcription = input.transcription || {};
  const feed = input.feed || {};
  const learning = input.learning || {};
  const embeddings = input.embeddings || {};
  const client = input.client || {};
  const youtube = input.youtube || {};

  return {
    serving: {
      impressionPenaltyFactor: share(
        legacyNumber(serving, "impressionPenaltyFactor", "servedPenaltyFactor"),
        defaults.serving.impressionPenaltyFactor
      ),
      fastLaneImpressionPenaltyFactor: numberInRange(
        serving.fastLaneImpressionPenaltyFactor,
        defaults.serving.fastLaneImpressionPenaltyFactor,
        0,
        100
      ),
      warmSemanticWeight: numberInRange(
        serving.warmSemanticWeight,
        defaults.serving.warmSemanticWeight,
        0,
        100
      )
    },
    expansion: {
      initialFetchSize: integer(
        expansion.initialFetchSize,
        defaults.expansion.initialFetchSize,
        1,
        1000
      ),
      initialExpansionCycles: integer(
        expansion.initialExpansionCycles,
        defaults.expansion.initialExpansionCycles,
        0,
        20
      ),
      initialExpansionSeedCount: integer(
        expansion.initialExpansionSeedCount,
        defaults.expansion.initialExpansionSeedCount,
        1,
        100
      ),
      minDelayBetweenFetchesMs: integer(
        expansion.minDelayBetweenFetchesMs,
        defaults.expansion.minDelayBetweenFetchesMs,
        0,
        600000
      ),
      maxFetchCallsPerCycle: integer(
        expansion.maxFetchCallsPerCycle,
        defaults.expansion.maxFetchCallsPerCycle,
        1,
        100
      ),
      cycleCooldownMs: integer(
        expansion.cycleCooldownMs,
        defaults.expansion.cycleCooldownMs,
        0,
        24 * 60 * 60 * 1000
      ),
      minFreshVideos: integer(
        expansion.minFreshVideos,
        defaults.expansion.minFreshVideos,
        0,
        1000
      ),
      minFreshRatio: share(
        expansion.minFreshRatio,
        defaults.expansion.minFreshRatio
      ),
      minExpansionYield: integer(
        expansion.minExpansionYield,
        defaults.expansion.minExpansionYield,
        0,
        1000
      ),
      maxVideosPerCycle: integer(
        expansion.maxVideosPerCycle,
        defaults.expansion.maxVideosPerCycle,
        1,
        1000
      )
    },
    transcription: {
      introductionPercentage: share(
        transcription.introductionPercentage,
        defaults.transcription.introductionPercentage
      ),
      maxCharacters: integer(
        transcription.maxCharacters,
        defaults.transcription.maxCharacters,
        0,
        100000
      )
    },
    feed: {
      maxQueries: integer(feed.maxQueries, defaults.feed.maxQueries, 1, 50),
      maxVideos: integer(feed.maxVideos, defaults.feed.maxVideos, 1, 200),
      poolSizeCap: integer(feed.poolSizeCap, defaults.feed.poolSizeCap, 1, 10000),
      subscriptionRefreshMinutes: numberInRange(
        feed.subscriptionRefreshMinutes,
        defaults.feed.subscriptionRefreshMinutes,
        0,
        24 * 60 * 30
      ),
      recommendationSeeds: integer(feed.recommendationSeeds, defaults.feed.recommendationSeeds, 0, 50),
      minVideosPerQuery: integer(feed.minVideosPerQuery, defaults.feed.minVideosPerQuery, 1, 100),
      minVideosPerChannel: integer(
        feed.minVideosPerChannel,
        defaults.feed.minVideosPerChannel,
        1,
        100
      ),
      similarityThreshold: share(feed.similarityThreshold, defaults.feed.similarityThreshold),
      coldStartInteractionThreshold: integer(
        feed.coldStartInteractionThreshold,
        defaults.feed.coldStartInteractionThreshold,
        1,
        10000
      ),
      expansionSeedCount: integer(feed.expansionSeedCount, defaults.feed.expansionSeedCount, 1, 100),
      minRelatedVideosPerSeed: integer(
        feed.minRelatedVideosPerSeed,
        defaults.feed.minRelatedVideosPerSeed,
        1,
        100
      ),
      maxRelatedVideosPerSeed: integer(
        feed.maxRelatedVideosPerSeed,
        defaults.feed.maxRelatedVideosPerSeed,
        1,
        100
      ),
      subscriptionFastLanePerSession: integer(
        feed.subscriptionFastLanePerSession,
        defaults.feed.subscriptionFastLanePerSession,
        0,
        100
      ),
      coldStartParentEngagementWeight: share(
        feed.coldStartParentEngagementWeight,
        defaults.feed.coldStartParentEngagementWeight
      )
    },
    learning: {
      watchSaveThreshold: share(learning.watchSaveThreshold, defaults.learning.watchSaveThreshold),
      watchTimeWeight: share(learning.watchTimeWeight, defaults.learning.watchTimeWeight),
      likedWeight: share(learning.likedWeight, defaults.learning.likedWeight),
      clickedWeight: share(learning.clickedWeight, defaults.learning.clickedWeight),
      ignorePenaltyBase: numberInRange(
        learning.ignorePenaltyBase,
        defaults.learning.ignorePenaltyBase,
        0,
        20
      ),
      ignorePenaltyGrowth: numberInRange(
        learning.ignorePenaltyGrowth,
        defaults.learning.ignorePenaltyGrowth,
        1,
        20
      ),
      centroidLearningRate: share(
        learning.centroidLearningRate,
        defaults.learning.centroidLearningRate
      ),
      maxCentroidDrift: share(learning.maxCentroidDrift, defaults.learning.maxCentroidDrift),
      watchCompletionThreshold: share(
        learning.watchCompletionThreshold,
        defaults.learning.watchCompletionThreshold
      )
    },
    embeddings: {
      provider: oneOf(
        embeddings.provider,
        defaults.embeddings.provider,
        ["openrouter", "mock"] as const
      ),
      store: oneOf(embeddings.store, defaults.embeddings.store, ["sqlite-vec"] as const),
      openRouterApiKeyEnv: nonEmptyString(
        embeddings.openRouterApiKeyEnv,
        defaults.embeddings.openRouterApiKeyEnv
      ),
      openRouterBaseUrl: nonEmptyString(
        embeddings.openRouterBaseUrl,
        defaults.embeddings.openRouterBaseUrl
      ),
      openRouterSiteUrlEnv: nonEmptyString(
        embeddings.openRouterSiteUrlEnv,
        defaults.embeddings.openRouterSiteUrlEnv
      ),
      openRouterAppNameEnv: nonEmptyString(
        embeddings.openRouterAppNameEnv,
        defaults.embeddings.openRouterAppNameEnv
      ),
      model: nonEmptyString(embeddings.model, defaults.embeddings.model),
      dimensions: integer(embeddings.dimensions, defaults.embeddings.dimensions, 1, 32768),
      batchSize: integer(embeddings.batchSize, defaults.embeddings.batchSize, 1, 256),
      maxConcurrentRequests: integer(
        embeddings.maxConcurrentRequests,
        defaults.embeddings.maxConcurrentRequests,
        1,
        16
      ),
      requestTimeoutMs: integer(
        embeddings.requestTimeoutMs,
        defaults.embeddings.requestTimeoutMs,
        1000,
        120000
      ),
      mockSeed: integer(embeddings.mockSeed, defaults.embeddings.mockSeed, 1, 2147483647)
    },
    client: {
      watchProgressPollMs: integer(client.watchProgressPollMs, defaults.client.watchProgressPollMs, 250, 60000)
    },
    youtube: {
      language: nonEmptyString(youtube.language, defaults.youtube.language)
    }
  };
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

function legacyNumber(source: object, currentKey: string, legacyKey: string) {
  const values = source as Record<string, unknown>;

  return values[currentKey] ?? values[legacyKey];
}

function nonEmptyString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function oneOf<const T extends readonly string[]>(value: unknown, fallback: T[number], allowed: T) {
  return (typeof value === "string" && allowed.includes(value) ? value : fallback) as T[number];
}
