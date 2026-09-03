import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [assetDirectory, tag] = process.argv.slice(2);
if (!assetDirectory || !tag) {
  throw new Error("Usage: node scripts/verify-release-assets.mjs <asset-dir> <tag>");
}

const version = tag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${tag}`);
}

const archVersion = version.replaceAll("-", "_");
const required = [
  `Gretel_${version}_amd64.AppImage`,
  `Gretel_${version}_amd64.AppImage.sig`,
  `Gretel_${version}_amd64.deb`,
  `Gretel_${version}_amd64.deb.sig`,
  `Gretel-${version}-1.x86_64.rpm`,
  `Gretel-${version}-1.x86_64.rpm.sig`,
  `Gretel_${version}_x64-setup.exe`,
  `Gretel_${version}_x64-setup.exe.sig`,
  `Gretel_${version}_aarch64.dmg`,
  "Gretel.app.tar.gz",
  "Gretel.app.tar.gz.sig",
  `gretel-${archVersion}-1-x86_64.pkg.tar.zst`
];

const files = walk(resolve(assetDirectory));
const byName = new Map(files.map((path) => [basename(path), path]));
const missing = required.filter((name) => !byName.has(name));
const empty = required.filter((name) => byName.has(name) && statSync(byName.get(name)).size === 0);

if (missing.length || empty.length) {
  const details = [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    empty.length ? `empty: ${empty.join(", ")}` : ""
  ].filter(Boolean).join("; ");
  throw new Error(`Release inventory is incomplete (${details})`);
}

console.log(`Verified ${required.length} required assets for ${tag}.`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
