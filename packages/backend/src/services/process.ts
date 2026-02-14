/**
 * ServerProcess — manages a single Minecraft server Java child process.
 *
 * Responsibilities:
 *  - Spawn the Java process with correct args
 *  - Capture stdout/stderr into a ConsoleBuffer
 *  - Emit events: 'console', 'status', 'players'
 *  - Write commands to stdin
 *  - Detect "running" state by parsing the "Done" log line
 *  - Detect player join/leave from stdout
 *  - Graceful stop via "stop" command, with SIGTERM/SIGKILL fallback
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ServerStatus } from "@mc-server-manager/shared";
import { ConsoleBuffer, type ConsoleLine } from "./console-buffer.js";
import { logger } from "../utils/logger.js";

// --- Regex patterns for parsing server output ---

/**
 * Default "Done" regex matching the vanilla log line indicating the server is ready.
 * Examples:
 *   [12:34:56] [Server thread/INFO]: Done (3.245s)! For help, type "help"
 *   [Server thread/INFO]: Done (12.1s)! For help, type "help"
 */
export const DEFAULT_DONE_REGEX = /\]: Done \(\d+[\.,]\d+s\)!/;

/**
 * Player join. Works for vanilla and most forks.
 * Example: [12:34:56] [Server thread/INFO]: Steve joined the game
 */
const PLAYER_JOIN_REGEX = /\]: (\S+) joined the game$/;

/**
 * Player leave.
 * Example: [12:34:56] [Server thread/INFO]: Steve left the game
 */
const PLAYER_LEAVE_REGEX = /\]: (\S+) left the game$/;

/** Default timeout (ms) to detect "running" if the Done line never appears. */
const DEFAULT_RUNNING_TIMEOUT_MS = 120_000;

/** Default command sent to stdin for graceful stop. */
const DEFAULT_STOP_COMMAND = "stop";

/** Grace period (ms) after sending stop command before we escalate to SIGTERM. */
const GRACEFUL_STOP_TIMEOUT_MS = 30_000;

/** Time (ms) after SIGTERM before we escalate to SIGKILL. */
const SIGTERM_TIMEOUT_MS = 10_000;

/**
 * Per-provider process configuration.
 * Allows providers to customize ready detection, stop command, and timeout.
 */
export interface ProcessConfig {
  /** Regex to detect when the server is ready. Null = rely on fallback timeout only. */
  doneRegex: RegExp | null;
  /** Command sent to stdin for graceful shutdown. */
  stopCommand: string;
  /** Timeout (ms) before assuming running if done regex never matches. */
  runningTimeoutMs: number;
}

export interface ServerProcessEvents {
  console: (serverId: string, entry: ConsoleLine) => void;
  status: (serverId: string, status: ServerStatus) => void;
  players: (serverId: string, players: string[]) => void;
}

export declare interface ServerProcess {
  on<K extends keyof ServerProcessEvents>(
    event: K,
    listener: ServerProcessEvents[K],
  ): this;
  off<K extends keyof ServerProcessEvents>(
    event: K,
    listener: ServerProcessEvents[K],
  ): this;
  emit<K extends keyof ServerProcessEvents>(
    event: K,
    ...args: Parameters<ServerProcessEvents[K]>
  ): boolean;
}

