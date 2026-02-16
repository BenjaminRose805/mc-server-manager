// ============================================================
// Shared types for MC Server Manager
// Used by both backend and frontend packages
// ============================================================

// --- Server Types ---

export type ServerType = "vanilla" | "paper" | "fabric" | "forge" | "neoforge";

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

export interface WsModpackProgress extends WsMessage {
  type: "modpack:progress";
  serverId: string;
  jobId: string;
  status: ModpackInstallStatus;
  totalMods: number;
  installedMods: number;
  currentMod: string;
  error?: string;
}

export type WsServerMessage =
  | WsConsoleLine
  | WsConsoleHistory
  | WsStatusChange
  | WsStats
  | WsCommandAck
  | WsError
  | WsModpackProgress
  | WsModpackUpdateAvailable;

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

export interface NeoForgeDownloadRequest extends DownloadRequestBase {
  serverType: "neoforge";
  neoforgeVersion: string;
}

export type DownloadRequest =
  | VanillaDownloadRequest
  | PaperDownloadRequest
  | FabricDownloadRequest
  | ForgeDownloadRequest
  | NeoForgeDownloadRequest;

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

export interface NeoForgeVersionInfo {
  type: "neoforge";
  mcVersion: string;
  neoforgeVersions: string[];
  latest: string;
  recommended?: string;
}

export type VersionInfo =
  | VanillaVersionInfo
  | PaperVersionInfo
  | FabricVersionInfo
  | ForgeVersionInfo
  | NeoForgeVersionInfo;

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
  /** CurseForge API key (optional — enables CurseForge mod search) */
  curseforgeApiKey: string;
  /** When true, modpack install shows file-by-file override preview */
  showOverridePreview: boolean;
}

// --- Mod Management ---

/** Target for mod installation (server or launcher instance) */
export interface ModTarget {
  type: "server" | "instance";
  id: string;
  modsDir: string;
  mcVersion: string;
  loader: ModLoader | null;
  loaderVersion: string | null;
}

/** Which API a mod was sourced from */
export type ModSource = "modrinth" | "curseforge" | "local";

/** Mod loader identifier (subset of ServerType that supports mods) */
export type ModLoader = "forge" | "fabric" | "neoforge";

/** Which side(s) a mod runs on */
export type ModSide = "client" | "server" | "both" | "unknown";

/** Server types that support mod management */
export const MOD_CAPABLE_TYPES: readonly ServerType[] = [
  "forge",
  "fabric",
  "neoforge",
] as const;

/** Check if a server type supports mods */
export function isModCapable(type: ServerType): type is ModLoader {
  return (MOD_CAPABLE_TYPES as readonly string[]).includes(type);
}

/** A mod installed on a server or launcher instance (persisted in DB) */
export interface InstalledMod {
  id: string;
  serverId: string | null;
  instanceId: string | null;
  name: string;
  slug: string;
  source: ModSource;
  sourceId: string;
  versionId: string;
  fileName: string;
  enabled: boolean;
  side: ModSide;
  modpackId: string | null;
  mcVersion: string;
  loaderType: ModLoader;
  description: string;
  iconUrl: string;
  websiteUrl: string;
  authors: string;
  installedAt: string;
  updatedAt: string;
}

/** Search result from Modrinth or CurseForge */
export interface ModSearchResult {
  source: ModSource;
  sourceId: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl: string;
  downloads: number;
  lastUpdated: string;
  categories: string[];
  mcVersions: string[];
  loaders: ModLoader[];
  /** Modrinth side field: "required" | "optional" | "unsupported" | "unknown" */
  clientSide?: string;
  /** Modrinth side field: "required" | "optional" | "unsupported" | "unknown" */
  serverSide?: string;
}

/** A specific downloadable version of a mod */
export interface ModVersion {
  versionId: string;
  source: ModSource;
  sourceId: string;
  name: string;
  versionNumber: string;
  mcVersions: string[];
  loaders: ModLoader[];
  fileName: string;
  fileSize: number;
  downloadUrl: string;
  dependencies: ModDependency[];
  releaseType: "release" | "beta" | "alpha";
  datePublished: string;
}

/** A dependency of a mod version */
export interface ModDependency {
  projectId: string;
  versionId?: string;
  name?: string;
  type: "required" | "optional" | "incompatible";
}

