import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, net, protocol } from "electron";

protocol.registerSchemesAsPrivileged([{ scheme: "gretel", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);

const rendererRoot = path.resolve(__dirname, "../dist-renderer");
let mainWindow: BrowserWindow | null = null;

async function registerGretelProtocol() {
  const { routeApiRequest } = await import("./api-router");

  protocol.handle("gretel", async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return routeApiRequest(request);

    const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const requestedPath = path.resolve(rendererRoot, relativePath);
    const assetPath = requestedPath.startsWith(`${rendererRoot}${path.sep}`)
      ? requestedPath : path.join(rendererRoot, "index.html");
    const response = await net.fetch(pathToFileURL(assetPath).toString());
    return response.status === 404
      ? net.fetch(pathToFileURL(path.join(rendererRoot, "index.html")).toString())
      : response;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 900, minWidth: 960, minHeight: 700, show: false,
    backgroundColor: "#f7f7f2",
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  void mainWindow.loadURL("gretel://app/");
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  process.env.GRETEL_DATA_DIR ||= path.join(app.getPath("userData"), "data");
  await registerGretelProtocol();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error("Failed to start Gretel desktop app.", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
