import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const layout = readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
const launcher = readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
const titleBar = readFileSync(path.join(root, "app", "components", "WindowTitleBar.tsx"), "utf8");
const startupPage = readFileSync(path.join(root, "src-tauri", "frontend", "index.html"), "utf8");

assert.equal(config.identifier, "com.ezana.gretel");
assert.equal(config.version, packageJson.version);
assert.match(packageJson.scripts["dist:win"], /--bundles nsis(?:\s|$)/);
assert.match(packageJson.scripts["dist:linux"], /--bundles deb,rpm(?:\s|$)/);
assert.equal(config.build.devUrl, "http://127.0.0.1:3000");
assert.equal(config.build.frontendDist, "frontend");
assert.equal(config.app.windows[0].decorations, false);
assert.equal(config.app.withGlobalTauri, true);
assert.equal(config.bundle.resources["node-runtime/node.exe"], "node.exe");
assert.equal(config.bundle.resources["../.next/standalone"], ".next/standalone");
assert.ok(existsSync(path.join(root, "src-tauri", "frontend", "index.html")));
assert.ok(existsSync(path.join(root, "src-tauri", "Cargo.toml")));
assert.ok(existsSync(path.join(root, "src-tauri", "icons", "icon.ico")));
assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/);
assert.match(layout, /from "next\/font\/local"/);
assert.ok(existsSync(path.join(root, "app", "fonts", "space-mono-regular.woff2")));
assert.ok(existsSync(path.join(root, "app", "fonts", "OFL.txt")));
assert.match(launcher, /thread::spawn\(move \|\|/);
assert.match(launcher, /CREATE_NO_WINDOW/);
assert.match(titleBar, /toggleMaximize/);
assert.match(titleBar, /\.minimize\(\)/);
assert.match(titleBar, /\.close\(\)/);
assert.match(startupPage, /data-tauri-drag-region/);
assert.match(startupPage, /toggleMaximize/);
assert.ok(
  launcher.indexOf("app.manage(ServerProcess") < launcher.indexOf("wait_for_server(port"),
  "the server must be managed before readiness is awaited in the background"
);

console.log("Tauri configuration smoke test passed.");
