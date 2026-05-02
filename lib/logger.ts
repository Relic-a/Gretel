type LogFields = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

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
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...fields
  });

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
