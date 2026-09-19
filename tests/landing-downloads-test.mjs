import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RELEASES_URL,
  buildDownloadTargets
} from "../app/components/landing/landing-data.ts";

// The landing page links straight at the platform installers. Those links must
// keep matching the asset names the release workflow publishes, otherwise the
// download buttons 404 for everyone.
const verifier = readFileSync(new URL("../scripts/verify-release-assets.mjs", import.meta.url), "utf8");

const version = "1.2.3";
const archVersion = version.replaceAll("-", "_");

// Pull the required asset templates out of the verifier so this test fails if
// either side drifts instead of hardcoding the names twice.
const requiredBlock = verifier.match(/const required = \[([\s\S]*?)\];/)?.[1] || "";
const templates = [...requiredBlock.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
assert.ok(templates.length >= 6, "release verifier should declare its required assets");

const publishedAssets = (await import(
  `data:text/javascript,${encodeURIComponent(
    `const version = ${JSON.stringify(version)}; const archVersion = ${JSON.stringify(archVersion)};` +
      `export default [${templates.map((t) => `\`${t}\``).join(",")}];`
  )}`
)).default;

// Signatures and the macOS app tarball are updater-only and are not offered as
// direct downloads on the landing page.
const landingFiles = new Set(buildDownloadTargets(version).map((target) => target.fileName));
const offered = publishedAssets.filter((asset) => !asset.endsWith(".sig") && asset !== "Gretel.app.tar.gz");

assert.deepEqual(
  [...landingFiles].sort(),
  [...offered].sort(),
  "landing download buttons must offer exactly the published platform installers"
);

for (const target of buildDownloadTargets(version)) {
  const expectedUrl = `${RELEASES_URL}/latest/download/${encodeURIComponent(target.fileName)}`;
  assert.equal(target.url, expectedUrl, `${target.fileName} should link at the latest release asset`);
  assert.equal(target.label.length > 0 && target.detail.length > 0, true, "each target needs label and detail copy");
}

console.log("landing download mapping tests passed");
