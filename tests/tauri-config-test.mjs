import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const capability = JSON.parse(
  readFileSync(path.join(root, "src-tauri", "capabilities", "default.json"), "utf8")
);
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const layout = readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
const launcher = readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
const executable = readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const titleBar = readFileSync(path.join(root, "app", "components", "WindowTitleBar.tsx"), "utf8");
const startupPage = readFileSync(path.join(root, "src-tauri", "frontend", "index.html"), "utf8");
const archPackageScript = readFileSync(path.join(root, "scripts", "package-arch-release.sh"), "utf8");
const appImageWorkflow = readFileSync(path.join(root, ".github", "workflows", "appimage.yml"), "utf8");
const releaseWorkflow = readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");

assert.equal(config.identifier, "com.ezana.gretel");
assert.equal(config.version, packageJson.version);
assert.match(packageJson.scripts["dist:win"], /--bundles nsis(?:\s|$)/);
assert.match(packageJson.scripts["dist:linux"], /--bundles deb,rpm(?:\s|$)/);
assert.equal(config.build.devUrl, "http://127.0.0.1:3000");
assert.equal(config.build.frontendDist, "frontend");
assert.equal(config.app.windows[0].decorations, false);
assert.equal(config.app.withGlobalTauri, true);
assert.deepEqual(capability.remote.urls, ["http://127.0.0.1:*"]);
assert.ok(capability.permissions.includes("core:window:allow-close"));
assert.ok(capability.permissions.includes("core:window:allow-start-dragging"));
assert.ok(
  capability.permissions.some((permission) =>
    typeof permission === "object" &&
    permission.identifier === "opener:allow-open-url" &&
    permission.allow?.some((scope) => scope.url === "https://www.youtube.com/*")
  )
);
assert.ok(Boolean(config.bundle.resources["node-runtime"] || config.bundle.resources["node-runtime/*"] || config.bundle.resources["node-runtime/node.exe"]));
assert.equal(config.bundle.resources["../.next/standalone"], ".next/standalone");
assert.equal(config.bundle.linux.appimage.bundleMediaFramework, true);
for (const dependency of [
  "gstreamer1.0-plugins-base",
  "gstreamer1.0-plugins-good",
  "gstreamer1.0-plugins-bad",
  "gstreamer1.0-libav"
]) {
  assert.ok(config.bundle.linux.deb.depends.includes(dependency));
}
for (const dependency of [
  "gstreamer1-plugins-base",
  "gstreamer1-plugins-good",
  "gstreamer1-plugins-bad-free",
  "gstreamer1-plugin-openh264"
]) {
  assert.ok(config.bundle.linux.rpm.depends.includes(dependency));
}
assert.ok(config.bundle.linux.rpm.recommends.includes("gstreamer1-plugin-libav"));
for (const dependency of ["gst-plugins-good", "gst-plugins-bad", "gst-libav"]) {
  assert.match(archPackageScript, new RegExp(`'${dependency}'`));
}
assert.match(appImageWorkflow, /gstreamer1\.0-plugins-good/);
assert.match(appImageWorkflow, /squashfs-root\/usr\/lib\/gstreamer-1\.0/);
assert.match(releaseWorkflow, /Verify Linux package media dependencies/);
assert.ok(existsSync(path.join(root, "src-tauri", "frontend", "index.html")));
assert.ok(existsSync(path.join(root, "src-tauri", "Cargo.toml")));
assert.ok(existsSync(path.join(root, "src-tauri", "icons", "icon.ico")));
assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/);
assert.match(layout, /from "next\/font\/local"/);
assert.ok(existsSync(path.join(root, "app", "fonts", "space-mono-regular.woff2")));
assert.ok(existsSync(path.join(root, "app", "fonts", "OFL.txt")));
assert.match(launcher, /thread::spawn\(move \|\|/);
assert.match(launcher, /tauri_plugin_opener::init\(\)/);
assert.match(launcher, /CREATE_NO_WINDOW/);
assert.match(launcher, /GRETEL_RENDER_MODE/);
assert.match(launcher, /__NV_DISABLE_EXPLICIT_SYNC/);
assert.match(launcher, /WEBKIT_DISABLE_DMABUF_RENDERER/);
assert.ok(
  launcher.indexOf("configure_linux_rendering();") < launcher.indexOf("tauri::Builder::default()"),
  "Linux renderer environment must be configured before WebKit starts"
);
assert.match(executable, /windows_subsystem = "windows"/);
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
