/**
 * ServerManager — singleton that orchestrates all server processes.
 *
 * Holds a Map<serverId, ServerProcess> and provides high-level
 * start/stop/restart/kill operations that coordinate between the
 * database model and the child process lifecycle.
 *
 * Also handles:
 *  - Provider-based launch configuration
 *  - Provisioning status tracking (during download/install)
 *  - Port conflict pre-check (OS-level) before starting
 *  - Graceful shutdown of all running servers
 *  - Enriching Server records with runtime status
 */

import net from "node:net";
import type {
  Server,
  ServerStatus,
  ServerWithStatus,
} from "@mc-server-manager/shared";
import { getServerById } from "../models/server.js";
import { ServerProcess, type ProcessConfig } from "./process.js";
import type { ConsoleLine } from "./console-buffer.js";
import { getProvider } from "../providers/registry.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

class ServerManager {
  /** Active processes keyed by server ID. */
  private processes = new Map<string, ServerProcess>();

  /** Servers currently being provisioned (downloading JAR / running installer). */
  private provisioningServers = new Set<string>();

  /**
   * Listeners registered via onConsole/onStatus/onPlayers.
   * Step 5 (WebSocket) will register listeners here to broadcast events.
   */
  private consoleListeners: Array<
    (serverId: string, entry: ConsoleLine) => void
  > = [];
  private statusListeners: Array<
    (serverId: string, status: ServerStatus) => void
  > = [];
  private playersListeners: Array<
    (serverId: string, players: string[]) => void
  > = [];

  // --- Event registration for external consumers (WebSocket layer) ---

  onConsole(listener: (serverId: string, entry: ConsoleLine) => void): void {
    this.consoleListeners.push(listener);
  }

  onStatus(listener: (serverId: string, status: ServerStatus) => void): void {
    this.statusListeners.push(listener);
  }

  onPlayers(listener: (serverId: string, players: string[]) => void): void {
    this.playersListeners.push(listener);
  }

  // --- Provisioning management ---

  /**
   * Mark a server as provisioning (downloading JAR or running installer).
   * While provisioning, start/stop/delete are blocked.
   */
  setProvisioning(serverId: string): void {
    this.provisioningServers.add(serverId);
    // Broadcast the provisioning status change
    for (const listener of this.statusListeners) {
      try {
        listener(serverId, "provisioning");
      } catch (err) {
        logger.error({ err }, "Error in status listener");
      }
    }
  }

  /**
   * Clear provisioning status for a server.
   */
  clearProvisioning(serverId: string): void {
    this.provisioningServers.delete(serverId);
    // Broadcast stopped status (the server is now idle, ready to start)
    const proc = this.processes.get(serverId);
    const status = proc?.status ?? "stopped";
    for (const listener of this.statusListeners) {
      try {
        listener(serverId, status);
      } catch (err) {
        logger.error({ err }, "Error in status listener");
      }
    }
  }

  /**
   * Check if a server is currently being provisioned.
   */
  isProvisioning(serverId: string): boolean {
    return this.provisioningServers.has(serverId);
  }

  // --- Process accessors ---

  /**
   * Get the ServerProcess for a server, or undefined if none is active.
   */
  getProcess(serverId: string): ServerProcess | undefined {
    return this.processes.get(serverId);
  }

  /**
   * Get the runtime status for a server.
   * Provisioning status takes priority over process status.
   */
  getStatus(serverId: string): ServerStatus {
    if (this.provisioningServers.has(serverId)) return "provisioning";
    return this.processes.get(serverId)?.status ?? "stopped";
  }

  /**
   * Enrich a Server DB record with runtime status info.
   */
  enrichWithStatus(server: Server): ServerWithStatus {
    const proc = this.processes.get(server.id);
    return {
      ...server,
      status: this.getStatus(server.id),
      playerCount: proc?.playerCount ?? 0,
      players: proc?.players ?? [],
      uptime: proc?.uptime ?? null,
    };
  }

  /**
   * Get console history for a server.
   */
  getConsoleHistory(serverId: string): ConsoleLine[] {
    return this.processes.get(serverId)?.getConsoleHistory() ?? [];
  }

  // --- Lifecycle operations ---

  /**
   * Start a server. Reads config from DB, validates via provider, spawns the process.
   */
  async start(serverId: string): Promise<ServerWithStatus> {
    // Block if provisioning
    if (this.provisioningServers.has(serverId)) {
      throw new AppError(
        "Server is currently being provisioned (downloading/installing). Please wait.",
        409,
        "PROVISIONING",
      );
    }

    const server = getServerById(serverId);
    const existing = this.processes.get(serverId);

    // If there's already an active process, check its state
    if (
      existing &&
      (existing.status === "running" || existing.status === "starting")
    ) {
      throw new AppError(
        `Server "${server.name}" is already ${existing.status}`,
        409,
        "ALREADY_RUNNING",
      );
    }

    // Get the provider for this server type
    const provider = getProvider(server.type);

    // Provider-level validation (JAR exists, directory exists, etc.)
    const validationError = provider.validateInstallation(server);
    if (validationError) {
      throw new AppError(validationError, 400, "INVALID_INSTALLATION");
    }

    // Check for OS-level port conflict
    const portAvailable = await this.checkPortAvailable(server.port);
    if (!portAvailable) {
      throw new AppError(
        `Port ${server.port} is already in use on this system`,
        409,
        "PORT_IN_USE",
      );
    }

    // Build launch config from provider
    const launchConfig = provider.getLaunchConfig(server);

    // Build process config from provider
    const processConfig: Partial<ProcessConfig> = {};
    if (provider.getDoneRegex) {
      processConfig.doneRegex = provider.getDoneRegex();
    }
    if (provider.getStopCommand) {
      processConfig.stopCommand = provider.getStopCommand();
    }
    if (provider.getRunningTimeout) {
      processConfig.runningTimeoutMs = provider.getRunningTimeout();
    }

    // Create (or reuse) the ServerProcess
    let proc = this.processes.get(serverId);
    if (!proc || proc.status === "crashed" || proc.status === "stopped") {
      proc = new ServerProcess(serverId, 1000, processConfig);
      this.wireProcessEvents(proc);
      this.processes.set(serverId, proc);
    }

    proc.start(server.javaPath, launchConfig.javaArgs, launchConfig.cwd);

    return this.enrichWithStatus(server);
  }

