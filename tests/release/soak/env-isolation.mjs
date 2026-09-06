// Deterministic child environment for soak test children: fresh scratch root,
// isolated data dir/log file/config, and an allowlisted env with no inherited
// secrets, cookies or user data.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Create a fresh isolated run root and return it plus configured paths. */
export function createIsolatedRunRoot(prefix = "gretel-soak-", parentDir = os.tmpdir()) {
  const runRoot = mkdtempSync(path.join(parentDir, prefix));
  const dataDir = path.join(runRoot, "data");
  const logsDir = path.join(runRoot, "logs");
  const configDir = path.join(runRoot, "config");
  const browserDir = path.join(runRoot, "browser-profile");
  const homeDir = path.join(runRoot, "child-home");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(browserDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  return {
    runRoot,
    dataDir,
    logsDir,
    configDir,
    browserDir,
    homeDir,
    logFile: path.join(logsDir, "gretel.log"),
    configPath: path.join(configDir, "gretel.config.json")
  };
}

/**
 * Allowlisted child environment derived from a minimal safe baseline.
 * No inherited API keys, .env files, browser cookies, signing keys or
 * user-specific paths are passed through.
 */
export function buildChildEnv({ dataDir, logFile, configPath, homeDir, networkLog, mode = "deterministic" } = {}) {
  const allow = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TERM: process.env.TERM || "dumb",
    SHELL: "/bin/sh"
  };
  const env = {
    ...allow,
    NODE_ENV: mode === "deterministic" ? "production" : "production",
    GRETEL_DATA_DIR: dataDir,
    GRETEL_LOG_FILE: logFile,
    GRETEL_CONFIG: configPath,
    GRETEL_SOAK_MODE: mode,
    // Deterministic mode: outbound network to non-allowlisted hosts must be
    // treated as unavailable. No real API keys are forwarded.
    GRETEL_SOAK_DETERMINISTIC: mode === "deterministic" ? "1" : "0",
    NEXT_TELEMETRY_DISABLED: "1",
    ...(networkLog ? { GRETEL_SOAK_NETWORK_LOG: networkLog } : {}),
    ...(homeDir ? { HOME: homeDir } : {})
  };
  return env;
}

/** Write a synthetic config for the isolated child. */
export function writeSyntheticConfig(configPath, overrides = {}) {
  const base = {
    serving: {},
    expansion: {
      initialFetchSize: 10,
      initialExpansionCycles: 1,
      initialExpansionSeedCount: 2,
      minDelayBetweenFetchesMs: 0,
      maxFetchCallsPerCycle: 2,
      cycleCooldownMs: 0,
      minFreshVideos: 1,
      minFreshRatio: 0.1,
      minExpansionYield: 1
    },
    feed: {
      maxQueries: 2,
      maxVideos: 6,
      poolSizeCap: 400,
      subscriptionRefreshMinutes: 45,
      recommendationSeeds: 2,
      minVideosPerQuery: 1,
      minVideosPerChannel: 1,
      similarityThreshold: 0.1,
      coldStartInteractionThreshold: 1,
      expansionSeedCount: 2,
      minRelatedVideosPerSeed: 1,
      maxRelatedVideosPerSeed: 2,
      subscriptionFastLanePerSession: 0,
      coldStartParentEngagementWeight: 0.05
    },
    learning: {},
    embeddings: {
      provider: "mock",
      model: "mock/hash-v1",
      dimensions: 8,
      batchSize: 8,
      maxConcurrentRequests: 2
    },
    client: { watchProgressPollMs: 500 },
    youtube: { language: "en" }
  };
  const merged = {
    ...base,
    ...overrides,
    serving: { ...base.serving, ...baseSection(overrides.serving) },
    expansion: { ...base.expansion, ...baseSection(overrides.expansion) },
    feed: { ...base.feed, ...baseSection(overrides.feed) },
    learning: { ...base.learning, ...baseSection(overrides.learning) },
    embeddings: { ...base.embeddings, ...baseSection(overrides.embeddings) },
    client: { ...base.client, ...baseSection(overrides.client) },
    youtube: { ...base.youtube, ...baseSection(overrides.youtube) }
  };
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return configPath;
}

function baseSection(value) {
  return value && typeof value === "object" ? value : {};
}
