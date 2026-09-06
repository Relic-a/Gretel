import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeRunRoot(prefix = "gretel-chaos-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function makeCase(runRoot, name, configSource = new URL("../../../../config/gretel.config.json", import.meta.url)) {
  const dir = path.join(runRoot, name);
  const dataDir = path.join(dir, "data");
  const logsDir = path.join(dir, "logs");
  const browserDir = path.join(dir, "browser-profile");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  mkdirSync(browserDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(dir, "gretel.config.json");
  cpSync(configSource, configPath);
  return {
    id: name,
    dir,
    dataDir,
    logsDir,
    browserDir,
    configPath,
    logFile: path.join(logsDir, "gretel.log"),
    artifactDir: path.join(dir, "evidence")
  };
}

export function childEnv(caseContext, overrides = {}) {
  return {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    GRETEL_DATA_DIR: caseContext.dataDir,
    GRETEL_LOG_FILE: caseContext.logFile,
    GRETEL_CONFIG: caseContext.configPath,
    GRETEL_LOG_LEVEL: "info",
    TZ: "UTC",
    LANG: "C",
    ...overrides
  };
}
