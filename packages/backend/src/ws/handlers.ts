/**
 * WebSocket message handlers.
 *
 * Manages per-client subscription state (which server IDs a client
 * is listening to) and routes incoming messages to the appropriate
 * service calls.
 */

import type { WebSocket } from "ws";
import type {
  WsClientMessage,
  WsConsoleHistory,
  WsStatusChange,
  WsCommandAck,
  WsError,
  UserRole,
} from "@mc-server-manager/shared";
import { serverManager } from "../services/server-manager.js";
import { verifyAccessToken } from "../services/jwt.js";
import { getPermission } from "../models/server-permission.js";
import { countUsers } from "../models/user.js";
import { logger } from "../utils/logger.js";

/**
 * Tracks the set of server IDs each WebSocket client has subscribed to.
 * WeakMap so entries are automatically cleaned up when the socket is GC'd.
 */
const clientSubscriptions = new WeakMap<WebSocket, Set<string>>();

const authenticatedClients = new WeakMap<
  WebSocket,
  { id: string; username: string; role: UserRole }
>();

const authTimeouts = new WeakMap<WebSocket, NodeJS.Timeout>();

// ---- Public helpers for broadcasting ----

/**
 * Get the set of server IDs a client is subscribed to.
 */
export function getSubscriptions(ws: WebSocket): Set<string> {
  let subs = clientSubscriptions.get(ws);
  if (!subs) {
    subs = new Set();
    clientSubscriptions.set(ws, subs);
  }
  return subs;
}

/**
 * Send a JSON message to a client. Silently ignores if the socket is not open.
 */
export function sendMessage(ws: WebSocket, message: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    logger.error({ err }, "Failed to send WebSocket message");
  }
}

// ---- Auth ----

/**
 * Initialize auth timeout for a new WebSocket connection.
 * If no auth message is received within 5 seconds, close the connection.
 */
export function initAuth(ws: WebSocket): void {
  const timeout = setTimeout(() => {
    if (!authenticatedClients.has(ws)) {
      ws.close(4001, "Auth timeout");
    }
  }, 5_000);
  authTimeouts.set(ws, timeout);
}

// ---- Message handling ----

/**
 * Handle an incoming message from a client.
 */
export function handleMessage(ws: WebSocket, raw: string): void {
  let msg: Record<string, unknown>;

  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    sendMessage(ws, {
      type: "error",
      message: "Invalid JSON",
      code: "INVALID_JSON",
    } satisfies WsError);
    return;
  }

  if (!msg.type) {
    sendMessage(ws, {
      type: "error",
      message: 'Missing "type" field',
      code: "MISSING_TYPE",
    } satisfies WsError);
    return;
  }

  if (msg.type === "auth") {
    const timeout = authTimeouts.get(ws);
    if (timeout) {
      clearTimeout(timeout);
      authTimeouts.delete(ws);
    }

    const payload = verifyAccessToken(msg.token as string);
    if (!payload) {
      sendMessage(ws, {
        type: "error",
        message: "Invalid or expired token",
        code: "AUTH_FAILED",
      } satisfies WsError);
      ws.close(4001, "Auth failed");
      return;
    }

    authenticatedClients.set(ws, {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    });
    sendMessage(ws, { type: "auth:ok" });
    return;
  }

  if (!authenticatedClients.has(ws) && countUsers() > 0) {
    sendMessage(ws, {
      type: "error",
      message: "Not authenticated",
      code: "NOT_AUTHENTICATED",
    } satisfies WsError);
    return;
  }

  switch (msg.type) {
    case "subscribe":
      handleSubscribe(ws, (msg as unknown as WsClientMessage).serverId);
      break;
    case "unsubscribe":
      handleUnsubscribe(ws, (msg as unknown as WsClientMessage).serverId);
      break;
    case "command":
      handleCommand(
        ws,
        (msg as unknown as WsClientMessage).serverId,
        (msg as { command: string }).command,
      );
      break;
    default:
      sendMessage(ws, {
        type: "error",
        message: `Unknown message type: "${msg.type as string}"`,
        code: "UNKNOWN_TYPE",
      } satisfies WsError);
  }
}

/**
 * Clean up subscriptions and auth state when a client disconnects.
 */
export function handleDisconnect(ws: WebSocket): void {
  const timeout = authTimeouts.get(ws);
  if (timeout) {
    clearTimeout(timeout);
    authTimeouts.delete(ws);
  }
  authenticatedClients.delete(ws);
  clientSubscriptions.delete(ws);
}

// ---- Individual handlers ----

function handleSubscribe(ws: WebSocket, serverId: string): void {
  if (!serverId) {
    sendMessage(ws, {
      type: "error",
      message: 'subscribe requires a "serverId"',
      code: "MISSING_SERVER_ID",
    } satisfies WsError);
    return;
  }

  const user = authenticatedClients.get(ws);
  if (user && user.role !== "owner" && user.role !== "admin") {
    const perm = getPermission(serverId, user.id);
    if (!perm?.canView) {
      sendMessage(ws, {
        type: "error",
        message: "No permission to view this server",
        code: "PERMISSION_DENIED",
      } satisfies WsError);
      return;
    }
  }

  const subs = getSubscriptions(ws);
  subs.add(serverId);

  logger.debug({ serverId }, "Client subscribed to server");

  // Send the current status immediately
  const status = serverManager.getStatus(serverId);
  sendMessage(ws, {
    type: "status",
    serverId,
    status,
  } satisfies WsStatusChange);

  // Send console history buffer
  const history = serverManager.getConsoleHistory(serverId);
  if (history.length > 0) {
    sendMessage(ws, {
      type: "console:history",
      serverId,
      lines: history,
    } satisfies WsConsoleHistory);
  }
}

function handleUnsubscribe(ws: WebSocket, serverId: string): void {
  if (!serverId) {
    sendMessage(ws, {
      type: "error",
      message: 'unsubscribe requires a "serverId"',
      code: "MISSING_SERVER_ID",
    } satisfies WsError);
    return;
  }

  const subs = getSubscriptions(ws);
  subs.delete(serverId);

  logger.debug({ serverId }, "Client unsubscribed from server");
}

function handleCommand(ws: WebSocket, serverId: string, command: string): void {
  if (!serverId) {
    sendMessage(ws, {
      type: "error",
      message: 'command requires a "serverId"',
      code: "MISSING_SERVER_ID",
    } satisfies WsError);
    return;
  }

  if (!command || typeof command !== "string" || command.trim().length === 0) {
    sendMessage(ws, {
      type: "error",
      message: 'command requires a non-empty "command" string',
      code: "MISSING_COMMAND",
    } satisfies WsError);
    return;
  }

  const user = authenticatedClients.get(ws);
  if (user && user.role !== "owner" && user.role !== "admin") {
    const perm = getPermission(serverId, user.id);
    if (!perm?.canConsole) {
      sendMessage(ws, {
        type: "error",
        message: "No permission to use console on this server",
        code: "PERMISSION_DENIED",
      } satisfies WsError);
      return;
    }
  }

  try {
    const trimmed = command.trim();
    serverManager.sendCommand(serverId, trimmed);
    sendMessage(ws, {
      type: "command:ack",
      serverId,
      command: trimmed,
    } satisfies WsCommandAck);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send command";
    sendMessage(ws, {
      type: "error",
      message,
      code: "COMMAND_FAILED",
    } satisfies WsError);
  }
}
