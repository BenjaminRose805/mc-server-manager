/**
 * ServerProvider interface — the abstraction that each server type implements.
 *
 * Providers handle version fetching, JAR downloading, launch configuration,
 * and installation validation for a specific server type (vanilla, paper, fabric, forge).
 */

import type {
  ServerType,
  McVersion,
  VersionInfo,
  DownloadRequest,
  DownloadJob,
  Server,
} from '@mc-server-manager/shared';

/**
 * Launch configuration produced by a provider.
 * The ServerProcess receives this to spawn the Java child process.
 */
export interface LaunchConfig {
  /** JVM args (e.g., -Xmx2G -Xms1G) plus main args (e.g., -jar server.jar nogui) */
  javaArgs: string[];
  /** Working directory for the process */
  cwd: string;
}

/**
 * Each server type implements this interface.
 * The provider handles all type-specific logic so the rest of the system
 * (ServerManager, download service, etc.) remains generic.
 */
export interface ServerProvider {
  readonly type: ServerType;

  /**
   * Fetch available Minecraft versions for this server type.
   * @param includeSnapshots - Whether to include snapshot/pre-release versions
   */
  getVersions(includeSnapshots?: boolean): Promise<McVersion[]>;

  /**
   * Get detailed version info (e.g., builds for Paper, loader versions for Fabric).
   * Optional — not all providers need this.
   */
  getVersionInfo?(mcVersion: string): Promise<VersionInfo>;

  /**
   * Download and install the server JAR/files.
   * Updates the job object in-place for progress tracking.
   * Returns the final JAR file path.
   */
  download(request: DownloadRequest, destDir: string, job: DownloadJob): Promise<string>;

  /**
   * Build the launch configuration for starting the server.
   * Returns the complete args array to pass to `java`.
   */
  getLaunchConfig(server: Server): LaunchConfig;

  /**
   * Regex to detect when the server is ready (the "Done" line).
   * Return null to rely on fallback timeout only.
   * If not implemented, uses the vanilla Done regex.
   */
  getDoneRegex?(): RegExp | null;

  /**
   * Command to send to stdin for graceful shutdown.
   * Default: 'stop'
   */
  getStopCommand?(): string;

  /**
   * Timeout (ms) before assuming the server is running if Done regex never matches.
   * Default: 120_000 (2 minutes). Forge may want 300_000 (5 minutes).
   */
  getRunningTimeout?(): number;

  /**
   * Validate that the server installation is correct and ready to launch.
   * Returns null if valid, or an error message string if not.
   */
  validateInstallation(server: Server): string | null;
}
