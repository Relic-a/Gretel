import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const appRoot = projectRoot.endsWith(".asar") ? projectRoot.replace(/\.asar$/, ".asar.unpacked") : projectRoot;
const defaultPort = Number.parseInt(process.env.PORT || "3000", 10);

export async function ensureAppServer() {
  if (isDevServerMode()) {
    await waitForServer(defaultPort);
    return { port: defaultPort, child: null };
  }

  const serverEntry = path.join(appRoot, ".next", "standalone", "server.js");
  await access(serverEntry);

  const child = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(defaultPort),
      HOSTNAME: "127.0.0.1"
    },
    stdio: "pipe"
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`Embedded Next.js server exited from signal ${signal}.`);
      return;
    }

    if (code !== 0) {
      console.error(`Embedded Next.js server exited with code ${code}.`);
    }
  });

  await waitForServer(defaultPort);
  return { port: defaultPort, child };
}

export async function stopAppServer(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  await onceExit(child, 5_000);

  if (!child.killed) {
    child.kill("SIGKILL");
    await onceExit(child, 1_000);
  }
}

function isDevServerMode() {
  return process.env.NODE_ENV === "development" || process.env.ELECTRON_DEV === "1";
}

async function waitForServer(port, timeoutMs = 30_000) {
  const startedAt = Date.now();
  const target = `http://127.0.0.1:${port}`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(1_500) });

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(`Timed out waiting for Gretel server at ${target}.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
