import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDataDir } from "./data-dir";

export type UserSettings = {
  openRouterApiKey?: string;
  openRouterModel?: string;
  developerAnalytics?: boolean;
};

const dataDir = getDataDir();
const settingsPath = path.join(dataDir, "user-settings.json");

export function getUserSettings(): UserSettings {
  if (!existsSync(/*turbopackIgnore: true*/ settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ settingsPath, "utf8"));

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return sanitizeUserSettings(parsed);
  } catch {
    return {};
  }
}

export function setUserSettings(settings: UserSettings) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    /*turbopackIgnore: true*/ settingsPath,
    `${JSON.stringify(sanitizeUserSettings(settings), null, 2)}\n`,
    { mode: 0o600 }
  );
  restrictLocalSettingsPermissions();
}

function restrictLocalSettingsPermissions() {
  if (process.platform === "win32") return;

  chmodSync(dataDir, 0o700);
  chmodSync(settingsPath, 0o600);
}

function sanitizeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== "object") {
    return {};
  }

  const input = value as Record<string, unknown>;
  const openRouterApiKey =
    typeof input.openRouterApiKey === "string" ? input.openRouterApiKey.trim().slice(0, 512) : "";
  const openRouterModel =
    typeof input.openRouterModel === "string" ? input.openRouterModel.trim().slice(0, 200) : "";
  const developerAnalytics = input.developerAnalytics === true;

  return {
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(openRouterModel ? { openRouterModel } : {}),
    ...(developerAnalytics ? { developerAnalytics: true } : {})
  };
}
