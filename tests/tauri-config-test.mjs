import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(config.identifier, "com.ezana.gretel");
assert.equal(config.version, packageJson.version);
assert.match(packageJson.scripts["dist:win"], /--bundles nsis(?:\s|$)/);
assert.equal(config.build.devUrl, "http://127.0.0.1:3000");
assert.equal(config.build.frontendDist, "frontend");
assert.equal(config.bundle.resources["node-runtime/node.exe"], "node.exe");
assert.equal(config.bundle.resources["../.next/standalone"], ".next/standalone");
assert.ok(existsSync(path.join(root, "src-tauri", "frontend", "index.html")));
assert.ok(existsSync(path.join(root, "src-tauri", "Cargo.toml")));
assert.ok(existsSync(path.join(root, "src-tauri", "icons", "icon.ico")));

console.log("Tauri configuration smoke test passed.");
