/**
 * WebSocket server setup.
 *
 * Attaches a `ws` WebSocketServer to the existing HTTP server,
 * wires up ServerManager events to broadcast to subscribed clients,
 * and runs a periodic stats interval.
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type {
  WsConsoleLine,
  WsStatusChange,
  WsStats,
  WsModpackProgress,
  WsModpackUpdateAvailable,
} from "@mc-server-manager/shared";
import { serverManager } from "../services/server-manager.js";
import { eventBus } from "../services/event-bus.js";
import { logger } from "../utils/logger.js";
import {
  handleMessage,
  handleDisconnect,
  initAuth,
  getSubscriptions,
  sendMessage,
} from "./handlers.js";

/** Stats broadcast interval in milliseconds. */
const STATS_INTERVAL_MS = 10_000;

let statsInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the WebSocket server and attach it to the HTTP server.
 * Call this once from index.ts after the HTTP server is listening.
 */
export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
  });

  logger.info("WebSocket server attached at /ws");

  // ---- Connection handling ----

  wss.on("connection", (ws: WebSocket) => {
    logger.info({ clients: wss.clients.size }, "WebSocket client connected");
    initAuth(ws);

    ws.on("message", (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString();
      handleMessage(ws, raw);
    });

    ws.on("close", () => {
      handleDisconnect(ws);
      logger.info(
        { clients: wss.clients.size },
        "WebSocket client disconnected",
      );
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket client error");
    });
  });

  // ---- Wire ServerManager events → broadcast to subscribers ----

  wireServerManagerEvents(wss);

  // ---- Wire event bus → broadcast modpack progress ----

  wireEventBus(wss);

  // ---- Periodic stats broadcast ----

  startStatsInterval(wss);

  // ---- Cleanup on server close ----

  wss.on("close", () => {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    logger.info("WebSocket server closed");
  });

  return wss;
}

// ---- Broadcasting helpers ----

/**
 * Send a message to all clients subscribed to a specific server.
 */
function broadcast(
  wss: WebSocketServer,
  serverId: string,
  message: unknown,
): void {
  for (const client of wss.clients) {
    const ws = client as WebSocket;
    const subs = getSubscriptions(ws);
    if (subs.has(serverId)) {
      sendMessage(ws, message);
    }
  }
}

/**
 * Register listeners on ServerManager to relay events to WebSocket clients.
 */
function wireServerManagerEvents(wss: WebSocketServer): void {
  // Console output → broadcast to subscribers
  serverManager.onConsole((serverId, entry) => {
    const msg: WsConsoleLine = {
      type: "console",
      serverId,
      line: entry.line,
      timestamp: entry.timestamp,
    };
    broadcast(wss, serverId, msg);
  });

  // Status changes → broadcast to subscribers
  serverManager.onStatus((serverId, status) => {
    const msg: WsStatusChange = {
      type: "status",
      serverId,
      status,
    };
    broadcast(wss, serverId, msg);
  });

  // Player list changes → broadcast as a stats update
  serverManager.onPlayers((serverId, players) => {
    const proc = serverManager.getProcess(serverId);
    const msg: WsStats = {
      type: "stats",
      serverId,
      playerCount: players.length,
      players,
      uptime: proc?.uptime ?? 0,
    };
    broadcast(wss, serverId, msg);
  });
}

function wireEventBus(wss: WebSocketServer): void {
  eventBus.on("modpack:progress", (serverId, progress) => {
    const msg: WsModpackProgress = {
      type: "modpack:progress",
      serverId,
      jobId: progress.jobId,
      status: progress.status,
      totalMods: progress.totalMods,
      installedMods: progress.installedMods,
      currentMod: progress.currentMod,
      error: progress.error,
    };
    broadcast(wss, serverId, msg);
  });

  eventBus.on(
    "modpack:update",
    (serverId, modpackId, latestVersionId, latestVersionNumber) => {
      const msg: WsModpackUpdateAvailable = {
        type: "modpack:update",
        serverId,
        modpackId,
        latestVersionId,
        latestVersionNumber,
      };
      broadcast(wss, serverId, msg);
    },
  );
}

/**
 * Start the periodic stats interval.
 * Every 10 seconds, send stats to all subscribers of each active server.
 */
function startStatsInterval(wss: WebSocketServer): void {
  statsInterval = setInterval(() => {
    // Collect all server IDs that at least one client is subscribed to
    const subscribedServers = new Set<string>();
    for (const client of wss.clients) {
      const ws = client as WebSocket;
      const subs = getSubscriptions(ws);
      for (const serverId of subs) {
        subscribedServers.add(serverId);
      }
    }

    // Send stats for each subscribed server that has an active process
    for (const serverId of subscribedServers) {
      const proc = serverManager.getProcess(serverId);
      if (!proc || (proc.status !== "running" && proc.status !== "starting")) {
        continue;
      }

      const msg: WsStats = {
        type: "stats",
        serverId,
        playerCount: proc.playerCount,
        players: proc.players,
        uptime: proc.uptime ?? 0,
      };
      broadcast(wss, serverId, msg);
    }
  }, STATS_INTERVAL_MS);
}