  /**
   * Graceful stop: sends stop command, waits for exit, escalates to SIGTERM/SIGKILL.
   */
  stop(serverId: string): ServerWithStatus {
    if (this.provisioningServers.has(serverId)) {
      throw new AppError(
        "Server is currently being provisioned. Cannot stop.",
        409,
        "PROVISIONING",
      );
    }

    const server = getServerById(serverId);
    const proc = this.processes.get(serverId);

    if (!proc || (proc.status !== "running" && proc.status !== "starting")) {
      throw new AppError(
        `Server "${server.name}" is not running`,
        409,
        "NOT_RUNNING",
      );
    }

    proc.stop();
    return this.enrichWithStatus(server);
  }

  /**
   * Restart: stop then start. Waits for the stop to complete before starting.
   */
  async restart(serverId: string): Promise<ServerWithStatus> {
    const server = getServerById(serverId);
    const proc = this.processes.get(serverId);

    if (proc && (proc.status === "running" || proc.status === "starting")) {
      // Stop first, then start when stopped
      proc.stop();

      // Wait for the process to actually stop
      await new Promise<void>((resolve) => {
        const onStatus = (_id: string, status: ServerStatus) => {
          if (status === "stopped" || status === "crashed") {
            proc.off("status", onStatus);
            resolve();
          }
        };
        proc.on("status", onStatus);

        // Safety timeout — don't wait forever
        setTimeout(() => {
          proc.off("status", onStatus);
          resolve();
        }, GRACEFUL_STOP_TIMEOUT_MS + 15_000);
      });
    }

    return this.start(serverId);
  }

  /**
   * Force kill the process immediately.
   */
  forceKill(serverId: string): ServerWithStatus {
    const server = getServerById(serverId);
    const proc = this.processes.get(serverId);

    if (!proc || !proc.isAlive) {
      throw new AppError(
        `Server "${server.name}" has no active process to kill`,
        409,
        "NOT_RUNNING",
      );
    }

    proc.kill();
    return this.enrichWithStatus(server);
  }

  /**
   * Send a command to a running server's stdin.
   */
  sendCommand(serverId: string, command: string): void {
    const proc = this.processes.get(serverId);
    if (!proc || proc.status !== "running") {
      throw new AppError(
        `Server ${serverId} is not running — cannot send command`,
        409,
        "NOT_RUNNING",
      );
    }
    proc.sendCommand(command);
  }

  // --- Shutdown ---

  /**
   * Gracefully shut down all running servers.
   * Called during app shutdown (SIGINT/SIGTERM).
   * Returns a promise that resolves when all servers have stopped.
   */
  async shutdownAll(): Promise<void> {
    const running = [...this.processes.entries()].filter(
      ([, proc]) => proc.status === "running" || proc.status === "starting",
    );

    if (running.length === 0) {
      logger.info("No running servers to shut down");
      return;
    }

    logger.info(
      { count: running.length },
      "Shutting down all running servers...",
    );

    const stopPromises = running.map(([id, proc]) => {
      return new Promise<void>((resolve) => {
        const onStatus = (_serverId: string, status: ServerStatus) => {
          if (status === "stopped" || status === "crashed") {
            proc.off("status", onStatus);
            resolve();
          }
        };
        proc.on("status", onStatus);

        try {
          proc.stop();
        } catch (err) {
          logger.warn(
            { err, serverId: id },
            "Error during graceful server stop",
          );
          resolve();
        }

        // Safety timeout per server
        setTimeout(() => {
          proc.off("status", onStatus);
          if (proc.isAlive) {
            logger.warn(
              { serverId: id },
              "Force-killing server during shutdown",
            );
            try {
              proc.kill();
            } catch (err) {
              logger.debug(
                { err, serverId: id },
                "Force-kill failed — process likely already dead",
              );
            }
          }
          resolve();
        }, 45_000);
      });
    });

    await Promise.all(stopPromises);
    logger.info("All servers shut down");
  }

  // --- Internal helpers ---

  /**
   * Wire up a ServerProcess's events to our broadcast system.
   */
  private wireProcessEvents(proc: ServerProcess): void {
    proc.on("console", (serverId, entry) => {
      for (const listener of this.consoleListeners) {
        try {
          listener(serverId, entry);
        } catch (err) {
          logger.error({ err }, "Error in console listener");
        }
      }
    });

    proc.on("status", (serverId, status) => {
      for (const listener of this.statusListeners) {
        try {
          listener(serverId, status);
        } catch (err) {
          logger.error({ err }, "Error in status listener");
        }
      }
    });

    proc.on("players", (serverId, players) => {
      for (const listener of this.playersListeners) {
        try {
          listener(serverId, players);
        } catch (err) {
          logger.error({ err }, "Error in players listener");
        }
      }
    });
  }

  /**
   * Check if a port is available by attempting to bind to it briefly.
   */
  private checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => {
        resolve(false);
      });
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "0.0.0.0");
    });
  }
}

/** Timeout for restart wait (matches process.ts constants + buffer). */
const GRACEFUL_STOP_TIMEOUT_MS = 30_000;

/** Singleton instance. */
export const serverManager = new ServerManager();
