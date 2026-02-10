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
  WsMessage,
  WsConsoleHistory,
  WsStatusChange,
  WsCommandAck,
  WsError,
} from "@mc-server-manager/shared";
import { serverManager } from "../services/server-manager.js";
import { logger } from "../utils/logger.js";

/**
 * Tracks the set of server IDs each WebSocket client has subscribed to.
 * WeakMap so entries are automatically cleaned up when the socket is GC'd.
 */
const clientSubscriptions = new WeakMap<WebSocket, Set<string>>();

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

// ---- Message handling ----

/**
 * Handle an incoming message from a client.
 */
export function handleMessage(ws: WebSocket, raw: string): void {
  let msg: WsClientMessage;

  try {
    msg = JSON.parse(raw) as WsClientMessage;
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

  switch (msg.type) {
    case "subscribe":
      handleSubscribe(ws, msg.serverId);
      break;
    case "unsubscribe":
      handleUnsubscribe(ws, msg.serverId);
      break;
    case "command":
      handleCommand(ws, msg.serverId, (msg as { command: string }).command);
      break;
    default:
      sendMessage(ws, {
        type: "error",
        message: `Unknown message type: "${(msg as WsMessage).type}"`,
        code: "UNKNOWN_TYPE",
      } satisfies WsError);
  }
}

/**
 * Clean up subscriptions when a client disconnects.
 */
export function handleDisconnect(ws: WebSocket): void {
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
