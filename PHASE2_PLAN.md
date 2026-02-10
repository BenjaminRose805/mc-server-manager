# Phase 2 Plan: Multi-Server-Type Support + Log Viewer

> **Consensus Plan** -- Produced through iterative Planner/Architect/Critic review (2 rounds).
> All concerns from Architect and Critic reviews have been addressed and consensus was reached.

## Revision History

- **Round 1**: Initial plan by Planner
- **Round 1 Review**: Architect identified 8 concerns (meta type safety, process boundary, Forge arg parsing, missing provider methods, log viewer scope, path traversal, download lifecycle, caching). Critic identified 28 issues across 9 categories (15 HIGH/CRITICAL).
- **Round 2**: Planner revised plan addressing all feedback. Final review: all concerns ADDRESSED. **CONSENSUS reached.**

## Executive Summary

Add support for Paper, Fabric, Forge, and (future) NeoForge server types to the existing vanilla-only MC Server Manager. Add a historical log viewer. Key design decisions from consensus:

- **Discriminated union types** replace `meta: Record<string, string>` for type safety
- **Forge is split into its own deferrable phase** (Phase 3) -- Paper + Fabric can ship independently
- **`'provisioning'` server status** prevents start/delete during download/install
- **Per-provider ready detection** replaces the hardcoded Done regex
- **Forge installer** is treated as a first-class managed process with lifecycle management
- **`.mc-manager-launch.json`** stores Forge launch config at install time (no runtime file parsing)
- **Path traversal protection** is a hard security requirement for the log viewer

---

## Phase 1: Provider Architecture + Paper Support

**Goal**: Establish the provider abstraction and ship Paper as the first new server type. Paper is the simplest addition (single JAR download, same launch pattern as vanilla).

### Phase 1A: Shared Types & Provider Interface (backend + shared)

#### 1A.1: Extend `ServerType` and `ServerStatus` in `shared/src/index.ts`

**Add `'provisioning'` status:**

```typescript
export type ServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'provisioning';   // NEW: downloading JAR or running installer
```

The `'provisioning'` status is a guard status. While a server is in this status:
- `start()` is blocked (AppError 409)
- `stop()` is blocked
- `delete()` is blocked
- The frontend disables all lifecycle buttons and shows a provisioning indicator

**Add `jarPath` to `UpdateServerRequest`:**

```typescript
export interface UpdateServerRequest {
  name?: string;
  port?: number;
  jvmArgs?: string;
  javaPath?: string;
  autoStart?: boolean;
  jarPath?: string;  // NEW: updated by download/install completion
}
```

**Add discriminated union `DownloadRequest`:**

Replace the current flat `DownloadRequest` with a discriminated union:

```typescript
interface DownloadRequestBase {
  serverId: string;
  mcVersion: string;
}

export interface VanillaDownloadRequest extends DownloadRequestBase {
  serverType: 'vanilla';
}

export interface PaperDownloadRequest extends DownloadRequestBase {
  serverType: 'paper';
  build?: number;  // optional: specific build number, defaults to latest
}

export interface FabricDownloadRequest extends DownloadRequestBase {
  serverType: 'fabric';
  loaderVersion?: string;  // optional: defaults to latest stable
  installerVersion?: string;
}

export interface ForgeDownloadRequest extends DownloadRequestBase {
  serverType: 'forge';
  forgeVersion: string;  // REQUIRED: specific forge version
}

export type DownloadRequest =
  | VanillaDownloadRequest
  | PaperDownloadRequest
  | FabricDownloadRequest
  | ForgeDownloadRequest;
```

**Extend `DownloadJob`:**

```typescript
export type DownloadJobStatus =
  | 'pending'
  | 'downloading'
  | 'installing'   // NEW: post-download install phase (Forge)
  | 'completed'
  | 'failed';

export interface DownloadJob {
  id: string;
  serverId: string;
  mcVersion: string;
  serverType: ServerType;
  status: DownloadJobStatus;
  progress: number;          // 0-100
  totalBytes: number | null;
  downloadedBytes: number;
  filePath: string | null;
  error?: string;
  log: string[];             // NEW: installer output lines
  createdAt: number;         // NEW: Date.now() for cleanup TTL
}
```

**Version info per server type** (discriminated union for version picker APIs):

