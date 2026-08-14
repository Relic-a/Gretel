import type { FeedObservation } from "./types";
import { logError, logInfo } from "../logger";
import {
  createPerformanceTrace,
  observePerformanceOperation,
  persistPerformanceTrace
} from "../performance-metrics";

type ObservationData = Record<string, unknown>;

export function createFeedObservation(
  workflow = "feed.unknown",
  context: { profileId?: string } = {}
): FeedObservation {
  return createPerformanceTrace(workflow, context);
}

export async function observeOperation<T>(
  observation: FeedObservation,
  name: string,
  input: ObservationData,
  operation: () => Promise<T | { value: T; output: ObservationData }>
) {
  return observePerformanceOperation(observation, name, input, operation);
}

export function logFeedObservation(
  observation: FeedObservation,
  summary: ObservationData
) {
  const hasError = observation.operations.some((operation) => operation.status === "error");
  const fields = {
    requestId: observation.requestId,
    totalMs: Math.round(performance.now() - observation.startedAt),
    summary,
    operations: observation.operations
  };
  persistPerformanceTrace(observation, summary, {
    status: hasError || "error" in summary || "errorMessage" in summary ? "error" : "ok",
    totalMs: fields.totalMs
  });

  if (hasError || "error" in summary || "errorMessage" in summary) {
    logError("feed.request", fields);
    return;
  }

  logInfo("feed.request", fields);
}
