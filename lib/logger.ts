import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import pino from "pino";

export type LogFields = Record<string, unknown>;
export type LogLevel = "debug" | "info" | "warn" | "error";

type InsightBucket = {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  operations: Record<string, { count: number; errors: number; totalMs: number }>;
};

type LoggerState = {
  logFileWriteQueue: Promise<void>;
  logger: pino.Logger;
  insightEvents: number;
  insights: Record<string, InsightBucket>;
  processHandlersInstalled: boolean;
};

const LOG_FILE_ENV_KEY = "GRETEL_LOG_FILE";
const LOG_LEVEL_ENV_KEY = "GRETEL_LOG_LEVEL";
const INSIGHT_INTERVAL_ENV_KEY = "GRETEL_INSIGHT_INTERVAL";
const maxLogFileBytes = 5 * 1024 * 1024;
const rotatedLogFiles = 3;
const maxFieldStringLength = 8 * 1024;
const maxFieldDepth = 6;
const defaultInsightInterval = 100;
const DEFAULT_LOG_FILE = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "logs",
  "gretel.log"
);
const loggerState = getLoggerState();

installProcessErrorHandlers();

export function logDebug(event: string, fields: LogFields = {}) {
  writeLog("debug", event, fields);
}

export function logInfo(event: string, fields: LogFields = {}) {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}) {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}) {
  writeLog("error", event, fields);
}

/**
 * Keep detailed diagnostics opt-in. This is useful for ranking explanations
 * and other high-cardinality events that are expensive at the default level.
 */
export function logSampled(
  event: string,
  fields: LogFields = {},
  sampleRate = 1
) {
  const rate = Math.max(0, Math.min(1, sampleRate));
  if (rate === 0 || (rate < 1 && Math.random() > rate)) {
    return;
  }
  logDebug(event, fields);
}

export function errorFields(error: unknown, options: { stack?: boolean } = {}) {
  if (error instanceof Error) {
    const fields: LogFields = {
      errorName: error.name,
      errorMessage: error.message
    };

    if (options.stack && error.stack) {
      fields.errorStack = error.stack;
    }

    return fields;
  }

  return {
    errorMessage: String(error)
  };
}

/** Return compact in-memory counters useful for diagnostics and tests. */
export function getLogInsights() {
  return structuredClone(loggerState.insights);
}

export function resetLogInsights() {
  loggerState.insightEvents = 0;
  loggerState.insights = {};
}

/** Emit and reset the current insight window, normally on shutdown. */
export function flushLogInsights() {
  if (loggerState.insightEvents === 0) {
    return;
  }

  const insights = getLogInsights();
  resetLogInsights();
  writeLog("info", "logger.insights", { windowEvents: countInsightEvents(insights), insights }, true);
}

export function flushLogFileWrites() {
  return loggerState.logFileWriteQueue;
}

/** Use an incoming request id when it is safe, otherwise create one. */
export function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

/** A central field helper prevents routes from accidentally logging bodies or secrets. */
export function requestFields(request: Request, fields: LogFields = {}) {
  return {
    requestId: requestId(request),
    method: request.method,
    route: new URL(request.url).pathname,
    ...fields
  };
}

export function redactLogFields(fields: LogFields) {
  return sanitizeValue(fields, 0, new WeakSet<object>()) as LogFields;
}

function writeLog(
  level: LogLevel,
  event: string,
  fields: LogFields,
  skipInsights = false
) {
  if (!shouldLog(level)) {
    return;
  }

  const at = new Date().toISOString();
  const lineFields = redactLogFields({ ...fields, schemaVersion: 1, event, at });
  const line = serializeLine({ level, ...lineFields }, at, event);

  if (!skipInsights) {
    recordInsight(event, level, lineFields);
  }

  writeLogFile(line, at);
  loggerState.logger[level](lineFields);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "info") {
    console.info(line);
  } else if (isDebugConsoleEnabled()) {
    console.debug(line);
  }

  if (!skipInsights && loggerState.insightEvents >= getInsightInterval()) {
    flushLogInsights();
  }
}

function serializeLine(value: unknown, at: string, event: string) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    // A circular field must never prevent the application from completing its
    // request. Keep the failure itself observable without recursively logging it.
    const fallback = {
      level: "error",
      event: "logger.serialization_failed",
      at,
      sourceEvent: event,
      ...errorFields(error)
    };
    console.error(JSON.stringify(fallback));
    return JSON.stringify({
      level: "error",
      event,
      at,
      loggerSerializationError: true
    });
  }
}

function writeLogFile(line: string, at: string) {
  const logFilePath = process.env[LOG_FILE_ENV_KEY] || DEFAULT_LOG_FILE;

  // A rejected write must not poison the queue and silently disable every
  // subsequent log. Each operation starts from a settled promise instead.
  loggerState.logFileWriteQueue = loggerState.logFileWriteQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const dir = path.dirname(logFilePath);
        await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
        await rotateLogFile(logFilePath);
        await appendFile(/*turbopackIgnore: true*/ logFilePath, `${line}\n`, "utf8");
      } catch (error) {
        if (isMissingPathError(error)) {
          return;
        }

        // Do not call logError here: that would recursively enqueue a write to
        // the same broken path. stderr remains available during startup/crash.
        console.error(JSON.stringify({
          level: "error",
          event: "logger.file_write_failed",
          at,
          logFilePath,
          ...errorFields(error, { stack: true })
        }));
      }
    });
}

function isMissingPathError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Rotate by removing the oldest destination before every rename. Windows does
 * not replace an existing destination with rename(), so this explicit step is
 * what keeps the active file bounded on all supported platforms.
 */