```typescript
export interface VanillaVersionInfo { type: 'vanilla'; mcVersion: string; }
export interface PaperVersionInfo { type: 'paper'; mcVersion: string; builds: number[]; latestBuild: number; }
export interface FabricVersionInfo { type: 'fabric'; mcVersion: string; loaderVersions: string[]; latestLoader: string; }
export interface ForgeVersionInfo { type: 'forge'; mcVersion: string; forgeVersions: string[]; recommended?: string; latest: string; }
export type VersionInfo = VanillaVersionInfo | PaperVersionInfo | FabricVersionInfo | ForgeVersionInfo;
```

#### 1A.2: Define the `ServerProvider` interface

**New file**: `packages/backend/src/providers/provider.ts`

```typescript
export interface LaunchConfig {
  javaArgs: string[];   // JVM args (e.g., -Xmx2G -Xms1G)
  mainArgs: string[];   // What comes after java + javaArgs (e.g., -jar server.jar nogui)
  cwd: string;
}

export interface ServerProvider {
  readonly type: ServerType;
  getVersions(includeSnapshots?: boolean): Promise<McVersion[]>;
  getVersionInfo?(mcVersion: string): Promise<VersionInfo>;
  download(request: DownloadRequest, destDir: string, job: DownloadJob): Promise<string>;
  getLaunchConfig(server: Server): LaunchConfig;
  getDoneRegex?(): RegExp | null;          // default: vanilla Done regex
  getStopCommand?(): string;               // default: "stop"
  getRunningTimeout?(): number;            // default: 120_000ms
  validateInstallation(server: Server): string | null;
}
```

#### 1A.3: Provider registry

**New file**: `packages/backend/src/providers/registry.ts`

- `Map<ServerType, ServerProvider>` with `registerProvider()` and `getProvider()`
- Export `SUPPORTED_SERVER_TYPES` as single source of truth for Zod schemas and shared types

#### 1A.4: Update `UpdateServerParams` in model

Add `jarPath` to `packages/backend/src/models/server.ts` `UpdateServerParams` and the `updateServer()` function. Also update the Zod `updateServerSchema` in `validation.ts`.

**Files modified**: `shared/src/index.ts`, `packages/backend/src/models/server.ts`, `packages/backend/src/routes/validation.ts`
**New files**: `packages/backend/src/providers/provider.ts`, `packages/backend/src/providers/registry.ts`

---

### Phase 1B: Refactor Process Launch to Use Providers

#### 1B.1: Simplify `ServerProcess.start()` signature

Change from `start(javaPath, jarPath, jvmArgs[], cwd)` to `start(javaPath, args[], cwd)`. The `ServerProcess` no longer knows about JARs -- it receives the complete args array. The `-jar jarPath nogui` construction moves to providers.

#### 1B.2: Add per-provider ready detection to `ServerProcess`

New `ProcessConfig` interface:

```typescript
export interface ProcessConfig {
  doneRegex: RegExp | null;    // null = rely on fallback timeout only
  stopCommand: string;          // default: 'stop'
  runningTimeoutMs: number;     // default: 120_000
}
```

`ServerProcess` constructor accepts optional `Partial<ProcessConfig>`. Uses config values instead of hardcoded `DONE_REGEX`, `'stop'`, and `120_000`.

#### 1B.3: Update `ServerManager.start()` to use providers

- Look up provider via `getProvider(server.type)`
- Call `provider.validateInstallation(server)` before starting
- Call `provider.getLaunchConfig(server)` to get launch args
- Build `ProcessConfig` from provider's optional methods
- Pass pre-built args to `ServerProcess.start()`

#### 1B.4: Implement `VanillaProvider`

**New file**: `packages/backend/src/providers/vanilla.ts`

Extracts existing vanilla logic from `versions.ts` and `download.ts`. Implements `ServerProvider` interface. `getLaunchConfig()` returns `[...jvmArgs, '-jar', jarPath, 'nogui']`. `validateInstallation()` checks JAR and directory exist.

**Files modified**: `packages/backend/src/services/process.ts`, `packages/backend/src/services/server-manager.ts`
**New files**: `packages/backend/src/providers/vanilla.ts`

---

### Phase 1C: Download System Improvements

#### 1C.1: `'provisioning'` status enforcement

