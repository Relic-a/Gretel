// Test-only network guard loaded into the owned production server process.
// Deterministic soak runs may talk to their loopback HTTP server, but every
// other HTTP(S) request is recorded and rejected before it reaches the host.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const originalFetch = globalThis.fetch;
const logPath = process.env.GRETEL_SOAK_NETWORK_LOG;

function record(event) {
  if (!logPath) return;
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  } catch {}
}

function isLoopback(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

if (process.env.GRETEL_SOAK_BLOCKOUTBOUND === "1" && typeof originalFetch === "function") {
  record({ type: "guard-ready" });
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (!isLoopback(url)) {
      record({ type: "blocked", url: redactUrl(url), method: init?.method || "GET" });
      throw new Error("Gretel deterministic soak blocked outbound network request");
    }
    return originalFetch.call(this, input, init);
  };
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}
