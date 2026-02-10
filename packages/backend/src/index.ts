import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./services/database.js";
import { serverManager } from "./services/server-manager.js";
import { setupWebSocketServer } from "./ws/index.js";
import { getAllServers } from "./models/server.js";

// Register all server type providers (side-effect imports)
import "./providers/vanilla.js";
import "./providers/paper.js";
import "./providers/fabric.js";
import "./providers/forge.js";

// Initialize database before starting the server
initDatabase();

const server = app.listen(config.port, config.host, () => {
  logger.info(`Backend server running at http://${config.host}:${config.port}`);
  logger.info(`Health check: http://${config.host}:${config.port}/api/health`);
});

// Attach WebSocket server to the HTTP server
const wss = setupWebSocketServer(server);

// Auto-start servers that have autoStart enabled
(async () => {
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
})();

// Graceful shutdown
const shutdown = async () => {
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

  server.close(() => {
    closeDatabase();
    logger.info("Server closed");
    process.exit(0);
  });

  // Force exit after 60 seconds (need time for MC servers to stop)
  setTimeout(() => {
    logger.warn("Forced exit after timeout");
    process.exit(1);
  }, 60_000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