Runtime status managed by `ServerManager` via `provisioningServers: Set<string>`. `setProvisioning()` / `clearProvisioning()` methods. `getStatus()` checks provisioning set first. Existing delete guard (`!= 'stopped' && != 'crashed'`) automatically blocks provisioning servers.

#### 1C.2: One-download-per-server guard

`activeServerDownloads: Map<serverId, jobId>` in `download.ts`. Throws `ConflictError` if a download is already running for the server.

#### 1C.3: Download cancellation

`AbortController` per job. New endpoint: `DELETE /api/downloads/:jobId`. On abort: clean up temp files, set status to `'failed'` with `error: 'Cancelled'`.

#### 1C.4: Download completion updates `jarPath`

After successful download, call `updateServer(serverId, { jarPath: finalJarPath })` and `serverManager.clearProvisioning(serverId)`.

#### 1C.5: Fix `cleanupOldJobs()`

Use `createdAt` field for TTL-based cleanup (1 hour default). Never clean up `'downloading'` or `'installing'` jobs.

**Files modified**: `packages/backend/src/services/download.ts`, `packages/backend/src/services/server-manager.ts`, `packages/backend/src/routes/downloads.ts`

---

### Phase 1D: Paper Provider

#### 1D.1: Paper version service

**New file**: `packages/backend/src/providers/paper.ts`

- Paper API: `https://api.papermc.io/v2/projects/paper`
- `getVersions()`: Fetch versions list (Paper only has releases)
- `getVersionInfo()`: Fetch builds for a specific MC version
- `download()`: Get latest build, download JAR with SHA256 verification
- `getLaunchConfig()`: Standard `-jar paper.jar nogui`
- 10-minute TTL cache for version list

#### 1D.2: Version picker route update

Generalize `GET /api/versions/vanilla` to `GET /api/versions/:type`. Add `GET /api/versions/:type/:mcVersion` for detailed version info (builds, loader versions).

#### 1D.3: Frontend version picker update

- `CreateServer.tsx`: Fetch from `/api/versions/{serverType}` based on selected type
- After MC version selection, fetch `/api/versions/paper/{mcVersion}` for build picker
- Show build number as secondary dropdown (default: latest, pre-selected)
- Mark `paper` as `available: true` in `SERVER_TYPES`

**Files modified**: `packages/backend/src/routes/versions.ts`, `packages/frontend/src/pages/CreateServer.tsx`, `packages/frontend/src/api/client.ts`
**New files**: `packages/backend/src/providers/paper.ts`

---

### Phase 1E: Frontend Provisioning State

- Add `'provisioning'` to `STATUS_LABELS` in `serverStore.ts`
- Update `StatusBadge.tsx` with spinner/pulsing indicator for provisioning
- Update `ServerControls.tsx` to disable all buttons during provisioning

**Files modified**: `packages/frontend/src/stores/serverStore.ts`, `packages/frontend/src/components/StatusBadge.tsx`, `packages/frontend/src/components/ServerControls.tsx`

---

## Phase 2: Fabric Support

**Goal**: Add Fabric as a server type. Fabric provides a direct server JAR download (no installer step), making it almost as simple as Paper.

### Phase 2A: Fabric Provider

**New file**: `packages/backend/src/providers/fabric.ts`

- Fabric Meta API: `https://meta.fabricmc.net/v2/`
- `getVersions()`: Fetch game versions, filter by `stable` unless snapshots requested
- `getVersionInfo()`: Fetch loader versions for the MC version
- `download()`: Direct JAR URL (`/v2/versions/loader/{mc}/{loader}/server/jar`). No hash available -- skip verification.
- `getLaunchConfig()`: Standard `-jar fabric-server-launch.jar nogui`
- Note: Fabric's snapshot version IDs (e.g., `25w44a`) don't follow semver -- handle in grouping logic

### Phase 2B: Frontend Fabric Support

- Mark `fabric` as `available: true`
- After MC version selection, show loader version picker (default: latest stable)
- Construct `FabricDownloadRequest` with selected loader version

### Phase 2C: Generalized Version Caching

**New file**: `packages/backend/src/utils/cache.ts`

Generic `TTLCache<T>` class with `get(fetcher)` and `invalidate()`. 10-minute default. Used by all providers.

