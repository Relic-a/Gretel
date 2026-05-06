import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type LogFields = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

const LOG_FILE_ENV_KEY = "GRETEL_LOG_FILE";
const DEFAULT_LOG_FILE = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "logs",
  "gretel.log"
);

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

  try {
    mkdirSync(/*turbopackIgnore: true*/ path.dirname(logFilePath), { recursive: true });
    appendFileSync(/*turbopackIgnore: true*/ logFilePath, `${line}\n`, "utf8");
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "logger.file_write_failed",
      at,
      logFilePath,
      ...errorFields(error)
    }));
  }
}
