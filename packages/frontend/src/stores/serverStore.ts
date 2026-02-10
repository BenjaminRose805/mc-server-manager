import { create } from "zustand";
import { toast } from "sonner";
import type {
  ServerWithStatus,
  ServerStatus,
  WsServerMessage,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { wsClient } from "@/api/ws";

// ---------------------------------------------------------------------------
// Console line type
// ---------------------------------------------------------------------------

export interface ConsoleLine {
  line: string;
  timestamp: string;
}

/**
 * Max console lines kept per server in the frontend store.
 * Matches the backend ring buffer default (1000 lines in ConsoleBuffer).
 */
const MAX_CONSOLE_LINES = 1_000;

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface ServerStore {
  // --- Server list ---
  servers: ServerWithStatus[];
  loading: boolean;
  error: string | null;
  fetchServers: () => Promise<void>;
  updateServerStatus: (
    serverId: string,
    updates: Partial<ServerWithStatus>,
  ) => void;
  removeServer: (serverId: string) => void;

  // --- Console lines per server ---
  consoleLines: Record<string, ConsoleLine[]>;
  appendConsole: (serverId: string, line: string, timestamp: string) => void;
  setConsoleHistory: (serverId: string, lines: ConsoleLine[]) => void;
  clearConsole: (serverId: string) => void;

  // --- WebSocket connected state ---
  wsConnected: boolean;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useServerStore = create<ServerStore>((set, get) => ({
  // --- Server list ---
  servers: [],
  loading: false,
  error: null,

  async fetchServers() {
    set({ loading: true, error: null });
    try {
      const servers = await api.getServers();
      set({ servers, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch servers",
        loading: false,
      });
    }
  },

  updateServerStatus(serverId, updates) {
    set({
      servers: get().servers.map((s) =>
        s.id === serverId ? { ...s, ...updates } : s,
      ),
    });
  },

  removeServer(serverId) {
    set({
      servers: get().servers.filter((s) => s.id !== serverId),
    });
  },

  // --- Console ---
  consoleLines: {},

  appendConsole(serverId, line, timestamp) {
    const prev = get().consoleLines[serverId] ?? [];
    const next = [...prev, { line, timestamp }];
    // Cap the buffer
    const capped =
      next.length > MAX_CONSOLE_LINES
        ? next.slice(next.length - MAX_CONSOLE_LINES)
        : next;
    set({
      consoleLines: { ...get().consoleLines, [serverId]: capped },
    });
  },

  setConsoleHistory(serverId, lines) {
    const capped =
      lines.length > MAX_CONSOLE_LINES
        ? lines.slice(lines.length - MAX_CONSOLE_LINES)
        : lines;
    set({
      consoleLines: { ...get().consoleLines, [serverId]: capped },
    });
  },

  clearConsole(serverId) {
    set({
      consoleLines: { ...get().consoleLines, [serverId]: [] },
    });
  },

  // --- WebSocket ---
  wsConnected: false,
}));

// ---------------------------------------------------------------------------
// Status change labels for toast notifications
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ServerStatus, string> = {
  running: "Server is now running",
  stopped: "Server stopped",
  starting: "Server is starting...",
  stopping: "Server is stopping...",
  crashed: "Server crashed",
  provisioning: "Server is being provisioned...",
};

// ---------------------------------------------------------------------------
// Wire WebSocket events to the store (runs once at module load)
// ---------------------------------------------------------------------------

function getServerName(serverId: string): string {
  const server = useServerStore
    .getState()
    .servers.find((s) => s.id === serverId);
  return server?.name ?? "Server";
}

function handleWsMessage(msg: WsServerMessage): void {
  const store = useServerStore.getState();

  switch (msg.type) {
    case "console":
      store.appendConsole(msg.serverId, msg.line, msg.timestamp);
      break;

    case "console:history":
      store.setConsoleHistory(msg.serverId, msg.lines);
      break;

    case "status": {
      const prevServer = store.servers.find((s) => s.id === msg.serverId);
      const prevStatus = prevServer?.status;
      store.updateServerStatus(msg.serverId, {
        status: msg.status as ServerStatus,
      });

      // Only toast on meaningful transitions (not the initial state)
      if (prevStatus && prevStatus !== msg.status) {
        const name = getServerName(msg.serverId);
        const label = STATUS_LABELS[msg.status as ServerStatus];
        if (msg.status === "crashed") {
          toast.error(`${name}: ${label}`);
        } else if (msg.status === "running") {
          toast.success(`${name}: ${label}`);
        } else {
          toast.info(`${name}: ${label}`);
        }
      }
      break;
    }

    case "stats":
      store.updateServerStatus(msg.serverId, {
        playerCount: msg.playerCount,
        players: msg.players,
        uptime: msg.uptime,
      });
      break;

    case "error":
      toast.error(msg.message ?? "An error occurred");
      break;
  }
}

// ---------------------------------------------------------------------------
// Deferred WebSocket initialization
// ---------------------------------------------------------------------------
// We must NOT call wsClient.connect() at module scope because:
// 1. It accesses `window.location` (not available in SSR / build)
// 2. Events could fire before the store export is fully resolved
// Instead we initialize once, lazily, on the first store subscription.
// ---------------------------------------------------------------------------

let wsInitialized = false;

export function initWebSocket(): void {
  if (wsInitialized) return;
  wsInitialized = true;

  wsClient.onMessage(handleWsMessage);
  wsClient.onConnect(() => {
    useServerStore.setState({ wsConnected: true });
  });
  wsClient.onDisconnect(() => {
    useServerStore.setState({ wsConnected: false });
  });

  wsClient.connect();
}
