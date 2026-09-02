import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
assert.deepEqual(config.plugins.updater.endpoints, ["https://github.com/Relic-a/Gretel/releases/latest/download/latest.json"]);
assert.ok(capability.permissions.includes("updater:default"));
assert.ok(capability.permissions.includes("process:allow-restart"));

console.log("updater configuration tests passed");
