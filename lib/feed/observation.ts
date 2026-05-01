import type { FeedObservation } from "./types";

type ObservationData = Record<string, number | string | boolean>;

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
  const result = await operation();
  const durationMs = Math.round(performance.now() - startedAt);

  if (isObservedResult<T>(result)) {
    observation.operations.push({ name, durationMs, input, output: result.output });
    return result.value;
  }

  observation.operations.push({ name, durationMs, input });
  return result;
}

export function logFeedObservation(
  observation: FeedObservation,
  summary: ObservationData
) {
  console.info(
    "[feed-observation]",
    JSON.stringify({
      requestId: observation.requestId,
      totalMs: Math.round(performance.now() - observation.startedAt),
      summary,
      operations: observation.operations
    })
  );
}

function isObservedResult<T>(
  value: T | { value: T; output: ObservationData }
): value is { value: T; output: ObservationData } {
  return Boolean(value && typeof value === "object" && "value" in value && "output" in value);
}

