#!/usr/bin/env node
/**
 * Build script: compiles the Vite renderer and Electron backend, then packages them.
 *
 * Usage:
 *   node build-electron.mjs           # build all (depends on host platform)
 *   node build-electron.mjs --win     # build Windows on Linux (needs wine)
 *   node build-electron.mjs --linux   # build Linux targets
 *   node build-electron.mjs --mac     # build macOS targets
 */
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const args = process.argv.slice(2);
const targetFlag = args.find((a) => a.startsWith("--")) || "";

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

async function build() {
  console.log("\n🔨  Cleaning old build outputs...\n");
  await rm(path.join(projectRoot, "dist"), { recursive: true, force: true });

  console.log("\n📦  Building the renderer and desktop backend...\n");
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);

  const packageRoot = path.join(projectRoot, "package");
  const projectPackage = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(path.join(projectRoot, "dist-electron"), path.join(packageRoot, "dist-electron"), { recursive: true });
  await cp(path.join(projectRoot, "dist-renderer"), path.join(packageRoot, "dist-renderer"), { recursive: true });
  await cp(path.join(projectRoot, "config"), path.join(packageRoot, "config"), { recursive: true });
  await cp(
    path.join(packageRoot, "dist-electron", "node_modules"),
    path.join(packageRoot, "node_modules"),
    { recursive: true }
  );
  await rm(path.join(packageRoot, "dist-electron", "node_modules"), { recursive: true, force: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: projectPackage.name,
    version: projectPackage.version,
    description: projectPackage.description,
    author: projectPackage.author,
    main: projectPackage.main,
    type: projectPackage.type,
    dependencies: { "better-sqlite3": projectPackage.dependencies["better-sqlite3"] },
    private: true
  }, null, 2));

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
