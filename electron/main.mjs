import path from "node:path";
import { fileURLToPath } from "node:url";

// Set Ozone platform switches BEFORE importing electron's app module
if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
  process.argv.push("--enable-features=UseOzonePlatform", "--ozone-platform=wayland");
}

import { app, BrowserWindow } from "electron";
import { ensureAppServer, stopAppServer } from "./server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverChild = null;
let appUrl = process.env.GRETEL_APP_URL || "http://localhost:3000";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: "#f7f7f2",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.mjs")
    }
  });

  void mainWindow.loadURL(appUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    if (!process.env.GRETEL_APP_URL) {
      const server = await ensureAppServer();
      serverChild = server.child;
      appUrl = `http://127.0.0.1:${server.port}`;
    }

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error("Failed to start Gretel desktop app.", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await stopAppServer(serverChild);
});