/** Compatibility warning for a mod */
export interface ModCompatibilityWarning {
  type: "mc_version" | "loader" | "client_only";
  severity: "error" | "warning";
  message: string;
}

/** Request to install a mod on a server */
export interface InstallModRequest {
  source: ModSource;
  sourceId: string;
  versionId: string;
}

/** Request to install a client mod loader on a launcher instance */
export interface InstallClientLoaderRequest {
  loader: ModLoader;
  loaderVersion?: string;
}

/** Response from mod search endpoint */
export interface ModSearchResponse {
  results: ModSearchResult[];
  totalHits: number;
}

/** Sort options supported by both Modrinth and CurseForge */
export type ModSortOption = "relevance" | "downloads" | "updated" | "newest";

/** Environment filter for mod search */
export type ModEnvironment = "client" | "server" | "both";

/** A merged mod category from Modrinth and/or CurseForge */
export interface ModCategory {
  /** Normalized key for deduplication (lowercase, hyphenated) */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Icon URL (from Modrinth if available) */
  iconUrl?: string;
  /** Modrinth facet value — present if this category exists on Modrinth */
  modrinthId?: string;
  /** CurseForge category ID (numeric as string) — present if exists on CF */
  curseforgeId?: string;
}

/** Response from GET /api/mods/categories */
export interface ModCategoryResponse {
  categories: ModCategory[];
}

// --- Modpack Management ---

export interface ModpackSearchResult {
  source: ModSource;
  sourceId: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl: string;
  downloads: number;
  lastUpdated: string;
  categories: string[];
  mcVersions: string[];
  loaders: ModLoader[];
}

export interface ModpackSearchResponse {
  results: ModpackSearchResult[];
  totalHits: number;
}

export interface ModpackVersion {
  versionId: string;
  source: ModSource;
  sourceId: string;
  name: string;
  versionNumber: string;
  mcVersions: string[];
  loaders: ModLoader[];
  fileUrl: string;
  fileSize: number;
  releaseType: "release" | "beta" | "alpha";
  datePublished: string;
  serverPackFileId?: string;
}

export interface ModpackEntry {
  path: string;
  downloadUrl: string;
  fileSize: number;
  hashes?: { sha1?: string; sha512?: string };
  side: ModSide;
  name?: string;
  slug?: string;
  curseforgeProjectId?: number;
  curseforgeFileId?: number;
}

export interface ParsedModpack {
  name: string;
  versionId: string;
  mcVersion: string;
  loader: ModLoader;
  loaderVersion: string;
  entries: ModpackEntry[];
  overrideFileCount: number;
  hasServerOverrides: boolean;
  overrideFiles?: string[];
}

export interface InstallModpackRequest {
  source: ModSource;
  sourceId: string;
  versionId: string;
  selectedEntries: number[];
  applyOverrides: boolean;
}

export type ModpackInstallStatus =
  | "parsing"
  | "downloading"
  | "applying_overrides"
  | "completed"
  | "failed";

export interface ModpackInstallProgress {
  jobId: string;
  status: ModpackInstallStatus;
  totalMods: number;
  installedMods: number;
  currentMod: string;
  error?: string;
}

export interface InstalledModpack {
  id: string;
  serverId: string;
  source: ModSource;
  sourceId: string;
  versionId: string;
  versionNumber: string;
  name: string;
  mcVersion: string;
  loaderType: ModLoader;
  iconUrl: string;
  websiteUrl: string;
  authors: string;
  modCount: number;
  installedAt: string;
  updatedAt: string;
}

// --- Modpack Update Detection ---

export interface ModpackUpdateInfo {
  modpackId: string;
  currentVersionId: string;
  currentVersionNumber: string;
  latestVersionId: string;
  latestVersionNumber: string;
  latestMcVersions: string[];
  latestLoaders: ModLoader[];
  updateAvailable: boolean;
}

export interface WsModpackUpdateAvailable extends WsMessage {
  type: "modpack:update";
  serverId: string;
  modpackId: string;
  latestVersionId: string;
  latestVersionNumber: string;
}

// --- Modpack Export ---

