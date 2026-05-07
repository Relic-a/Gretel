import { appendFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type LogFields = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";
type LoggerState = {
  logFileWriteQueue: Promise<void>;
  preparedLogDirs: Set<string>;
};

const LOG_FILE_ENV_KEY = "GRETEL_LOG_FILE";
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
  const line = JSON.stringify({
    level,
    event,
    at,
    ...fields
  });

  writeLogFile(line, at);

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

      if (!loggerState.preparedLogDirs.has(dir)) {
        await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
        loggerState.preparedLogDirs.add(dir);
      }

      await appendFile(/*turbopackIgnore: true*/ logFilePath, `${line}\n`, "utf8");
    } catch (error) {
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

function getLoggerState() {
  const globalState = globalThis as typeof globalThis & {
    __gretelLoggerState?: LoggerState;
  };

  if (!globalState.__gretelLoggerState) {
    globalState.__gretelLoggerState = {
      logFileWriteQueue: Promise.resolve(),
      preparedLogDirs: new Set<string>()
    };
  }

  return globalState.__gretelLoggerState;
}
