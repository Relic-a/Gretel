import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await rm("dist-electron", { recursive: true, force: true });

await build({
  entryPoints: ["electron/main.ts", "electron/preload.mjs"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  minify: true,
  external: ["electron", "better-sqlite3"],
  logLevel: "info"
});

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const nativeRoot = "dist-electron/node_modules";
await mkdir(nativeRoot, { recursive: true });

for (const dependency of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  await cp(`node_modules/${dependency}`, `${nativeRoot}/${dependency}`, {
    recursive: true,
    force: true
  });
}

await writeFile("dist-electron/package.json", JSON.stringify({
  private: true,
  dependencies: { "better-sqlite3": packageJson.dependencies["better-sqlite3"] }
}));

const rebuild = spawnSync(
  process.execPath,
  ["node_modules/@electron/rebuild/lib/cli.js",
    "-f", "-w", "better-sqlite3", "-m", "dist-electron", "-v",
    packageJson.devDependencies.electron.replace(/^[^0-9]*/, "")],
  {
    stdio: "inherit"
  }
);

if (rebuild.status !== 0) process.exit(rebuild.status || 1);