export class ServerProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private _status: ServerStatus = "stopped";
  private _players = new Set<string>();
  private _startedAt: number | null = null;
  private consoleBuffer: ConsoleBuffer;
  private config: ProcessConfig;

  // Timeout handles for lifecycle management
  private runningFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private stopGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  // Flag to distinguish intentional stop from crash
  private intentionalStop = false;

  constructor(
    public readonly serverId: string,
    bufferCapacity = 1000,
    config?: Partial<ProcessConfig>,
  ) {
    super();
    this.consoleBuffer = new ConsoleBuffer(bufferCapacity);
    this.config = {
      doneRegex:
        config?.doneRegex !== undefined ? config.doneRegex : DEFAULT_DONE_REGEX,
      stopCommand: config?.stopCommand ?? DEFAULT_STOP_COMMAND,
      runningTimeoutMs: config?.runningTimeoutMs ?? DEFAULT_RUNNING_TIMEOUT_MS,
    };
  }

  // --- Public getters ---

  get status(): ServerStatus {
    return this._status;
  }

  get players(): string[] {
    return [...this._players];
  }

  get playerCount(): number {
    return this._players.size;
  }

  get startedAt(): number | null {
    return this._startedAt;
  }

  get uptime(): number | null {
    if (this._startedAt === null) return null;
    return Math.floor((Date.now() - this._startedAt) / 1000);
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get isAlive(): boolean {
    return (
      this.proc !== null && this.proc.exitCode === null && !this.proc.killed
    );
  }

  /**
   * Get the console history buffer.
   */
  getConsoleHistory(): ConsoleLine[] {
    return this.consoleBuffer.getLines();
  }

  // --- Lifecycle methods ---

  /**
   * Start the Minecraft server process.
   * @param javaPath - Path to the java binary
   * @param args - Complete args array (JVM args + main args, e.g. [...jvmArgs, '-jar', 'server.jar', 'nogui'])
   * @param cwd - Working directory for the process
   */
  start(javaPath: string, args: string[], cwd: string): void {
    if (this._status !== "stopped" && this._status !== "crashed") {
      throw new Error(
        `Cannot start server ${this.serverId}: current status is "${this._status}"`,
      );
    }

    this.intentionalStop = false;
    this._players.clear();
    this.setStatus("starting");

    logger.info(
      { serverId: this.serverId, javaPath, args, cwd },
      "Starting Minecraft server process",
    );

    this.proc = spawn(javaPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle stdout
    this.proc.stdout?.on("data", (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    // Handle stderr (Minecraft writes some startup info to stderr)
    this.proc.stderr?.on("data", (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    // Handle process exit
    this.proc.on("exit", (code, signal) => {
      logger.info(
        { serverId: this.serverId, code, signal },
        "Server process exited",
      );
      this.handleExit(code, signal);
    });

    // Handle spawn error (e.g. java not found)
    this.proc.on("error", (err) => {
      logger.error({ serverId: this.serverId, err }, "Server process error");
      const entry = this.consoleBuffer.push(
        `[Manager] Process error: ${err.message}`,
      );
      this.emit("console", this.serverId, entry);
      this.cleanupTimers();
      this.proc = null;
      this.setStatus("crashed");
    });

    // Fallback: if we never see the "Done" line, assume running after timeout
    this.runningFallbackTimer = setTimeout(() => {
      if (this._status === "starting" && this.isAlive) {
        logger.warn(
          { serverId: this.serverId },
          'Server did not emit "Done" line — assuming running via timeout fallback',
        );
        this._startedAt = Date.now();
        this.setStatus("running");
      }
    }, this.config.runningTimeoutMs);
  }

  /**
   * Send a command to the server's stdin.
   */
  sendCommand(command: string): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error(
        `Cannot send command to server ${this.serverId}: not running`,
      );
    }
    this.proc.stdin.write(command + "\n");
    logger.debug(
      { serverId: this.serverId, command },
      "Sent command to server",
    );
  }

  /**
   * Graceful stop: send "stop" command, wait for exit, then SIGTERM, then SIGKILL.
   */
  stop(): void {
    if (this._status !== "running" && this._status !== "starting") {
      throw new Error(
        `Cannot stop server ${this.serverId}: current status is "${this._status}"`,
      );
    }

    this.intentionalStop = true;
    this.setStatus("stopping");

    // Try graceful stop via stdin
    try {
      this.sendCommand(this.config.stopCommand);
    } catch (err) {
      // stdin may already be closed — proceed to SIGTERM
      logger.warn(
        { err, serverId: this.serverId },
        "Failed to write stop command to stdin — escalating to SIGTERM",
      );
      this.escalateToSigterm();
      return;
    }

    // If the process doesn't exit within the grace period, escalate
    this.stopGraceTimer = setTimeout(() => {
      if (this.isAlive) {
        logger.warn(
          { serverId: this.serverId },
          "Graceful stop timed out — sending SIGTERM",
        );
        this.escalateToSigterm();
      }
    }, GRACEFUL_STOP_TIMEOUT_MS);
  }

  /**
   * Force kill the process immediately.
   */
  kill(): void {
    if (!this.proc || !this.isAlive) {
      throw new Error(
        `Cannot kill server ${this.serverId}: no running process`,
      );
    }

    this.intentionalStop = true;
    this.cleanupTimers();

    logger.warn({ serverId: this.serverId }, "Force-killing server process");
    this.proc.kill("SIGKILL");
  }

  // --- Private helpers ---

  private setStatus(status: ServerStatus): void {
    if (this._status === status) return;
    this._status = status;
    logger.info({ serverId: this.serverId, status }, "Server status changed");
    this.emit("status", this.serverId, status);
  }

  /**
   * Process raw output from stdout/stderr.
   * Splits into lines, pushes to buffer, emits events, and parses for state changes.
   */
  private handleOutput(raw: string): void {
    // Split on newlines. The last element may be empty if raw ends with \n.
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) continue;

      const entry = this.consoleBuffer.push(line);
      this.emit("console", this.serverId, entry);

      // Detect "Done" → server is ready
      if (
        this._status === "starting" &&
        this.config.doneRegex &&
        this.config.doneRegex.test(line)
      ) {
        this._startedAt = Date.now();
        if (this.runningFallbackTimer) {
          clearTimeout(this.runningFallbackTimer);
          this.runningFallbackTimer = null;
        }
        this.setStatus("running");
      }

      // Track player join/leave
      this.parsePlayerEvents(line);
    }
  }

  private parsePlayerEvents(line: string): void {
    const joinMatch = line.match(PLAYER_JOIN_REGEX);
    if (joinMatch) {
      const name = joinMatch[1];
      this._players.add(name);
      logger.info({ serverId: this.serverId, player: name }, "Player joined");
      this.emit("players", this.serverId, this.players);
      return;
    }

    const leaveMatch = line.match(PLAYER_LEAVE_REGEX);
    if (leaveMatch) {
      const name = leaveMatch[1];
      this._players.delete(name);
      logger.info({ serverId: this.serverId, player: name }, "Player left");
      this.emit("players", this.serverId, this.players);
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.cleanupTimers();
    this.proc = null;
    this._players.clear();

    if (this.intentionalStop || this._status === "stopping") {
      // Intentional stop
      this._startedAt = null;
      this.setStatus("stopped");
    } else {
      // Unexpected exit → crash
      this._startedAt = null;
      const entry = this.consoleBuffer.push(
        `[Manager] Server crashed (exit code: ${code}, signal: ${signal})`,
      );
      this.emit("console", this.serverId, entry);
      this.setStatus("crashed");
    }
  }

  private escalateToSigterm(): void {
    if (!this.proc || !this.isAlive) return;

    this.proc.kill("SIGTERM");

    // If SIGTERM doesn't work, SIGKILL after another timeout
    this.sigkillTimer = setTimeout(() => {
      if (this.isAlive) {
        logger.warn(
          { serverId: this.serverId },
          "SIGTERM timed out — sending SIGKILL",
        );
        this.proc?.kill("SIGKILL");
      }
    }, SIGTERM_TIMEOUT_MS);
  }

  private cleanupTimers(): void {
    if (this.runningFallbackTimer) {
      clearTimeout(this.runningFallbackTimer);
      this.runningFallbackTimer = null;
    }
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
    if (this.sigkillTimer) {
      clearTimeout(this.sigkillTimer);
      this.sigkillTimer = null;
    }
  }
}
