import type {
  WsClientMessage,
  WsServerMessage,
} from "@mc-server-manager/shared";
import { isTauri, getBackendBaseUrlSync } from "../utils/tauri";

type MessageHandler = (msg: WsServerMessage) => void;
type ConnectionHandler = () => void;

const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private connectHandlers = new Set<ConnectionHandler>();
  private disconnectHandlers = new Set<ConnectionHandler>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = BASE_RECONNECT_MS;
  private explicitClose = false;
  private _connected = false;

  private getUrl(): string {
    if (!this.url) {
      if (isTauri()) {
        const base = getBackendBaseUrlSync().replace(/^http/, "ws");
        this.url = `${base || "ws://localhost:3001"}/ws`;
      } else {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        this.url = `${proto}//${window.location.host}/ws`;
      }
    }
    return this.url;
  }

  /** Whether the socket is currently open */
  get connected(): boolean {
    return this._connected;
  }

  /** Connect (or reconnect) the WebSocket */
  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return; // already connected / connecting
    }

    this.explicitClose = false;
    this.ws = new WebSocket(this.getUrl());

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = BASE_RECONNECT_MS; // reset backoff

      // Send auth token as first message (required by backend WS auth)
      const token = localStorage.getItem("accessToken");
      if (token) {
        this.ws!.send(JSON.stringify({ type: "auth", token }));
      }

      for (const h of this.connectHandlers) h();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsServerMessage;
        for (const h of this.messageHandlers) h(msg);
      } catch {
        // ignore unparseable messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      for (const h of this.disconnectHandlers) h();
      if (!this.explicitClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so reconnect logic is there
    };
  }

  /** Explicitly disconnect */
  disconnect(): void {
    this.explicitClose = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /** Send a typed message to the backend */
  send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ---- Listener registration ----

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => {
      this.connectHandlers.delete(handler);
    };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  // ---- Reconnection ----

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff with cap
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_MS,
    );
  }
}

/** The singleton WebSocket client. Import this everywhere. */
export const wsClient = new WsClient();
