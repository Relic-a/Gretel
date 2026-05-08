import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type UserSettings = {
  openRouterApiKey?: string;
  openRouterModel?: string;
};

const dataDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
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
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    /*turbopackIgnore: true*/ settingsPath,
    `${JSON.stringify(sanitizeUserSettings(settings), null, 2)}\n`
  );
}

function sanitizeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== "object") {
    return {};
  }

  const input = value as Record<string, unknown>;
  const openRouterApiKey =
    typeof input.openRouterApiKey === "string" ? input.openRouterApiKey.trim() : "";
  const openRouterModel =
    typeof input.openRouterModel === "string" ? input.openRouterModel.trim() : "";

  return {
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(openRouterModel ? { openRouterModel } : {})
  };
}