export interface ModpackExportData {
  name: string;
  mcVersion: string;
  loaderType: ModLoader;
  source: ModSource;
  sourceId: string;
  versionId: string;
  versionNumber: string;
  mods: Array<{
    name: string;
    source: ModSource;
    sourceId: string;
    versionId: string;
    fileName: string;
    side: ModSide;
    enabled: boolean;
  }>;
  exportedAt: string;
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

// --- Launcher Types ---

/** Launcher supports all server mod loaders plus Quilt (client-side only) */
export type LoaderType = ModLoader | "quilt";

export type VersionType = "release" | "snapshot" | "old_beta" | "old_alpha";

export interface LauncherInstance {
  id: string;
  name: string;
  mcVersion: string;
  versionType: VersionType;
  loader: LoaderType | null;
  loaderVersion: string | null;
  javaVersion: number;
  javaPath: string | null;
  ramMin: number;
  ramMax: number;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  jvmArgs: string[];
  gameArgs: string[];
  icon: string | null;
  lastPlayed: string | null;
  totalPlaytime: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  name: string;
  mcVersion: string;
  versionType?: VersionType;
  loader?: LoaderType;
  loaderVersion?: string;
  ramMin?: number;
  ramMax?: number;
}

export interface UpdateInstanceRequest {
  name?: string;
  ramMin?: number;
  ramMax?: number;
  resolutionWidth?: number | null;
  resolutionHeight?: number | null;
  jvmArgs?: string[];
  gameArgs?: string[];
  icon?: string | null;
  javaPath?: string | null;
}

export interface LauncherAccount {
  id: string;
  uuid: string;
  username: string;
  accountType: "msa" | "legacy";
  lastUsed: string | null;
  createdAt: string;
}

/** Launcher-side version entry (subset of MojangVersionEntry, no complianceLevel) */
export type MinecraftVersion = Omit<MojangVersionEntry, "complianceLevel">;

export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MinecraftVersion[];
}

export interface JavaInstallation {
  version: number;
  path: string;
  vendor: string;
  fullVersion: string;
}

export interface MSAuthDeviceCode {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface MSAuthStatus {
  status: "pending" | "complete" | "expired" | "error" | "slow_down";
  account?: LauncherAccount;
  error?: string;
}

export interface LaunchGameRequest {
  instanceId: string;
  accountId: string;
}

export interface GameProcess {
  instanceId: string;
  pid: number;
  startedAt: string;
}

export type PreparePhase =
  | "pending"
  | "version"
  | "libraries"
  | "assets"
  | "completed"
  | "failed";

export interface PrepareJob {
  id: string;
  instanceId: string;
  mcVersion: string;
  phase: PreparePhase;
  /** 0-100 overall progress across all phases */
  progress: number;
  /** Current item count within the active phase */
  phaseCurrent: number;
  /** Total item count within the active phase */
  phaseTotal: number;
  /** The prepare result, populated on completion */
  result: PrepareResponse | null;
  error?: string;
  createdAt: number;
}

export interface PrepareResponse {
  classpath: string[];
  mainClass: string;
  assetIndex: string;
  assetsDir: string;
  versionId: string;
  gameJarPath: string;
  nativesDir: string;
}

// ============================================================
// Multi-User Auth Types (Epic 5)
// ============================================================

export type UserRole = "owner" | "admin" | "member";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  minecraftUsername: string | null;
  minecraftUuid: string | null;
}

export interface Session {
  id: string;
  userId: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface Invitation {
  id: string;
  code: string;
  createdBy: string;
  maxUses: number;
  uses: number;
  role: UserRole;
  expiresAt: string | null;
  createdAt: string;
}

export interface ServerPermission {
  id: string;
  serverId: string;
  userId: string;
  canView: boolean;
  canStart: boolean;
  canConsole: boolean;
  canEdit: boolean;
  canJoin: boolean;
  createdAt: string;
}

export interface JWTPayload {
  sub: string; // User ID
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest {
  user: {
    id: string;
    username: string;
    role: UserRole;
  };
}

export interface SetupRequest {
  username: string;
  password: string;
  displayName: string;
}

export interface RegisterRequest {
  inviteCode: string;
  username: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthStatusResponse {
  setupRequired: boolean;
  multiUser: boolean;
}
