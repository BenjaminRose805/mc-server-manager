import { app, BrowserWindow, screen } from "electron";
import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTray } from "./tray.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

let backendHttpServer: HttpServer | null = null;
let backendWss: WebSocketServer | null = null;
let backendShutdown:
  | ((s: HttpServer, w: WebSocketServer) => Promise<void>)
  | null = null;

const BACKEND_PORT = parseInt(process.env.PORT ?? "3001", 10);
const BACKEND_HOST = process.env.HOST ?? "localhost";

function setElectronEnv(): void {
  if (!isDev) {
    process.env.NODE_ENV = "production";
  }

  process.env.MC_DATA_DIR = app.getPath("userData");

  if (!isDev) {
    const resources = process.resourcesPath;
    process.env.MC_MIGRATIONS_DIR = path.join(
      resources,
      "backend",
      "migrations",
    );
    process.env.MC_FRONTEND_DIST = path.join(resources, "frontend", "dist");
  }
}

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on("close", (e: Electron.Event) => {
    if (!isQuitting && process.platform === "darwin") {
      e.preventDefault();
      win.hide();
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

// Dynamic import loads the backend without triggering standalone auto-start
// because process.versions.electron is set, skipping the isStandaloneEntry guard.
async function startBackend(): Promise<void> {
  const backend = await import("@mc-server-manager/backend");

  backend.initDatabase();

  const result = await backend.startServer(BACKEND_PORT, BACKEND_HOST);
  backendHttpServer = result.httpServer;
  backendWss = result.wss;
  backendShutdown = backend.shutdownServer;

  backend.autoStartServers();
}

app.on("before-quit", async (e: Electron.Event) => {
  if (isQuitting) return;

  e.preventDefault();
  isQuitting = true;

  if (backendShutdown && backendHttpServer && backendWss) {
    try {
      await backendShutdown(backendHttpServer, backendWss);
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
  }

  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});

async function main(): Promise<void> {
  setElectronEnv();

  await app.whenReady();

  if (!isDev) {
    await startBackend();
  }

  const serverUrl = isDev
    ? `http://localhost:5173`
    : `http://${BACKEND_HOST}:${BACKEND_PORT}`;

  if (!isDev) {
    await waitForServer(`http://${BACKEND_HOST}:${BACKEND_PORT}/api/health`);
  }

  mainWindow = createWindow();

  createTray(mainWindow, () => {
    isQuitting = true;
    app.quit();
  });

  mainWindow.loadURL(serverUrl);
}

main().catch((err) => {
  console.error("Fatal error starting application:", err);
  app.quit();
});
