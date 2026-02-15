import type { ServerWithStatus } from "@mc-server-manager/shared";
import { useServerStore } from "./serverStore";
import { api } from "@/api/client";

// Mock the API client module
vi.mock("@/api/client", () => ({
  api: {
    getServers: vi.fn(),
  },
}));

describe("serverStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useServerStore.setState({
      servers: [],
      loading: false,
      error: null,
      consoleLines: {},
      modpackProgress: {},
      modpackUpdates: {},
      wsConnected: false,
    });
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has empty servers array", () => {
      const state = useServerStore.getState();
      expect(state.servers).toEqual([]);
    });

    it("has empty consoleLines object", () => {
      const state = useServerStore.getState();
      expect(state.consoleLines).toEqual({});
    });

    it("has loading false", () => {
      const state = useServerStore.getState();
      expect(state.loading).toBe(false);
    });

    it("has error null", () => {
      const state = useServerStore.getState();
      expect(state.error).toBe(null);
    });

    it("has wsConnected false", () => {
      const state = useServerStore.getState();
      expect(state.wsConnected).toBe(false);
    });
  });

  describe("fetchServers", () => {
    it("fetches servers and updates state", async () => {
      const mockServers: ServerWithStatus[] = [
        {
          id: "test-1",
          name: "Test Server 1",
          type: "vanilla",
          mcVersion: "1.21",
          port: 25565,
          javaPath: null,
          jvmArgs: null,
          serverPath: "/path/to/server",
          jarPath: "/path/to/jar",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          status: "stopped",
          playerCount: 0,
          players: [],
          uptime: null,
          memoryUsage: null,
          cpuUsage: null,
        },
        {
          id: "test-2",
          name: "Test Server 2",
          type: "paper",
          mcVersion: "1.20.4",
          port: 25566,
          javaPath: null,
          jvmArgs: null,
          serverPath: "/path/to/server2",
          jarPath: "/path/to/jar2",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          status: "running",
          playerCount: 3,
          players: [],
          uptime: 12345,
          memoryUsage: null,
          cpuUsage: null,
        },
      ];

      vi.mocked(api.getServers).mockResolvedValue(mockServers);

      await useServerStore.getState().fetchServers();

      const state = useServerStore.getState();
      expect(state.servers).toEqual(mockServers);
      expect(state.loading).toBe(false);
      expect(state.error).toBe(null);
    });

    it("sets loading to true during fetch", async () => {
      vi.mocked(api.getServers).mockImplementation(
        () =>
          new Promise((resolve) => {
            // Check loading state while promise is pending
            const state = useServerStore.getState();
            expect(state.loading).toBe(true);
            resolve([]);
          }),
      );

      await useServerStore.getState().fetchServers();
    });

    it("handles fetch errors", async () => {
      const errorMessage = "Network error";
      vi.mocked(api.getServers).mockRejectedValue(new Error(errorMessage));

      await useServerStore.getState().fetchServers();

      const state = useServerStore.getState();
      expect(state.error).toBe(errorMessage);
      expect(state.loading).toBe(false);
    });
  });

  describe("updateServerStatus", () => {
    it("updates server status and preserves other fields", () => {
      const initialServer: ServerWithStatus = {
        id: "test-1",
        name: "Test Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565,
        javaPath: null,
        jvmArgs: null,
        serverPath: "/path/to/server",
        jarPath: "/path/to/jar",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        status: "stopped",
        playerCount: 0,
        players: [],
        uptime: null,
        memoryUsage: null,
        cpuUsage: null,
      };

      useServerStore.setState({ servers: [initialServer] });

      useServerStore.getState().updateServerStatus("test-1", {
        status: "running",
        playerCount: 3,
      });

      const state = useServerStore.getState();
      expect(state.servers[0].status).toBe("running");
      expect(state.servers[0].playerCount).toBe(3);
      expect(state.servers[0].name).toBe("Test Server");
      expect(state.servers[0].type).toBe("vanilla");
      expect(state.servers[0].port).toBe(25565);
    });

    it("does not modify other servers", () => {
      const server1: ServerWithStatus = {
        id: "test-1",
        name: "Server 1",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565,
        javaPath: null,
        jvmArgs: null,
        serverPath: "/path/1",
        jarPath: "/jar/1",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        status: "stopped",
        playerCount: 0,
        players: [],
        uptime: null,
        memoryUsage: null,
        cpuUsage: null,
      };

      const server2: ServerWithStatus = {
        id: "test-2",
        name: "Server 2",
        type: "paper",
        mcVersion: "1.20.4",
        port: 25566,
        javaPath: null,
        jvmArgs: null,
        serverPath: "/path/2",
        jarPath: "/jar/2",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        status: "running",
        playerCount: 5,
        players: [],
        uptime: 1000,
        memoryUsage: null,
        cpuUsage: null,
      };

      useServerStore.setState({ servers: [server1, server2] });

      useServerStore.getState().updateServerStatus("test-1", {
        status: "running",
      });

      const state = useServerStore.getState();
      expect(state.servers[0].status).toBe("running");
      expect(state.servers[1].status).toBe("running");
      expect(state.servers[1].playerCount).toBe(5);
    });
  });

  describe("removeServer", () => {
    it("removes server from state", () => {
      const server1: ServerWithStatus = {
        id: "test-1",
        name: "Server 1",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565,
        javaPath: null,
        jvmArgs: null,
        serverPath: "/path/1",
        jarPath: "/jar/1",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        status: "stopped",
        playerCount: 0,
        players: [],
        uptime: null,
        memoryUsage: null,
        cpuUsage: null,
      };

      const server2: ServerWithStatus = {
        id: "test-2",
        name: "Server 2",
        type: "paper",
        mcVersion: "1.20.4",
        port: 25566,
        javaPath: null,
        jvmArgs: null,
        serverPath: "/path/2",
        jarPath: "/jar/2",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        status: "running",
        playerCount: 5,
        players: [],
        uptime: 1000,
        memoryUsage: null,
        cpuUsage: null,
      };

      useServerStore.setState({ servers: [server1, server2] });

      useServerStore.getState().removeServer("test-1");

      const state = useServerStore.getState();
      expect(state.servers).toHaveLength(1);
      expect(state.servers[0].id).toBe("test-2");
    });
  });

  describe("appendConsole", () => {
    it("appends console line to server", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Hello world", "2024-01-01T00:00:00Z");

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toHaveLength(1);
      expect(state.consoleLines["test-1"][0]).toEqual({
        line: "Hello world",
        timestamp: "2024-01-01T00:00:00Z",
      });
    });

    it("appends multiple lines in order", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Line 1", "2024-01-01T00:00:00Z");
      useServerStore
        .getState()
        .appendConsole("test-1", "Line 2", "2024-01-01T00:00:01Z");
      useServerStore
        .getState()
        .appendConsole("test-1", "Line 3", "2024-01-01T00:00:02Z");

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toHaveLength(3);
      expect(state.consoleLines["test-1"][0].line).toBe("Line 1");
      expect(state.consoleLines["test-1"][1].line).toBe("Line 2");
      expect(state.consoleLines["test-1"][2].line).toBe("Line 3");
    });

    it("caps console lines at MAX_CONSOLE_LINES (1000)", () => {
      // Append 1100 lines (more than the 1000 cap)
      for (let i = 0; i < 1100; i++) {
        useServerStore
          .getState()
          .appendConsole("test-1", `Line ${i}`, `2024-01-01T00:00:${i}Z`);
      }

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toHaveLength(1000);
      // Should keep the last 1000 lines (100-1099)
      expect(state.consoleLines["test-1"][0].line).toBe("Line 100");
      expect(state.consoleLines["test-1"][999].line).toBe("Line 1099");
    });

    it("does not affect other servers' console lines", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Server 1 line", "2024-01-01T00:00:00Z");
      useServerStore
        .getState()
        .appendConsole("test-2", "Server 2 line", "2024-01-01T00:00:01Z");

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toHaveLength(1);
      expect(state.consoleLines["test-2"]).toHaveLength(1);
      expect(state.consoleLines["test-1"][0].line).toBe("Server 1 line");
      expect(state.consoleLines["test-2"][0].line).toBe("Server 2 line");
    });
  });

  describe("setConsoleHistory", () => {
    it("sets console history for a server", () => {
      const history = [
        { line: "Line 1", timestamp: "2024-01-01T00:00:00Z" },
        { line: "Line 2", timestamp: "2024-01-01T00:00:01Z" },
        { line: "Line 3", timestamp: "2024-01-01T00:00:02Z" },
      ];

      useServerStore.getState().setConsoleHistory("test-1", history);

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toEqual(history);
    });

    it("caps history at MAX_CONSOLE_LINES (1000)", () => {
      const history = Array.from({ length: 1500 }, (_, i) => ({
        line: `Line ${i}`,
        timestamp: `2024-01-01T00:00:${i}Z`,
      }));

      useServerStore.getState().setConsoleHistory("test-1", history);

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toHaveLength(1000);
      // Should keep the last 1000 lines (500-1499)
      expect(state.consoleLines["test-1"][0].line).toBe("Line 500");
      expect(state.consoleLines["test-1"][999].line).toBe("Line 1499");
    });

    it("replaces existing console lines", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Old line", "2024-01-01T00:00:00Z");

      const newHistory = [
        { line: "New line 1", timestamp: "2024-01-01T00:00:01Z" },
        { line: "New line 2", timestamp: "2024-01-01T00:00:02Z" },
      ];

      useServerStore.getState().setConsoleHistory("test-1", newHistory);

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toEqual(newHistory);
    });
  });

  describe("clearConsole", () => {
    it("clears console lines for a server", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Line 1", "2024-01-01T00:00:00Z");
      useServerStore
        .getState()
        .appendConsole("test-1", "Line 2", "2024-01-01T00:00:01Z");

      useServerStore.getState().clearConsole("test-1");

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toEqual([]);
    });

    it("does not affect other servers' console lines", () => {
      useServerStore
        .getState()
        .appendConsole("test-1", "Server 1 line", "2024-01-01T00:00:00Z");
      useServerStore
        .getState()
        .appendConsole("test-2", "Server 2 line", "2024-01-01T00:00:01Z");

      useServerStore.getState().clearConsole("test-1");

      const state = useServerStore.getState();
      expect(state.consoleLines["test-1"]).toEqual([]);
      expect(state.consoleLines["test-2"]).toHaveLength(1);
      expect(state.consoleLines["test-2"][0].line).toBe("Server 2 line");
    });

    it("handles clearing non-existent server console", () => {
      useServerStore.getState().clearConsole("non-existent");

      const state = useServerStore.getState();
      expect(state.consoleLines["non-existent"]).toEqual([]);
    });
  });
});