**Files added**: `packages/backend/src/providers/fabric.ts`, `packages/backend/src/utils/cache.ts`
**Files modified**: `packages/backend/src/providers/registry.ts`, `packages/frontend/src/pages/CreateServer.tsx`

---

## Phase 3: Forge Support (Deferrable)

**Goal**: Add Forge server type. This is the most complex addition -- Forge requires running an installer JAR that performs network operations, takes 2-10 minutes, can fail partway, and produces non-standard launch arguments.

**This entire phase can be deferred** if Paper + Fabric cover enough user needs.

### Phase 3A: Forge Installer as Managed Process

**New file**: `packages/backend/src/providers/forge-installer.ts`

`ForgeInstaller` class extends `EventEmitter`:
- Spawns `java -jar forge-installer.jar --installServer` as child process
- Uses server's configured `javaPath` (passed explicitly to constructor)
- 10-minute timeout with SIGTERM -> SIGKILL escalation
- `cancel()` method for user-initiated cancellation
- Streams stdout/stderr via `'output'` events (piped to `DownloadJob.log`)
- On success: parses generated `unix_args.txt` or `run.sh` **once at install time**
- Writes structured result to `.mc-manager-launch.json` in server directory
- Legacy Forge (pre-1.17): detects forge JAR, writes standard `-jar` config
- Modern Forge (1.17+): parses args file, writes classpath-based config
- `cleanupFailedInstall()`: removes `libraries/`, `.mc-manager-launch.json`, installer JAR on failure

### Phase 3B: Forge Provider

**New file**: `packages/backend/src/providers/forge.ts`

- Forge promotions API: `https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`
- Forge Maven: `https://maven.minecraftforge.net/net/minecraftforge/forge/`
- `download()`: Two phases -- download installer JAR, then run `ForgeInstaller`
- `getLaunchConfig()`: Reads `.mc-manager-launch.json` from server directory
- `getDoneRegex()`: Returns vanilla regex (generally works for Forge)
- `getRunningTimeout()`: Returns 300_000ms (5 minutes for modded servers)
- `validateInstallation()`: Checks `.mc-manager-launch.json` exists and is valid JSON

### Phase 3C: Frontend Forge Support

- Mark `forge` as `available: true`
- Forge version picker with recommended vs latest labels
- Multi-phase creation progress: "Downloading..." -> "Installing..." (with streaming log output)
- Installer log displayed in collapsible terminal panel

### Phase 3D: Forge Installer Persistence

On app startup, scan for stale Forge installations (installer JAR present but no `.mc-manager-launch.json`). Clean up and log warning.

### Phase 3E: NeoForge Consideration

NeoForge is architecturally identical to Forge (forked from it). The `ForgeInstaller` class and `.mc-manager-launch.json` pattern work identically. Adding NeoForge is ~1 day of work after Forge ships. **Not implemented in this plan.**

**Files added**: `packages/backend/src/providers/forge.ts`, `packages/backend/src/providers/forge-installer.ts`
**Files modified**: `packages/backend/src/providers/registry.ts`, `packages/frontend/src/pages/CreateServer.tsx`

---

## Phase 4: Log Viewer (Historical Only)

**Goal**: Browse and search historical log files. This is **independent of Phases 1-3** and can be implemented in parallel. Scoped as a historical log browser only -- the Console tab already provides real-time output.

### Phase 4A: Backend Log API

#### Security: Path Traversal Protection (HARD REQUIREMENT)

**New file**: `packages/backend/src/utils/path-safety.ts`

```typescript
export function validatePathWithinBase(requestedPath: string, baseDir: string): string {
  // Reject null bytes
  // Reject explicit .. segments (defense in depth)
  // Resolve to absolute path via path.resolve()
  // Verify resolved path starts with baseDir + path.sep
  // Return validated absolute path or throw AppError
}

export function validateLogExtension(filePath: string): void {
  // Allow only: .log, .log.gz, .txt
}
```

#### Endpoints

**New file**: `packages/backend/src/routes/logs.ts`

```
GET /api/servers/:id/logs
  -> { files: LogFileEntry[] }
  Lists log files in {serverDir}/logs/. No recursion. No decompression.

GET /api/servers/:id/logs/:filename
  -> { content: string, totalLines: number, offset: number, limit: number, hasMore: boolean }
  Query params: ?offset=0&limit=500&search=regex
  Decompresses .gz files in memory (50MB uncompressed cap).
  Server-side pagination by line offset.
  Regex search validated before use.
```

