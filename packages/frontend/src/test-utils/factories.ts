import type { ServerWithStatus } from "@mc-server-manager/shared";

export function buildServer(
  overrides?: Partial<ServerWithStatus>,
): ServerWithStatus {
  return {
    id: "test-server-1",
    name: "Test Server",
    type: "vanilla",
    mcVersion: "1.21",
    jarPath: "/data/servers/test-server-1/server.jar",
    directory: "/data/servers/test-server-1",
    javaPath: "/usr/bin/java",
    jvmArgs: "-Xmx2G -Xms2G",
    port: 25565,
    autoStart: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "stopped",
    playerCount: 0,
    players: [],
    uptime: null,
    ...overrides,
  };
}

export function buildServerList(count: number): ServerWithStatus[] {
  return Array.from({ length: count }, (_, i) =>
    buildServer({
      id: `test-server-${i + 1}`,
      name: `Test Server ${i + 1}`,
    }),
  );
}
