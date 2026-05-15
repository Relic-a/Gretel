import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const appRoot = projectRoot.endsWith(".asar") ? projectRoot.replace(/\.asar$/, ".asar.unpacked") : projectRoot;
const preferredPort = Number.parseInt(process.env.PORT || "0", 10);

export async function ensureAppServer() {
  const port = await resolvePort(preferredPort);

  if (isDevServerMode()) {
    const child = spawn(process.execPath, [path.join(appRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "development",
        PORT: String(port),
        HOSTNAME: "127.0.0.1"
      },
      stdio: "pipe"
    });

    pipeServerOutput(child, "Next.js dev server");
    await waitForServer(port);
    return { port, child };
  }

  const serverEntry = path.join(appRoot, ".next", "standalone", "server.js");
  await access(serverEntry);

  const child = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1"
    },
    stdio: "pipe"
  });

  pipeServerOutput(child, "Embedded Next.js server");
  await waitForServer(port);
  return { port, child };
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

async function resolvePort(port) {
  if (Number.isInteger(port) && port > 0) {
    return port;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Could not resolve an available Gretel server port."));
      });
    });
  });
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

function pipeServerOutput(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`${label} exited from signal ${signal}.`);
      return;
    }

    if (code !== 0) {
      console.error(`${label} exited with code ${code}.`);
    }
  });
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