async function rotateLogFile(logFilePath: string) {
  let currentSize: number;
  try {
    currentSize = (await stat(/*turbopackIgnore: true*/ logFilePath)).size;
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }

  if (currentSize < maxLogFileBytes) {
    return;
  }

  await removeIfExists(`${logFilePath}.${rotatedLogFiles}`);

  for (let index = rotatedLogFiles - 1; index >= 1; index -= 1) {
    await moveIfExists(`${logFilePath}.${index}`, `${logFilePath}.${index + 1}`);
  }

  await moveIfExists(logFilePath, `${logFilePath}.1`);
}

async function removeIfExists(filePath: string) {
  try {
    await unlink(/*turbopackIgnore: true*/ filePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

async function moveIfExists(source: string, destination: string) {
  await removeIfExists(destination);
  try {
    await rename(/*turbopackIgnore: true*/ source, /*turbopackIgnore: true*/ destination);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

function shouldLog(level: LogLevel) {
  const configured = process.env[LOG_LEVEL_ENV_KEY]?.toLowerCase();
  const minimum = configured === "debug" || configured === "info" || configured === "warn" || configured === "error"
    ? configured
    : "info";
  const ranks: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return ranks[level] >= ranks[minimum];
}

function isDebugConsoleEnabled() {
  return process.env[LOG_LEVEL_ENV_KEY]?.toLowerCase() === "debug";
}

function getInsightInterval() {
  const value = Number(process.env[INSIGHT_INTERVAL_ENV_KEY]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultInsightInterval;
}

function recordInsight(event: string, level: LogLevel, fields: LogFields) {
  const bucket = loggerState.insights[event] || {
    count: 0,
    errors: 0,
    totalMs: 0,
    maxMs: 0,
    operations: {}
  };
  bucket.count += 1;
  if (level === "error" || fields.errorMessage || fields.error) {
    bucket.errors += 1;
  }

  const duration = readDuration(fields.totalMs ?? fields.durationMs);
  if (duration !== undefined) {
    bucket.totalMs += duration;
    bucket.maxMs = Math.max(bucket.maxMs, duration);
  }

  if (Array.isArray(fields.operations)) {
    for (const operation of fields.operations) {
      if (!operation || typeof operation !== "object") continue;
      const value = operation as Record<string, unknown>;
      const name = typeof value.name === "string" ? value.name : "unknown";
      const operationBucket = bucket.operations[name] || { count: 0, errors: 0, totalMs: 0 };
      operationBucket.count += 1;
      if (value.status === "error") operationBucket.errors += 1;
      operationBucket.totalMs += readDuration(value.durationMs) || 0;
      bucket.operations[name] = operationBucket;
    }
  }

  loggerState.insights[event] = bucket;
  loggerState.insightEvents += 1;
}

function readDuration(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function countInsightEvents(insights: Record<string, InsightBucket>) {
  return Object.values(insights).reduce((total, bucket) => total + bucket.count, 0);
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>, key = ""): unknown {
  if (isSensitiveKey(key)) return "[REDACTED]";
  if (typeof value === "string") return value.length > maxFieldStringLength ? `${value.slice(0, maxFieldStringLength)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= maxFieldDepth) return "[TRUNCATED]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, depth + 1, seen, childKey);
  }
  return result;
}

function isSensitiveKey(key: string) {
  return /(?:api[-_]?key|authorization|cookie|password|secret|token|credential|access[-_]?key)/i.test(key);
}

function installProcessErrorHandlers() {
  if (typeof process === "undefined" || loggerState.processHandlersInstalled) return;
  loggerState.processHandlersInstalled = true;

  if (process.stdin && !process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on("end", () => {
      process.exit(0);
    });
  }

  // Monitor without installing an uncaughtException handler: a regular handler
  // would override Node's default crash behavior and could leave corrupted state
  // running. Unhandled rejections that Node promotes to uncaught exceptions also
  // arrive here with origin="unhandledRejection".
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    writeFatalLogSync(
      origin === "unhandledRejection"
        ? "process.unhandled_rejection"
        : "process.uncaught_exception",
      error
    );
  });
}

function writeFatalLogSync(event: string, error: unknown) {
  const at = new Date().toISOString();
  const fields = redactLogFields({
    schemaVersion: 1,
    level: "error",
    ...errorFields(error, { stack: true }),
    event,
    at
  });
  const line = serializeLine(fields, at, event);

  // stderr may be unavailable for the background desktop server, so make one
  // best-effort synchronous append before Node terminates the process.
  try {
    const logFilePath = process.env[LOG_FILE_ENV_KEY] || DEFAULT_LOG_FILE;
    mkdirSync(/*turbopackIgnore: true*/ path.dirname(logFilePath), { recursive: true });
    appendFileSync(/*turbopackIgnore: true*/ logFilePath, `${line}\n`, "utf8");
  } catch (writeError) {
    console.error(JSON.stringify({
      schemaVersion: 1,
      level: "error",
      event: "logger.fatal_write_failed",
      at,
      ...errorFields(writeError)
    }));
  }

  console.error(line);
}

function getLoggerState() {
  const globalState = globalThis as typeof globalThis & {
    __gretelLoggerState?: LoggerState;
  };

  if (!globalState.__gretelLoggerState) {
    globalState.__gretelLoggerState = {
      logFileWriteQueue: Promise.resolve(),
      logger: pino({ base: undefined, enabled: false, timestamp: false }),
      insightEvents: 0,
      insights: {},
      processHandlersInstalled: false
    };
  }

  return globalState.__gretelLoggerState;
}
