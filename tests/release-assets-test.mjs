import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "gretel-release-assets-"));
const nested = join(directory, "artifacts");
const verifier = fileURLToPath(new URL("../scripts/verify-release-assets.mjs", import.meta.url));
const assets = [
  "Gretel_0.5.1_amd64.AppImage",
  "Gretel_0.5.1_amd64.AppImage.sig",
  "Gretel_0.5.1_amd64.deb",
  "Gretel_0.5.1_amd64.deb.sig",
  "Gretel-0.5.1-1.x86_64.rpm",
  "Gretel-0.5.1-1.x86_64.rpm.sig",
  "Gretel_0.5.1_x64-setup.exe",
  "Gretel_0.5.1_x64-setup.exe.sig",
  "Gretel_0.5.1_aarch64.dmg",
  "Gretel.app.tar.gz",
  "Gretel.app.tar.gz.sig",
  "gretel-0.5.1-1-x86_64.pkg.tar.zst"
];

try {
  mkdirSync(nested);
  for (const asset of assets) writeFileSync(join(nested, asset), "artifact");

  execFileSync(process.execPath, [verifier, directory, "v0.5.1"]);
  unlinkSync(join(nested, assets[0]));
  assert.throws(
    () => execFileSync(process.execPath, [verifier, directory, "v0.5.1"], { stdio: "pipe" }),
    /Command failed/
  );
  console.log("release asset inventory tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
