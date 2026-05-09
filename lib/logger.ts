import { rename, stat, appendFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";

type LogFields = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";
type LoggerState = {
  logFileWriteQueue: Promise<void>;
  preparedLogDirs: Set<string>;
  logger: pino.Logger;
};

const LOG_FILE_ENV_KEY = "GRETEL_LOG_FILE";
const maxLogFileBytes = 5 * 1024 * 1024;
const rotatedLogFiles = 3;
const DEFAULT_LOG_FILE = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "logs",
  "gretel.log"
);
const loggerState = getLoggerState();

export function logInfo(event: string, fields: LogFields = {}) {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}) {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}) {
  writeLog("error", event, fields);
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

export function flushLogFileWrites() {
  return loggerState.logFileWriteQueue;
}

function writeLog(level: LogLevel, event: string, fields: LogFields) {
  const at = new Date().toISOString();
  const lineFields = { event, at, ...fields };
  const line = JSON.stringify({ level, ...lineFields });

  writeLogFile(line, at);
  loggerState.logger[level](lineFields);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

function writeLogFile(line: string, at: string) {
  const logFilePath = process.env[LOG_FILE_ENV_KEY] || DEFAULT_LOG_FILE;

  loggerState.logFileWriteQueue = loggerState.logFileWriteQueue.then(async () => {
    try {
      const dir = path.dirname(logFilePath);

      await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
      loggerState.preparedLogDirs.add(dir);

      await rotateLogFile(logFilePath);
      await appendFile(/*turbopackIgnore: true*/ logFilePath, `${line}\n`, "utf8");
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      console.error(JSON.stringify({
        level: "error",
        event: "logger.file_write_failed",
        at,
        logFilePath,
        ...errorFields(error)
      }));
    }
  });
}

function isMissingPathError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function rotateLogFile(logFilePath: string) {
  try {
    const current = await stat(/*turbopackIgnore: true*/ logFilePath);

    if (current.size < maxLogFileBytes) {
      return;
    }
  } catch {
    return;
  }

  for (let index = rotatedLogFiles - 1; index >= 1; index -= 1) {
    try {
      await rename(
        /*turbopackIgnore: true*/ `${logFilePath}.${index}`,
        /*turbopackIgnore: true*/ `${logFilePath}.${index + 1}`
      );
    } catch {}
  }

  try {
    await rename(/*turbopackIgnore: true*/ logFilePath, /*turbopackIgnore: true*/ `${logFilePath}.1`);
  } catch {}
}

function getLoggerState() {
  const globalState = globalThis as typeof globalThis & {
    __gretelLoggerState?: LoggerState;
  };

  if (!globalState.__gretelLoggerState) {
    globalState.__gretelLoggerState = {
      logFileWriteQueue: Promise.resolve(),
      preparedLogDirs: new Set<string>(),
      logger: pino({
        base: undefined,
        enabled: false,
        timestamp: false
      })
    };
  }

  return globalState.__gretelLoggerState;
}
