// ============================================================
// Shared types for MC Server Manager
// Used by both backend and frontend packages
// ============================================================

// --- Server Types ---

export type ServerType = "vanilla" | "paper" | "fabric" | "forge";

export type ServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "provisioning";

export interface Server {
  id: string;
  name: string;
  type: ServerType;
  mcVersion: string;
  jarPath: string;
  directory: string;
  javaPath: string;
  jvmArgs: string;
  port: number;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerWithStatus extends Server {
  status: ServerStatus;
  playerCount: number;
  players: string[];
  uptime: number | null; // seconds, null if not running
}

export interface CreateServerRequest {
  name: string;
  type: ServerType;
  mcVersion: string;
  port?: number;
  jvmArgs?: string;
  javaPath?: string;
  /** If provided, use an existing JAR instead of downloading */
  existingJarPath?: string;
}

export interface UpdateServerRequest {
  name?: string;
  port?: number;
  jvmArgs?: string;
  javaPath?: string;
  autoStart?: boolean;
  jarPath?: string;
}

// --- Console / WebSocket ---

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

// Client → Server
export interface WsSubscribe extends WsMessage {
  type: "subscribe";
  serverId: string;
}

export interface WsUnsubscribe extends WsMessage {
  type: "unsubscribe";
  serverId: string;
}

export interface WsCommand extends WsMessage {
  type: "command";
  serverId: string;
  command: string;
}

export type WsClientMessage = WsSubscribe | WsUnsubscribe | WsCommand;

// Server → Client
export interface WsConsoleLine extends WsMessage {
  type: "console";
  serverId: string;
  line: string;
  timestamp: string;
}

export interface WsConsoleHistory extends WsMessage {
  type: "console:history";
  serverId: string;
  lines: Array<{ line: string; timestamp: string }>;
}

export interface WsStatusChange extends WsMessage {
  type: "status";
  serverId: string;
  status: ServerStatus;
}

export interface WsStats extends WsMessage {
  type: "stats";
  serverId: string;
  playerCount: number;
  players: string[];
  uptime: number;
}

export interface WsCommandAck extends WsMessage {
  type: "command:ack";
  serverId: string;
  command: string;
}

export interface WsError extends WsMessage {
  type: "error";
  message: string;
  code?: string;
}

export type WsServerMessage =
  | WsConsoleLine
  | WsConsoleHistory
  | WsStatusChange
  | WsStats
  | WsCommandAck
  | WsError;

// --- System ---

export interface JavaInfo {
  found: boolean;
  path: string | null;
  version: string | null;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpus: number;
}

// --- Versions / Downloads ---

export interface McVersion {
  id: string;
  type: "release" | "snapshot";
  releaseTime: string;
}

export type DownloadJobStatus =
  | "pending"
  | "downloading"
  | "installing" // post-download install phase (e.g. Forge)
  | "completed"
  | "failed";

export interface DownloadJob {
  id: string;
  serverId: string;
  mcVersion: string;
  serverType: ServerType;
  status: DownloadJobStatus;
  progress: number; // 0-100
  totalBytes: number | null;
  downloadedBytes: number;
  filePath: string | null;
  error?: string;
  log: string[]; // installer/download output lines
  createdAt: number; // Date.now() for TTL-based cleanup
}

// --- Download Request (discriminated union by serverType) ---

interface DownloadRequestBase {
  serverId: string;
  mcVersion: string;
}

export interface VanillaDownloadRequest extends DownloadRequestBase {
  serverType: "vanilla";
}

export interface PaperDownloadRequest extends DownloadRequestBase {
  serverType: "paper";
  build?: number;
}

export interface FabricDownloadRequest extends DownloadRequestBase {
  serverType: "fabric";
  loaderVersion?: string;
  installerVersion?: string;
}

export interface ForgeDownloadRequest extends DownloadRequestBase {
  serverType: "forge";
  forgeVersion: string;
}

export type DownloadRequest =
  | VanillaDownloadRequest
  | PaperDownloadRequest
  | FabricDownloadRequest
  | ForgeDownloadRequest;

// --- Version Info (discriminated union by type) ---

export interface VanillaVersionInfo {
  type: "vanilla";
  mcVersion: string;
}

export interface PaperVersionInfo {
  type: "paper";
  mcVersion: string;
  builds: number[];
  latestBuild: number;
}

export interface FabricVersionInfo {
  type: "fabric";
  mcVersion: string;
  loaderVersions: string[];
  latestLoader: string;
}

export interface ForgeVersionInfo {
  type: "forge";
  mcVersion: string;
  forgeVersions: string[];
  recommended?: string;
  latest: string;
}

export type VersionInfo =
  | VanillaVersionInfo
  | PaperVersionInfo
  | FabricVersionInfo
  | ForgeVersionInfo;

// --- Java / Minecraft Version Compatibility ---

/**
 * Minimum Java major version required for each Minecraft version range.
 * Sorted newest-first. The first entry whose `minMcVersion` the player's
 * chosen MC version is >= will be used.
 *
 * Sources:
 *  - 1.21+   requires Java 21  (24w14a+)
 *  - 1.17–1.20.x requires Java 17 (21w19a+ technically 16, but 17 is the
 *    official minimum since 1.18)
 *  - 1.12–1.16.x requires Java 8  (works up to Java 16; 17+ breaks some)
 *  - ≤1.11    requires Java 8
 */
export const MC_JAVA_COMPAT: {
  minMcVersion: string;
  minJava: number;
  label: string;
}[] = [
  { minMcVersion: "1.21", minJava: 21, label: "Java 21+" },
  { minMcVersion: "1.17", minJava: 17, label: "Java 17+" },
  { minMcVersion: "1.0", minJava: 8, label: "Java 8+" },
];

/**
 * Compare two Minecraft semver-ish version strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Handles "1.20", "1.20.1", "1.9", "1.21.11", etc.
 */
export function compareMcVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Get the minimum Java major version required for a given Minecraft version.
 * Returns the entry from MC_JAVA_COMPAT, or null for unrecognised versions.
 */
export function getMinJavaForMcVersion(
  mcVersion: string,
): { minJava: number; label: string } | null {
  // Strip snapshot/pre-release suffixes for comparison (e.g. "1.21-pre1" -> "1.21")
  const cleaned = mcVersion.replace(/[-_].*$/, "").replace(/[a-zA-Z].*$/, "");
  for (const entry of MC_JAVA_COMPAT) {
    if (compareMcVersions(cleaned, entry.minMcVersion) >= 0) {
      return { minJava: entry.minJava, label: entry.label };
    }
  }
  return null;
}

/**
 * Extract the major version number from a Java version string.
 * Examples: "21.0.1" -> 21, "17.0.9" -> 17, "1.8.0_392" -> 8
 */
export function getJavaMajorVersion(version: string): number {
  if (version.startsWith("1.")) {
    const parts = version.split(".");
    return parseInt(parts[1], 10);
  }
  return parseInt(version.split(".")[0], 10);
}

/**
 * Check if a Java version is compatible with a Minecraft version.
 * Returns null if compatible, or a warning message string if not.
 */
export function checkJavaMcCompat(
  javaVersion: string,
  mcVersion: string,
): string | null {
  const req = getMinJavaForMcVersion(mcVersion);
  if (!req) return null;

  const javaMajor = getJavaMajorVersion(javaVersion);
  if (isNaN(javaMajor)) return null;

  if (javaMajor < req.minJava) {
    return `Minecraft ${mcVersion} requires ${req.label}, but your Java is version ${javaVersion} (Java ${javaMajor}). The server will likely crash on startup.`;
  }

  return null;
}

// --- Server Properties ---

export type PropertyType = "string" | "number" | "boolean" | "select";

export interface PropertyDefinition {
  key: string;
  label: string;
  description: string;
  type: PropertyType;
  defaultValue: string;
  /** Only for type === 'select' */
  options?: { value: string; label: string }[];
  /** Only for type === 'number' */
  min?: number;
  max?: number;
}

export type PropertyGroupId = "gameplay" | "network" | "world" | "advanced";

export interface PropertyGroup {
  id: PropertyGroupId;
  label: string;
  description: string;
  properties: PropertyDefinition[];
}

/** Response from GET /api/servers/:id/properties */
export interface ServerPropertiesResponse {
  /** Current key=value pairs from server.properties */
  properties: Record<string, string>;
  /** Property metadata grouped logically */
  groups: PropertyGroup[];
  /** Whether the server is currently running (properties require restart) */
  serverRunning: boolean;
}

/** Request body for PUT /api/servers/:id/properties */
export interface UpdateServerPropertiesRequest {
  properties: Record<string, string>;
}

export interface JvmPreset {
  label: string;
  description: string;
  args: string;
}

/**
 * Predefined JVM argument presets.
 */
export const JVM_PRESETS: JvmPreset[] = [
  {
    label: "2 GB (Light)",
    description: "Good for 1-5 players, vanilla gameplay",
    args: "-Xmx2G -Xms1G",
  },
  {
    label: "4 GB (Medium)",
    description: "Good for 5-15 players or light mods",
    args: "-Xmx4G -Xms2G",
  },
  {
    label: "8 GB (Heavy)",
    description: "Good for 15+ players or heavy modpacks",
    args: "-Xmx8G -Xms4G",
  },
  {
    label: "4 GB (Aikar's Flags)",
    description:
      "Optimized GC flags recommended by Aikar for Paper/Spigot servers",
    args: "-Xmx4G -Xms4G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  },
  {
    label: "8 GB (Aikar's Flags)",
    description: "Aikar's optimized flags with 8 GB allocation",
    args: "-Xmx8G -Xms8G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=40 -XX:G1MaxNewSizePercent=50 -XX:G1HeapRegionSize=16M -XX:G1ReservePercent=15 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=20 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  },
];

// --- App Settings ---

export interface AppSettings {
  /** Path to the Java binary (default: 'java') */
  javaPath: string;
  /** Root data directory for server files */
  dataDir: string;
  /** Default JVM arguments for new servers */
  defaultJvmArgs: string;
  /** Max console lines kept in the ring buffer */
  maxConsoleLines: number;
}

// --- Mojang Version Manifest ---

export interface MojangVersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MojangVersionEntry[];
}

export interface MojangVersionEntry {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}