### Phase 4B: Frontend Log Viewer

**New files**: `packages/frontend/src/components/LogViewer.tsx`, `packages/frontend/src/components/LogFileList.tsx`

- **LogFileList**: File list with name, size, date. Click to view. `latest.log` selected by default.
- **LogViewer**: Monospace read-only view with search box (regex), pagination, line numbers, scroll controls.
- No real-time auto-refresh. Manual "Refresh" button.
- Log level color coding: INFO (default), WARN (yellow), ERROR (red).

Enable the Logs tab in `ServerDetail.tsx` (set `available: true`, render `LogViewer` when active).

**Files added**: `packages/backend/src/routes/logs.ts`, `packages/backend/src/utils/path-safety.ts`, `packages/frontend/src/components/LogViewer.tsx`, `packages/frontend/src/components/LogFileList.tsx`
**Files modified**: `packages/backend/src/app.ts`, `packages/frontend/src/pages/ServerDetail.tsx`, `packages/frontend/src/api/client.ts`

---

## Dependency Graph

```
Phase 1A (types + provider interface)
  |
  +---> Phase 1B (process launch refactor)
  |       |
  |       +---> Phase 1D (Paper provider)
  |       |       |
  |       |       +---> Phase 1E (frontend provisioning UI)
  |       |
  |       +---> Phase 2A (Fabric provider)
  |               |
  |               +---> Phase 2B (frontend Fabric)
  |
  +---> Phase 1C (download improvements)
  |       |
  |       +---> Phase 1D (Paper uses download system)
  |       +---> Phase 2A (Fabric uses download system)
  |       +---> Phase 3A (Forge uses download + installer)
  |
  +---> Phase 2C (cache utility)
  |
  +---> Phase 3A (Forge installer) --> Phase 3B (Forge provider) --> Phase 3C (frontend)
  |                                                                     |
  |                                                                     +--> Phase 3D (persistence)
  |
  +---> Phase 4A (log API) --> Phase 4B (frontend log viewer)
```

**Phase 4** has no dependencies on Phases 1-3 and can be implemented in parallel.

---

## Complete File Change Summary

### New Files (12)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/src/providers/provider.ts` | 1A | ServerProvider interface and LaunchConfig type |
| `packages/backend/src/providers/registry.ts` | 1A | Provider registration and lookup |
| `packages/backend/src/providers/vanilla.ts` | 1B | Vanilla provider (refactored from existing code) |
| `packages/backend/src/providers/paper.ts` | 1D | Paper provider |
| `packages/backend/src/providers/fabric.ts` | 2A | Fabric provider |
| `packages/backend/src/providers/forge.ts` | 3B | Forge provider |
| `packages/backend/src/providers/forge-installer.ts` | 3A | Forge installer process manager |
| `packages/backend/src/utils/cache.ts` | 2C | Generic TTL cache utility |
| `packages/backend/src/utils/path-safety.ts` | 4A | Path traversal protection utilities |
| `packages/backend/src/routes/logs.ts` | 4A | Log viewer REST endpoints |
| `packages/frontend/src/components/LogViewer.tsx` | 4B | Log file content viewer |
| `packages/frontend/src/components/LogFileList.tsx` | 4B | Log file list component |

### Modified Files (16)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 1A | `'provisioning'` status, discriminated unions, `jarPath` on UpdateServerRequest, DownloadJobStatus, VersionInfo |
| `packages/backend/src/models/server.ts` | 1A | `jarPath` in `UpdateServerParams` and `updateServer()` |
| `packages/backend/src/routes/validation.ts` | 1A | `jarPath` in update schema, `SUPPORTED_SERVER_TYPES` |
| `packages/backend/src/services/process.ts` | 1B | Simplified `start()` signature, `ProcessConfig` |
| `packages/backend/src/services/server-manager.ts` | 1B, 1C | Provider-based launch, provisioning management, guard checks |
| `packages/backend/src/services/download.ts` | 1C | One-per-server guard, cancellation, `createdAt`, cleanup fix |
| `packages/backend/src/routes/downloads.ts` | 1C | `DELETE /:jobId`, discriminated union Zod schema |
| `packages/backend/src/routes/versions.ts` | 1D | `GET /:type`, `GET /:type/:mcVersion` |
| `packages/backend/src/app.ts` | 4A | Mount logs router |
| `packages/frontend/src/stores/serverStore.ts` | 1E | Provisioning in STATUS_LABELS |
| `packages/frontend/src/pages/CreateServer.tsx` | 1D, 2B, 3C | Multi-type version picker, build/loader pickers |
| `packages/frontend/src/pages/ServerDetail.tsx` | 4B | Enable Logs tab |
| `packages/frontend/src/components/StatusBadge.tsx` | 1E | Provisioning indicator |
| `packages/frontend/src/components/ServerControls.tsx` | 1E | Disable during provisioning |
| `packages/frontend/src/api/client.ts` | 1D, 4B | Log API + version API methods |

