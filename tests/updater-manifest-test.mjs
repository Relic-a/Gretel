import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "gretel-updater-manifest-"));

try {
  const artifacts = [
    "Gretel_0.4.2_amd64.AppImage",
    "Gretel_0.4.2_x64-setup.nsis.zip",
    "Gretel.app.tar.gz"
  ];

  for (const artifact of artifacts) {
    writeFileSync(join(directory, artifact), "artifact");
    writeFileSync(join(directory, `${artifact}.sig`), `${artifact}-signature\n`);
  }

  const output = join(directory, "latest.json");
  execFileSync(process.execPath, [
    new URL("../scripts/create-updater-manifest.mjs", import.meta.url).pathname,
    directory,
    "v0.4.2",
    "Relic-a/Gretel",
    output
  ]);

  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(manifest.version, "0.4.2");
  assert.equal(manifest.platforms["linux-x86_64"].signature, "Gretel_0.4.2_amd64.AppImage-signature");
  assert.match(manifest.platforms["linux-x86_64"].url, /Gretel_0\.4\.2_amd64\.AppImage$/);
  assert.match(manifest.platforms["windows-x86_64"].url, /Gretel_0\.4\.2_x64-setup\.nsis\.zip$/);
  assert.match(manifest.platforms["darwin-aarch64"].url, /Gretel\.app\.tar\.gz$/);

  console.log("updater manifest tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
