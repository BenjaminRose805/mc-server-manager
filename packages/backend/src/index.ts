import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./services/database.js";
import { serverManager } from "./services/server-manager.js";
import { setupWebSocketServer } from "./ws/index.js";
import { getAllServers } from "./models/server.js";
import {
  startPeriodicUpdateCheck,
  stopPeriodicUpdateCheck,
} from "./services/modpack-update-checker.js";
import https from "node:https";
import { setupTLS } from "./services/tls.js";
import { setupPortForwarding, removePortForwarding } from "./services/upnp.js";
import { cleanupExpiredSessions } from "./services/session.js";
import { cleanupOldAttempts } from "./services/brute-force.js";
import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";

// Register all server type providers (side-effect imports)
import "./providers/vanilla.js";
import "./providers/paper.js";
import "./providers/fabric.js";
import "./providers/forge.js";
import "./providers/neoforge.js";

export { app } from "./app.js";
export { config } from "./config.js";
export { initDatabase, closeDatabase } from "./services/database.js";
export { serverManager } from "./services/server-manager.js";
export { setupWebSocketServer } from "./ws/index.js";

import fs from "node:fs";
import path from "node:path";

const MAX_PORT_RETRIES = 10;

function tryListen(
  httpServer: HttpServer,
  port: number,
  host: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.removeListener("error", onError);
      reject(err);
    };
    httpServer.on("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", onError);
      resolve(port);
    });
  });
}

/**
 * Start the HTTP server and attach WebSocket server.
 * If the port is in use, retries on successive ports.
 * Writes the actual port to `<dataDir>/backend.port` for discovery.
 */
export async function startServer(
  port?: number,
  host?: string,
): Promise<{
  httpServer: HttpServer;
  wss: WebSocketServer;
  actualPort: number;
}> {
  let p = port ?? config.port;
  const h = host ?? config.host;

  const tlsResult = await setupTLS(config.tls, config.dataDir);

  let httpServer: HttpServer;
  if (tlsResult) {
    httpServer = https.createServer(
      { cert: tlsResult.cert, key: tlsResult.key },
      app,
    );
  } else {
    httpServer = (await import("node:http")).createServer(app);
  }

  let actualPort = p;
  for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
    try {
      actualPort = await tryListen(httpServer, p + attempt, h);
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        logger.warn({ port: p + attempt }, "Port in use, trying next");
        if (attempt === MAX_PORT_RETRIES - 1) throw err;
        continue;
      }
      throw err;
    }
  }

  const proto = tlsResult ? "https" : "http";
  logger.info(`Backend server running at ${proto}://${h}:${actualPort}`);

  const portFile = path.join(config.dataDir, "backend.port");
  fs.writeFileSync(portFile, String(actualPort), "utf-8");

  // Machine-readable line for sidecar/Tauri to parse
  console.log(`__BACKEND_PORT__=${actualPort}`);

  const wss = setupWebSocketServer(httpServer);
  return { httpServer, wss, actualPort };
}

/**
 * Auto-start servers that have autoStart enabled.
 * Should be called after the Express server is ready.
 */
export async function autoStartServers(): Promise<void> {
  const servers = getAllServers().filter((s) => s.autoStart);
  if (servers.length === 0) return;

  logger.info({ count: servers.length }, "Auto-starting servers...");
  for (const s of servers) {
    try {
      await serverManager.start(s.id);
      logger.info({ serverId: s.id, name: s.name }, "Auto-started server");
    } catch (err) {
      logger.error(
        { err, serverId: s.id, name: s.name },
        "Failed to auto-start server",
      );
    }
  }
}

/**
 * Graceful shutdown: stop all MC servers, close WS and HTTP.
 */
export async function shutdownServer(
  httpServer: HttpServer,
  wss: WebSocketServer,
): Promise<void> {
  logger.info("Shutting down...");

  // Stop all running Minecraft servers first
  try {
    await serverManager.shutdownAll();
  } catch (err) {
    logger.error({ err }, "Error shutting down Minecraft servers");
  }

  // Close WebSocket server first (terminates all client connections)
  wss.close(() => {
    logger.info("WebSocket server closed");
  });

  return new Promise<void>((resolve) => {
    httpServer.close(() => {
      closeDatabase();
      logger.info("Server closed");
      resolve();
    });
  });
}

const isPkg = "pkg" in process;
const isStandaloneEntry =
  isPkg ||
  (!process.env.ELECTRON_RUN_AS_NODE &&
    !process.versions.electron &&
    process.argv[1] !== undefined &&
    (process.argv[1].endsWith("/index.js") ||
      process.argv[1].endsWith("\\index.js") ||
      process.argv[1].endsWith("/index.ts") ||
      process.argv[1].endsWith("/index.cjs") ||
      process.argv[1].endsWith("/server.cjs") ||
      process.argv[1].endsWith("\\server.cjs")));

async function main() {
  initDatabase();

  const { httpServer, wss, actualPort } = await startServer();

  autoStartServers();
  startPeriodicUpdateCheck();

  const cleanupInterval = setInterval(
    () => {
      try {
        cleanupExpiredSessions();
        cleanupOldAttempts();
      } catch (err) {
        logger.error({ err }, "Periodic cleanup failed");
      }
    },
    60 * 60 * 1000,
  );

  if (config.upnpEnabled) {
    setupPortForwarding(actualPort).catch((err) => {
      logger.error({ err }, "UPnP port forwarding failed");
    });
  }

  const shutdown = async () => {
    stopPeriodicUpdateCheck();
    clearInterval(cleanupInterval);
    if (config.upnpEnabled) {
      await removePortForwarding(actualPort);
    }
    await shutdownServer(httpServer, wss);
    process.exit(0);
  };

  const forceExit = () => {
    setTimeout(() => {
      logger.warn("Forced exit after timeout");
      process.exit(1);
    }, 60_000);
  };

  process.on("SIGINT", () => {
    forceExit();
    shutdown();
  });
  process.on("SIGTERM", () => {
    forceExit();
    shutdown();
  });
}

if (isStandaloneEntry) {
  main();
}
