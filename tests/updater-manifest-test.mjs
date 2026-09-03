import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "gretel-updater-manifest-"));

try {
  const artifacts = [
    "Gretel_0.5.0_amd64.AppImage",
    "Gretel_0.5.0_amd64.deb",
    "Gretel-0.5.0-1.x86_64.rpm",
    "Gretel_0.5.0_x64-setup.exe",
    "Gretel.app.tar.gz"
  ];

  for (const artifact of artifacts) {
    writeFileSync(join(directory, artifact), "artifact");
    writeFileSync(join(directory, `${artifact}.sig`), `${artifact}-signature\n`);
  }

  const output = join(directory, "latest.json");
  execFileSync(process.execPath, [
    fileURLToPath(new URL("../scripts/create-updater-manifest.mjs", import.meta.url)),
    directory,
    "v0.5.0",
    "Relic-a/Gretel",
    output
  ]);

  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(manifest.version, "0.5.0");
  assert.equal(manifest.platforms["linux-x86_64"].signature, "Gretel_0.5.0_amd64.AppImage-signature");
  assert.equal(manifest.platforms["linux-x86_64-appimage"].signature, "Gretel_0.5.0_amd64.AppImage-signature");
  assert.match(manifest.platforms["linux-x86_64"].url, /Gretel_0\.5\.0_amd64\.AppImage$/);
  assert.match(manifest.platforms["linux-x86_64-deb"].url, /Gretel_0\.5\.0_amd64\.deb$/);
  assert.match(manifest.platforms["linux-x86_64-rpm"].url, /Gretel-0\.5\.0-1\.x86_64\.rpm$/);
  assert.match(manifest.platforms["windows-x86_64"].url, /Gretel_0\.5\.0_x64-setup\.exe$/);
  assert.match(manifest.platforms["darwin-aarch64"].url, /Gretel\.app\.tar\.gz$/);

  console.log("updater manifest tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
