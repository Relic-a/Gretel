import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
const installModePermission = JSON.parse(readFileSync(new URL("../src-tauri/permissions/update-install-mode.json", import.meta.url), "utf8")).permission[0];

assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
assert.deepEqual(config.plugins.updater.endpoints, ["https://github.com/Relic-a/Gretel/releases/latest/download/latest.json"]);
assert.ok(capability.permissions.includes("updater:default"));
assert.ok(capability.permissions.includes("process:allow-restart"));
// The packaged UI is served over loopback HTTP. Custom commands need an
// explicit grant there, even when they work from a bundled local page.
assert.deepEqual(capability.remote.urls, ["http://127.0.0.1:*"]);
assert.ok(capability.permissions.includes(installModePermission.identifier));
assert.deepEqual(installModePermission.commands.allow, ["update_install_mode"]);

console.log("updater configuration tests passed");
