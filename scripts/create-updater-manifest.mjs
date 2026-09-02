import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [assetDirectory, tag, repository, outputPath] = process.argv.slice(2);
if (!assetDirectory || !tag || !repository || !outputPath) {
  throw new Error("Usage: node scripts/create-updater-manifest.mjs <asset-dir> <tag> <owner/repo> <output>");
}

const version = tag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid release version: ${tag}`);

const files = walk(resolve(assetDirectory));
const targets = [
  { platform: "linux-x86_64", suffix: ".AppImage" },
  { platform: "windows-x86_64", suffix: "-setup.exe" },
  { platform: "darwin-aarch64", suffix: ".app.tar.gz" }
];
const platforms = {};

for (const target of targets) {
  const matches = files.filter((path) => path.endsWith(target.suffix));
  if (matches.length !== 1) throw new Error(`Expected one ${target.suffix} artifact, found ${matches.length}`);
  const artifact = matches[0];
  const signaturePath = `${artifact}.sig`;
  if (!files.includes(signaturePath)) throw new Error(`Missing signature for ${basename(artifact)}`);
  platforms[target.platform] = {
    signature: readFileSync(signaturePath, "utf8").trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(basename(artifact))}`
  };
}

writeFileSync(outputPath, `${JSON.stringify({ version, notes: `Gretel ${tag}`, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
