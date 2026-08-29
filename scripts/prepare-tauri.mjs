#!/usr/bin/env node

import { access, cp, mkdir, readdir, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const standaloneDir = path.join(projectRoot, ".next", "standalone");
const runtimeDir = path.join(projectRoot, "src-tauri", "node-runtime");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function hostTargetTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch {
    const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return output.match(/^host:\s*(\S+)/m)?.[1] || "";
  }
}

const requestedTarget = process.env.TAURI_ENV_TARGET_TRIPLE;
if (requestedTarget) {
  const hostTarget = hostTargetTriple();
  if (hostTarget && requestedTarget !== hostTarget) {
    throw new Error(
      `Cannot bundle the host Node.js runtime for ${requestedTarget} from ${hostTarget}. ` +
        "Build on the target platform or provide a target-specific Node runtime."
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", shell: process.platform === "win32" && command.endsWith(".cmd") });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await run(process.execPath, [nextBin, "build"]);

if (!(await exists(path.join(standaloneDir, "server.js")))) {
  throw new Error("Next.js standalone server was not created at .next/standalone/server.js.");
}

if (!(await exists(path.join(projectRoot, ".next", "static")))) {
  throw new Error("Next.js static assets were not created at .next/static.");
}

await mkdir(path.join(standaloneDir, ".next"), { recursive: true });
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneDir, ".next", "static"), { recursive: true, force: true });
await rm(path.join(standaloneDir, ".env"), { force: true });
await rm(path.join(standaloneDir, ".env.local"), { force: true });
await rm(path.join(standaloneDir, ".env.production"), { force: true });
await rm(path.join(standaloneDir, ".env.production.local"), { force: true });
await rm(path.join(standaloneDir, "data"), { recursive: true, force: true });
await rm(path.join(standaloneDir, "logs"), { recursive: true, force: true });
await materializeStandaloneModuleAliases();

await mkdir(runtimeDir, { recursive: true });
const isWindows = process.platform === "win32" || (requestedTarget && requestedTarget.includes("windows"));
const nodeExeName = isWindows ? "node.exe" : "node";

// Clear previous binaries
await rm(path.join(runtimeDir, "node.exe"), { force: true });
await rm(path.join(runtimeDir, "node"), { force: true });

await cp(process.execPath, path.join(runtimeDir, nodeExeName), { force: true });

if (!isWindows) {
  const { chmod } = await import("node:fs/promises");
  await chmod(path.join(runtimeDir, nodeExeName), 0o755);
}

console.log(`Prepared Next.js standalone output and bundled Node.js runtime (${nodeExeName}) for Tauri.`);

async function materializeStandaloneModuleAliases() {
  const aliasesDir = path.join(standaloneDir, ".next", "node_modules");

  if (!(await exists(aliasesDir))) {
    return;
  }

  for (const entry of await readdir(aliasesDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) {
      continue;
    }

    const aliasPath = path.join(aliasesDir, entry.name);
    const targetPath = path.resolve(aliasesDir, await readlink(aliasPath));

    await rm(aliasPath, { recursive: true, force: true });
    await cp(targetPath, aliasPath, { recursive: true, dereference: true, force: true });
  }
}
