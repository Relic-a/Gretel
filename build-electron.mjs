#!/usr/bin/env node
/**
 * Build script: compiles Next.js (standalone) then packages with electron-builder.
 *
 * Usage:
 *   node build-electron.mjs           # build all (depends on host platform)
 *   node build-electron.mjs --win     # build Windows on Linux (needs wine)
 *   node build-electron.mjs --linux   # build Linux targets
 *   node build-electron.mjs --mac     # build macOS targets
 */
import { spawn } from "node:child_process";
import { cp, mkdir, rm, access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const args = process.argv.slice(2);
const targetFlag = args.find((a) => a.startsWith("--")) || "";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32" && cmd.endsWith(".cmd"),
      cwd: projectRoot,
      ...opts,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(" ")}\` exited with ${code}`));
    });
  });
}

async function getElectronVersion() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  return packageJson.devDependencies.electron.replace(/^[^0-9]*/, "");
}

async function prepareStandaloneNativeModules() {
  const electronVersion = await getElectronVersion();
  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  const standaloneNodeModules = path.join(standaloneDir, "node_modules");

  console.log("\n🔧  Rebuilding native modules for Electron...\n");

  // Next standalone tracing copies only the runtime files for native packages.
  // Rebuilding needs the full package source, so copy better-sqlite3 before npm rebuild.
  await rm(path.join(standaloneNodeModules, "better-sqlite3"), { recursive: true, force: true });
  await cp(
    path.join(projectRoot, "node_modules", "better-sqlite3"),
    path.join(standaloneNodeModules, "better-sqlite3"),
    { recursive: true, force: true }
  );

  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["rebuild", "better-sqlite3", "--prefix", standaloneDir], {
    env: {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: electronVersion,
      npm_config_disturl: "https://electronjs.org/headers",
      npm_config_build_from_source: "true"
    }
  });
}

async function build() {
  console.log("\n🔨  Cleaning old build outputs...\n");
  await rm(path.join(projectRoot, "dist"), { recursive: true, force: true });

  console.log("\n📦  Building Next.js (standalone output)...\n");
  await run(process.execPath, [path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "build"]);

  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  const staticDir = path.join(projectRoot, ".next", "static");
  const standaloneNextDir = path.join(standaloneDir, ".next");

  if (!(await exists(standaloneDir))) {
    throw new Error("Next.js standalone output not found at .next/standalone");
  }

  console.log("\n📁  Copying static assets into standalone...\n");
  await mkdir(standaloneNextDir, { recursive: true });
  await cp(staticDir, path.join(standaloneNextDir, "static"), {
    recursive: true,
    force: true,
  });

  console.log("\n🧹  Removing local env files from standalone output...\n");
  await rm(path.join(standaloneDir, ".env"), { force: true });
  await rm(path.join(standaloneDir, ".env.local"), { force: true });
  await rm(path.join(standaloneDir, ".env.production"), { force: true });
  await rm(path.join(standaloneDir, ".env.production.local"), { force: true });
  await rm(path.join(standaloneDir, "data"), { recursive: true, force: true });
  await rm(path.join(standaloneDir, "logs"), { recursive: true, force: true });

  await prepareStandaloneNativeModules();

  // Make the Electron source available where the packaged app expects it.
  // electron-builder packages from the project root, so .next/standalone/
  // must remain at the root and electron/** stays at the root too.

  console.log("\n🚀  Running electron-builder...\n");
  const builderArgs = [path.join(projectRoot, "node_modules", "electron-builder", "cli.js"), "--publish", "never"];

  if (targetFlag === "--win") builderArgs.push("--win");
  else if (targetFlag === "--linux") builderArgs.push("--linux");
  else if (targetFlag === "--mac") builderArgs.push("--mac");
  // no flag → electron-builder builds for current platform

  await run(process.execPath, builderArgs);

  console.log("\n✅  Done! Check the dist/ folder for your packages.\n");
}

build().catch((err) => {
  console.error("\n❌  Build failed:\n", err.message);
  process.exit(1);
});
