import type { FeedObservation } from "./types";
import { logError, logInfo } from "../logger";

type ObservationData = Record<string, unknown>;

export function createFeedObservation(): FeedObservation {
  return {
    requestId: crypto.randomUUID(),
    startedAt: performance.now(),
    operations: []
  };
}

export async function observeOperation<T>(
  observation: FeedObservation,
  name: string,
  input: ObservationData,
  operation: () => Promise<T | { value: T; output: ObservationData }>
) {
  const startedAt = performance.now();
  try {
    const result = await operation();
    const durationMs = Math.round(performance.now() - startedAt);

    if (isObservedResult<T>(result)) {
      observation.operations.push({ name, durationMs, status: "ok", input, output: result.output });
      return result.value;
    }

    observation.operations.push({ name, durationMs, status: "ok", input });
    return result;
  } catch (error) {
    observation.operations.push({
      name,
      durationMs: Math.round(performance.now() - startedAt),
      status: "error",
      input,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
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

  if (hasError || "error" in summary || "errorMessage" in summary) {
    logError("feed.request", fields);
    return;
  }

  logInfo("feed.request", fields);
}

function isObservedResult<T>(
  value: T | { value: T; output: ObservationData }
): value is { value: T; output: ObservationData } {
  return Boolean(value && typeof value === "object" && "value" in value && "output" in value);
}
