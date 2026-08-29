import { getDatabase } from "./profile-store";
import { getUserSettings } from "./settings";

export type PerformanceOperation = {
  name: string;
  durationMs: number;
  status: "ok" | "error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
};

export type PerformanceTrace = {
  enabled: boolean;
  requestId: string;
  workflow: string;
  profileId?: string;
  startedAt: number;
  operations: PerformanceOperation[];
};

type MetricRow = {
  trace_id: string;
  workflow: string;
  duration_ms: number;
  status: string;
  started_at: number;
};

type SpanRow = {
  trace_id: string;
  name: string;
  duration_ms: number;
  status: string;
  input_json: string | null;
};

const defaultRetentionDays = 30;
let writesSinceCleanup = 0;

export function createPerformanceTrace(
  workflow: string,
  context: { profileId?: string; requestId?: string } = {}
): PerformanceTrace {
  const enabled = getUserSettings().developerAnalytics === true;

  return {
    enabled,
    requestId: context.requestId || crypto.randomUUID(),
    workflow,
    profileId: context.profileId,
    startedAt: performance.now(),
    operations: createOperationBuffer(enabled)
  };
}

export async function observePerformanceOperation<T>(
  trace: PerformanceTrace,
  name: string,
  input: Record<string, unknown>,
  operation: () => T | { value: T; output: Record<string, unknown> } | Promise<T | { value: T; output: Record<string, unknown> }>
) {
  if (!trace.enabled) {
    const result = await operation();
    return isObservedResult<T>(result) ? result.value : result;
  }

  const startedAt = performance.now();
  try {
    const result = await operation();
    const durationMs = roundDuration(performance.now() - startedAt);

    if (isObservedResult<T>(result)) {
      trace.operations.push({ name, durationMs, status: "ok", input, output: result.output });
      return result.value;
    }

    trace.operations.push({ name, durationMs, status: "ok", input });
    return result;
  } catch (error) {
    trace.operations.push({
      name,
      durationMs: roundDuration(performance.now() - startedAt),
      status: "error",
      input,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function persistPerformanceTrace(
  trace: PerformanceTrace,
  summary: Record<string, unknown>,
  options: { status?: "ok" | "error"; totalMs?: number } = {}
) {
  if (!trace.enabled) {
    return;
  }

  try {
    persistPerformanceTraceUnsafe(trace, summary, options);
  } catch (error) {
    // Telemetry must never turn a successful user operation into a failure.
    console.warn(JSON.stringify({
      level: "warn",
      event: "performance.persist_failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    }));
  }
}

function persistPerformanceTraceUnsafe(
  trace: PerformanceTrace,
  summary: Record<string, unknown>,
  options: { status?: "ok" | "error"; totalMs?: number }
) {
  const database = getDatabase();
  ensureMetricsSchema();
  const totalMs = options.totalMs ?? roundDuration(performance.now() - trace.startedAt);
  const status = options.status || (trace.operations.some((item) => item.status === "error") ? "error" : "ok");
  const now = Date.now();

  database.transaction(() => {
    database.prepare(`
      INSERT OR REPLACE INTO performance_traces
        (id, workflow, profile_id, started_at, duration_ms, status, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      trace.requestId,
      trace.workflow,
      trace.profileId || null,
      now - totalMs,
      totalMs,
      status,
      safeJson(summary)
    );

    database.prepare("DELETE FROM performance_spans WHERE trace_id = ?").run(trace.requestId);
    const insertSpan = database.prepare(`
      INSERT INTO performance_spans
        (trace_id, ordinal, name, duration_ms, status, input_json, output_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    trace.operations.forEach((span, ordinal) => {
      insertSpan.run(
        trace.requestId,
        ordinal,
        span.name,
        span.durationMs,
        span.status,
        span.input ? safeJson(span.input) : null,
        span.output ? safeJson(span.output) : null,
        span.error || null
      );
    });
  })();

  writesSinceCleanup += 1;
  if (writesSinceCleanup >= 100) {
    writesSinceCleanup = 0;
    const cutoff = now - getRetentionDays() * 24 * 60 * 60 * 1000;
    database.prepare("DELETE FROM performance_traces WHERE started_at < ?").run(cutoff);
  }
}

export function getPerformanceReport(options: {
  sinceMs: number;
  profileId?: string;
  workflow?: string;
}) {
  ensureMetricsSchema();
  const database = getDatabase();
  const filters = ["started_at >= ?"];
  const values: Array<string | number> = [options.sinceMs];

  if (options.profileId) {
    filters.push("profile_id = ?");
    values.push(options.profileId);
  }
  if (options.workflow) {
    filters.push("workflow = ?");
    values.push(options.workflow);
  }

  const traces = database.prepare(`
    SELECT id AS trace_id, workflow, duration_ms, status, started_at
    FROM performance_traces
    WHERE ${filters.join(" AND ")}
    ORDER BY started_at DESC
  `).all(...values) as MetricRow[];
  const traceIds = traces.map((trace) => trace.trace_id);
  const spans = traceIds.length === 0
    ? []
    : database.prepare(`
        SELECT trace_id, name, duration_ms, status, input_json
        FROM performance_spans
        WHERE trace_id IN (${traceIds.map(() => "?").join(",")})
      `).all(...traceIds) as SpanRow[];

  const workflows = [...new Set(traces.map((trace) => trace.workflow))]
    .map((workflow) => summarizeWorkflow(
      workflow,
      traces.filter((trace) => trace.workflow === workflow),
      spans
    ))
    .sort((left, right) => right.totalMs - left.totalMs);

  return {
    generatedAt: new Date().toISOString(),
    since: new Date(options.sinceMs).toISOString(),
    retentionDays: getRetentionDays(),
    overview: summarizeDurations(traces.map((trace) => trace.duration_ms), traces),
    workflows,
    recentRuns: traces.slice(0, 25).map((trace) => ({
      id: trace.trace_id,
      workflow: trace.workflow,
      status: trace.status,
      durationMs: trace.duration_ms,
      startedAt: new Date(trace.started_at).toISOString(),
      slowestOperations: spans
        .filter((span) => span.trace_id === trace.trace_id)
        .sort((left, right) => right.duration_ms - left.duration_ms)
        .slice(0, 3)
        .map((span) => ({ name: operationKey(span), durationMs: span.duration_ms, status: span.status }))
    }))
  };
}

function summarizeWorkflow(workflow: string, traces: MetricRow[], allSpans: SpanRow[]) {
  const traceIds = new Set(traces.map((trace) => trace.trace_id));
  const spans = allSpans.filter((span) => traceIds.has(span.trace_id));
  const operationNames = [...new Set(spans.map(operationKey))];
  const totalWorkflowMs = traces.reduce((total, trace) => total + trace.duration_ms, 0);

  const operations = operationNames.map((name) => {
    const matching = spans.filter((span) => operationKey(span) === name);
    const perTrace = new Map<string, number>();
    for (const span of matching) {
      perTrace.set(span.trace_id, (perTrace.get(span.trace_id) || 0) + span.duration_ms);
    }
    const callDurations = matching.map((span) => span.duration_ms);
    const traceDurations = [...perTrace.values()];
    const totalMs = sum(callDurations);

    return {
      name,
      calls: matching.length,
      traces: perTrace.size,
      errors: matching.filter((span) => span.status === "error").length,
      totalMs,
      averageCallMs: round(sum(callDurations) / Math.max(1, callDurations.length)),
      p95CallMs: percentile(callDurations, 0.95),
      averagePerRunMs: round(sum(traceDurations) / Math.max(1, traceDurations.length)),
      p95PerRunMs: percentile(traceDurations, 0.95),
      workflowTimePercent: round(totalWorkflowMs ? (totalMs / totalWorkflowMs) * 100 : 0)
    };
  }).sort((left, right) => right.totalMs - left.totalMs);

  return {
    workflow,
    ...summarizeDurations(traces.map((trace) => trace.duration_ms), traces),
    operations
  };
}

function summarizeDurations(durations: number[], rows: Array<{ status: string }>) {
  return {
    runs: durations.length,
    errors: rows.filter((row) => row.status === "error").length,
    errorRatePercent: round(rows.length ? rows.filter((row) => row.status === "error").length / rows.length * 100 : 0),
    totalMs: sum(durations),
    averageMs: round(sum(durations) / Math.max(1, durations.length)),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations.length ? Math.max(...durations) : 0
  };
}

function ensureMetricsSchema() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS performance_traces (
      id TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      profile_id TEXT,
      started_at INTEGER NOT NULL,
      duration_ms REAL NOT NULL,
      status TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS performance_traces_started_at_idx
      ON performance_traces(started_at);
    CREATE INDEX IF NOT EXISTS performance_traces_workflow_started_idx
      ON performance_traces(workflow, started_at);
    CREATE TABLE IF NOT EXISTS performance_spans (
      trace_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL,
      duration_ms REAL NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      PRIMARY KEY (trace_id, ordinal),
      FOREIGN KEY (trace_id) REFERENCES performance_traces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS performance_spans_name_idx ON performance_spans(name);
  `);
}

function getRetentionDays() {
  const configured = Number(process.env.GRETEL_METRICS_RETENTION_DAYS);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : defaultRetentionDays;
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.ceil(quantile * sorted.length) - 1]);
}

function sum(values: number[]) {
  return round(values.reduce((total, value) => total + value, 0));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function roundDuration(value: number) {
  return Math.max(0, round(value));
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function operationKey(span: SpanRow) {
  if (!span.input_json) return span.name;
  try {
    const input = JSON.parse(span.input_json) as Record<string, unknown>;
    return typeof input.stage === "string" && input.stage
      ? `${span.name} [${input.stage}]`
      : span.name;
  } catch {
    return span.name;
  }
}

function isObservedResult<T>(
  value: T | { value: T; output: Record<string, unknown> }
): value is { value: T; output: Record<string, unknown> } {
  return Boolean(value && typeof value === "object" && "value" in value && "output" in value);
}

function createOperationBuffer(enabled: boolean) {
  const operations: PerformanceOperation[] = [];

  if (!enabled) {
    operations.push = () => 0;
  }

  return operations;
}
