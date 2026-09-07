// Shared report-schema helpers for the soak verification layer.

import { execFileSync } from "node:child_process";

export const SCHEMA_VERSION = 1;
export const LAYER = "soak";

export function getGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function isDirty() {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

export function caseResult(id, criterion, status, durationMs, evidence, reason = null) {
  return { id, criterion, status, durationMs, evidence, failureReason: reason, reason: reason ?? undefined };
}

export function newReport(runId, mode, seed, cases, extra = {}) {
  const startedAt = extra.startedAt || new Date().toISOString();
  const finishedAt = extra.finishedAt || new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    layer: LAYER,
    runId,
    startedAt,
    finishedAt,
    gitSha: getGitSha(),
    dirty: isDirty(),
    seed,
    platform: process.platform,
    architecture: process.arch,
    mode,
    thresholds: extra.thresholds || {},
    artifact: extra.artifact || extra.artifactMetadata || {},
    artifactMetadata: extra.artifactMetadata || extra.artifact || {},
    cases
  };
}

/** Exit non-zero if any case is fail/blocked/not_run. */
export function strictExit(report) {
  const bad = report.cases.filter(
    (c) => c.status === "fail" || c.status === "blocked" || c.status === "not_run"
  );
  return bad.length > 0 ? 1 : 0;
}

export function summarize(report) {
  const counts = { pass: 0, fail: 0, blocked: 0, not_run: 0 };
  for (const c of report.cases) counts[c.status] = (counts[c.status] || 0) + 1;
  return counts;
}