### Database Migration

No migration required. `jar_path` column already exists -- only the code-level `UpdateServerParams` is extended.

---

## Risks and Mitigations

### Critical

| Risk | Mitigation |
|------|------------|
| Path traversal in log viewer | `validatePathWithinBase()` with `path.resolve()` + `startsWith()`. Reject `..` segments. Validate extensions. **MUST NOT ship without this.** |
| Forge installer hangs indefinitely | 10-minute timeout with SIGTERM -> SIGKILL. Cancellation via `DELETE /api/downloads/:jobId`. |
| Forge installer leaves partial artifacts | `cleanupFailedInstall()` removes `libraries/`, `.mc-manager-launch.json`, installer JAR. |
| Race condition: start/delete during provisioning | `'provisioning'` status check in all lifecycle operations. One-download-per-server guard. |

### High

| Risk | Mitigation |
|------|------------|
| Forge installer is arbitrary code execution | Only download from official Maven (`maven.minecraftforge.net`). Document the trust assumption. |
| App restart during Forge install | Startup scan detects stale installations and cleans up. |
| `ServerType` / provider / Zod out of sync | `SUPPORTED_SERVER_TYPES` as single source of truth. TypeScript catches mismatches. |
| Done regex fails for non-standard outputs | Per-provider `getDoneRegex()`. Fallback timeout (120s default, 300s Forge). |

### Medium

| Risk | Mitigation |
|------|------------|
| `.gz` decompression expensive | 50MB cap. List endpoint never decompresses. |
| Version picker complexity | Progressive disclosure: MC version first, then type-specific secondary picker. |
| Vanilla-specific `server-setup.ts` | Provider-based setup. Default writes vanilla defaults (works for all types). |
| Forge `unix_args.txt` format changes | Parse once at install, store in `.mc-manager-launch.json`. Users can manually edit as escape hatch. |

---

## Implementation Order (Recommended)

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **Phase 1A** (types + interface) | ~2h | Foundation types and provider interface |
| 2 | **Phase 1B** (process refactor) | ~3h | Provider-based launch system |
| 3 | **Phase 1C** (download improvements) | ~2h | Provisioning, cancellation, guards |
| 4 | **Phase 1D** (Paper provider) | ~3h | Paper server creation end-to-end |
| 5 | **Phase 1E** (frontend provisioning) | ~2h | Provisioning UI state |
| 6 | **Phase 2C** (cache utility) | ~30m | Reusable TTL cache |
| 7 | **Phase 2A-2B** (Fabric) | ~3h | Fabric server creation end-to-end |
| 8 | **Phase 4A-4B** (Log viewer) | ~4h | Historical log browsing |
| 9 | **Phase 3** (Forge) | ~8h | Forge server creation (deferrable) |

**Total**: ~27 hours all phases, ~15 hours without Forge.

---

## Testing Strategy

No automated test framework exists. Manual testing checklist:

1. **Each provider**: Create server, verify download, verify start reaches `running`, verify `stop` works
2. **Provisioning guard**: Try to start/delete during download -- verify 409 response
3. **Download cancellation**: Start download, cancel, verify cleanup
4. **Concurrent downloads**: Start two downloads for same server -- verify second rejected
5. **Log viewer**: Start server (generates logs), stop, verify logs browsable. Test path traversal payloads (`../../etc/passwd`, null bytes) -- verify all rejected
6. **Forge installer failure** (Phase 3): Kill manager during install, restart, verify stale install detected and cleaned
7. **Provider validation** (Phase 3): Start Forge server with missing `.mc-manager-launch.json` -- verify clear error
