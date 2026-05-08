import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let envLoaded = false;

export function loadDotEnvFile() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const envPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env");

  if (!existsSync(/*turbopackIgnore: true*/ envPath)) {
    return;
  }

  try {
    const contents = readFileSync(/*turbopackIgnore: true*/ envPath, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

      if (!match) {
        continue;
      }

      const key = match[1];

      if (process.env[key] !== undefined) {
        continue;
      }

      const rawValue = match[2] || "";
      process.env[key] = parseEnvValue(rawValue);
    }
  } catch {
    // Intentionally ignore .env parsing errors and keep process env unchanged.
  }
}

function parseEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unquoted = value.slice(1, -1);
    return value.startsWith('"')
      ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      : unquoted;
  }

  const commentIndex = value.search(/\s#/);
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value.trim();
}
