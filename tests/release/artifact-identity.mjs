import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

let cachedManifest = null;
let cachedArtifactPath = null;

/**
 * Computes a deterministic artifact manifest and composite SHA-256 hash
 * covering all bundled chunks and assets in the target directory.
 */
export function getArtifactIdentity(artifactPath) {
  const resolved = path.resolve(artifactPath);
  if (cachedArtifactPath === resolved && cachedManifest) {
    return cachedManifest;
  }

  const entries = [];
  const walk = (current, relativePrefix = "") => {
    let names;
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === "cache" || name === ".cache") continue;
      const fullPath = path.join(current, name);
      const relPath = path.join(relativePrefix, name);
      try {
        const stat = lstatSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, relPath);
        } else if (stat.isFile()) {
          const content = readFileSync(fullPath);
          const hash = createHash("sha256").update(content).digest("hex");
          entries.push({ path: relPath, size: stat.size, sha256: hash });
        }
      } catch {}
    }
  };

  walk(resolved);
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const manifestHash = createHash("sha256");
  let totalBytes = 0;
  for (const entry of entries) {
    manifestHash.update(`${entry.path}:${entry.sha256}:${entry.size}\n`);
    totalBytes += entry.size;
  }

  let serverSha256 = null;
  const serverEntry = entries.find((e) => e.path === "server.js");
  if (serverEntry) {
    serverSha256 = serverEntry.sha256;
  }

  let packageVersion = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(path.join(resolved, "package.json"), "utf8"));
    if (pkg.version) packageVersion = pkg.version;
  } catch {}

  const identity = {
    path: resolved,
    present: entries.length > 0,
    manifestSha256: manifestHash.digest("hex"),
    filesCount: entries.length,
    totalBytes,
    serverSha256,
    version: packageVersion,
    runtime: {
      type: "system-node",
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };

  cachedArtifactPath = resolved;
  cachedManifest = identity;
  return identity;
}
