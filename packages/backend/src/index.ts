import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./services/database.js";
import { serverManager } from "./services/server-manager.js";
import { setupWebSocketServer } from "./ws/index.js";
import { getAllServers } from "./models/server.js";
import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";

// Register all server type providers (side-effect imports)
import "./providers/vanilla.js";
import "./providers/paper.js";
import "./providers/fabric.js";
import "./providers/forge.js";

export { app } from "./app.js";
export { config } from "./config.js";
export { initDatabase, closeDatabase } from "./services/database.js";
export { serverManager } from "./services/server-manager.js";
export { setupWebSocketServer } from "./ws/index.js";

/**
 * Start the HTTP server and attach WebSocket server.
 * Returns { httpServer, wss } for the caller to manage.
 */
export function startServer(
  port?: number,
  host?: string,
): Promise<{ httpServer: HttpServer; wss: WebSocketServer }> {
  const p = port ?? config.port;
  const h = host ?? config.host;

  return new Promise((resolve) => {
    const httpServer = app.listen(p, h, () => {
      logger.info(`Backend server running at http://${h}:${p}`);
      logger.info(`Health check: http://${h}:${p}/api/health`);
      resolve({ httpServer, wss });
    });

    const wss = setupWebSocketServer(httpServer);
  });
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

// Standalone mode: side effects run only when executed directly (node dist/index.js).
// When imported by Electron, the caller controls startup via the exported functions.
const isStandaloneEntry =
  !process.env.ELECTRON_RUN_AS_NODE &&
  !process.versions.electron &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("\\index.js") ||
    process.argv[1].endsWith("/index.ts"));

if (isStandaloneEntry) {
  initDatabase();

  const { httpServer, wss } = await startServer();

  autoStartServers();

  // Graceful shutdown
  const shutdown = async () => {
    await shutdownServer(httpServer, wss);
    process.exit(0);
  };

  // Force exit after 60 seconds (need time for MC servers to stop)
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
