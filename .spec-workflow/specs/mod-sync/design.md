# Design Document -- Server-Client Mod Synchronization

## Overview

Enable automatic mod synchronization when a user joins a shared Minecraft server. The host's backend generates a canonical mod manifest from its installed mods (Epic 2 data). The client fetches this manifest, compares it to the local instance's mods (Epic 4 data), computes a diff, and presents a confirmation dialog. After confirmation, missing mods are downloaded from trusted sources (Modrinth CDN or the community server), verified by SHA-1 hash, and installed. Incompatible mods are disabled. The game then launches and auto-connects.

## Steering Document Alignment

No steering docs exist. This design follows existing project conventions (Express routes, Zod validation, SQLite models, Zustand stores, Tailwind UI, WebSocket message protocol with `type` discriminator). It builds on Epic 2 (server mods), Epic 4 (client mods), and Epic 7 (community/shared server infrastructure).

## Code Reuse Analysis

### Existing Components to Leverage
- **ModModel (`packages/backend/src/models/mod.ts`)**: From Epic 2 -- provides `getByServerId()` to list installed server mods with hashes, Modrinth IDs, file names, and side metadata. Core data source for manifest generation.
- **ServerModel (`packages/backend/src/models/server.ts`)**: Provides server name, version, and jar type for manifest metadata.
- **Community routes (`packages/backend/src/routes/community-servers.ts`)**: From Epic 7 -- existing route file where manifest and mod download endpoints are added. Already has auth/access checking patterns.
- **Server permission middleware (`packages/backend/src/middleware/server-permission.ts`) from Epic 7 -- provides permission-gated access control for shared server endpoints.**
- **InstalledMod type (`shared/src/index.ts`)**: From Epic 4 -- the client-side mod type used for diff comparison against manifest mods.
- **Error classes (`packages/backend/src/utils/errors.ts`)**: NotFoundError, ForbiddenError for endpoint error handling.
- **Zod validation**: All new route handlers use Zod schemas following existing patterns.
- **Pino logger**: Existing logger for manifest generation and download logging.
- **Tailwind component patterns**: Existing dialog/modal patterns reused for ModSyncDialog.
- **lucide-react icons**: Download, AlertTriangle, Check, X icons for sync dialog sections.

### Integration Points
- **`installed_mods` table (Epic 2)**: Source data for manifest generation -- mod name, version, hash, Modrinth ID, side, file name.
- **Client instance mod list (Epic 4)**: Local mods fetched via API for diff computation against the manifest.
- **ServerCard component (`packages/frontend/src/components/ServerCard.tsx`) from Epic 7**: The "Join" button is modified to trigger the sync flow before launching.
- **Community server access control (Epic 7)**: Manifest and mod download endpoints reuse the same access checking.
- **Express app (`app.ts`)**: Endpoints are added to existing community-servers routes (`packages/backend/src/routes/community-servers.ts` from Epic 7).
- **Shared types (`shared/src/index.ts`)**: New types exported alongside existing types.

## Architecture

### Sync Protocol Flow

```
User clicks "Join" on shared server
  |
  +--> Frontend: GET /api/community/servers/:id/mod-manifest
  |      +--> Backend: Read installed_mods for server from DB
  |      +--> Backend: Build ServerModManifest with download URLs
  |      +--> Backend: Return manifest JSON
  |
  +--> Frontend: Fetch local instance mods from client DB
  |
  +--> Frontend: Compute ModSyncDiff (client-side, in-memory)
  |      +--> Compare by hash (exact match) and Modrinth ID (version match)
  |      +--> Categorize: toInstall, toUpdate, toRemove, toDisable, toKeep
  |
  +--> Frontend: Show ModSyncDialog (if changes needed)
  |      +--> User reviews changes and confirms or cancels
  |
  +--> Frontend: Download mods (parallel, concurrency=5)
  |      +--> Validate URL against trusted domain whitelist
  |      +--> Download file bytes
  |      +--> Compute SHA-1, compare to manifest hash
  |      +--> Write file to instance mods/ directory
  |      +--> Update installed_mods DB record
  |
  +--> Frontend: Disable incompatible mods (.jar to .jar.disabled)
  |
  +--> Frontend: Launch Minecraft with instance, auto-connect to server
```

### Manifest Generation Flow (Backend)

```
GET /api/community/servers/:id/mod-manifest
  |
  +--> Auth: Verify user has access to this shared server
  |
  +--> ModManifestService.generateManifest(serverId)
  |      +--> ServerModel.getById(serverId) -- get server metadata
  |      +--> ModModel.getByServerId(serverId) -- get all installed mods
  |      +--> For each enabled mod:
  |      |      +--> If has modrinthId + versionId: CDN URL
  |      |      +--> Else: community server file endpoint URL
  |      |      +--> Categorize by side: required (server/both) or optional (client)
  |      +--> Return ServerModManifest
  |
  +--> Response: JSON manifest
```

### Diff Computation Flow (Frontend)

```
computeDiff(manifest, localMods)
  |
  +--> Build lookup maps:
  |      +--> localByHash: Map of fileHash to InstalledMod
  |      +--> localByModrinthId: Map of modrinthId to InstalledMod
  |      +--> manifestByHash: Map of fileHash to ManifestMod
  |      +--> manifestByModrinthId: Map of modrinthId to ManifestMod
  |
  +--> For each required manifest mod:
  |      +--> Hash match in local? --> skip (already installed)
  |      +--> Modrinth ID match? --> toUpdate (version differs)
  |      +--> No match? --> toInstall
  |
  +--> For each local mod not matched above:
  |      +--> In incompatibleMods list? --> toDisable
  |      +--> Side is "client"? --> toKeep
  |      +--> Side is "server"/"both"? --> toRemove
  |      +--> Unknown side? --> toKeep (safe default)
  |
  +--> Return ModSyncDiff
```

## Components and Interfaces

### Component 1: ModManifestService (`packages/backend/src/services/mod-manifest-service.ts`)
- **Purpose**: Generate a ServerModManifest from a server's installed mods. Reads the mod database, builds download URLs, categorizes mods by side.
- **Interfaces**: `generateManifest(serverId: string): Promise<ServerModManifest>`, private `getDownloadUrl(mod, serverId): string`, private `detectLoader(server): ModLoaderInfo`
- **Dependencies**: ModModel (Epic 2), ServerModel, NotFoundError
- **Reuses**: Existing model query patterns, Modrinth CDN URL format from Epic 2

### Component 2: Manifest API Endpoint (added to `packages/backend/src/routes/community-servers.ts`)
- **Purpose**: Expose the mod manifest and mod file downloads via REST API
- **Endpoints**: `GET /api/community/servers/:id/mod-manifest`, `GET /api/community/servers/:serverId/mods/:hash/download`
- **Dependencies**: ModManifestService, Server permission middleware (access checks), ModModel, path module
- **Reuses**: Existing community route patterns, access control from Epic 7

### Component 3: ModSyncService (`packages/frontend/src/services/mod-sync-service.ts`)
- **Purpose**: Client-side service that compares a server manifest with local instance mods, producing a ModSyncDiff. Also provides download size estimation and formatting.
- **Interfaces**: `computeDiff(manifest: ServerModManifest, localMods: InstalledMod[]): ModSyncDiff`, `estimateDownloadSize(diff: ModSyncDiff): number`, `formatSize(bytes: number): string`
- **Dependencies**: Shared types (ServerModManifest, ModSyncDiff, InstalledMod, ManifestMod)
- **Reuses**: None (new pure logic service)

### Component 4: ModDownloadService (`packages/frontend/src/services/mod-download-service.ts`)
- **Purpose**: Download mod files from trusted sources, verify SHA-1 hashes, install to client instance. Manages parallel downloads with concurrency limiting and progress reporting.
- **Interfaces**: `downloadAndInstall(instanceId: string, mods: ManifestMod[], onProgress: (progress: ModSyncProgress) => void): Promise<ModDownloadResult>`, private `downloadFile(url: string): Promise<Uint8Array>`, private `isTrustedUrl(url: string): boolean`, private `computeSHA1(data: Uint8Array): string`, private `installMod(instanceId, mod, fileData): Promise<void>`
- **Dependencies**: ManifestMod, ModSyncProgress types, Tauri invoke API (for file system operations)
- **Reuses**: Tauri HTTP client for downloads (bypasses CORS), Tauri file system for mod installation
- **Security Enhancement**: For mods with a non-null `modrinthId` and `modrinthVersionId`, cross-verify the file hash against the Modrinth API (`GET https://api.modrinth.com/v2/version/{versionId}`) before trusting the manifest's hash. This prevents a compromised host from lying about mod hashes. For mods without a Modrinth ID (community server downloads), show a prominent warning in the sync dialog: "This mod is not independently verified. Only proceed if you trust the server owner." Additionally, if `mod.modrinthId` is non-null, validate that `mod.downloadUrl` starts with `https://cdn.modrinth.com/`. If it does not, treat the mod as unverified regardless of the modrinthId claim — apply the warning badge and require the trust checkbox.

### Component 5: ModSyncDialog (`packages/frontend/src/components/community/ModSyncDialog.tsx`)
- **Purpose**: Confirmation dialog showing the mod sync diff grouped by category (install, update, remove, disable, keep). Displays download size estimate and confirm/cancel buttons.
- **Props**: `manifest: ServerModManifest`, `diff: ModSyncDiff`, `onConfirm: () => void`, `onCancel: () => void`
- **Dependencies**: ModSyncService (for size formatting), lucide-react icons, shared types
- **Reuses**: Tailwind dialog/modal patterns, lucide-react icons
- **Visual Distinction**: Non-Modrinth mods are visually distinguished with a warning badge and tooltip: 'This mod cannot be independently verified.'
- **Unverified Mod Consent**: When the diff contains any non-Modrinth mods (modrinthId is null), display a checkbox: 'I trust the server owner for N unverified mod(s)'. The 'Sync and Join' button MUST be disabled until this checkbox is checked. This provides explicit user consent for downloading unverified content.

### Component 6: ModSyncProgressDialog (`packages/frontend/src/components/community/ModSyncProgressDialog.tsx`)
- **Purpose**: Progress overlay during mod download/install. Shows current phase, mod name, progress bar, and error messages.
- **Props**: `progress: ModSyncProgress`
- **Dependencies**: ModSyncProgress type, lucide-react Loader2 icon
- **Reuses**: Tailwind progress bar patterns

### Component 7: Join Flow Integration (modified `packages/frontend/src/components/ServerCard.tsx`)
- **Purpose**: Wire the sync flow into the existing "Join" button. On click: fetch manifest, compute diff, show dialog or launch directly, handle sync confirmation and progress.
- **Dependencies**: ModSyncService, ModDownloadService, ModSyncDialog, ModSyncProgressDialog, community API client
- **Reuses**: Existing ServerCard from Epic 7, client instance store from Epic 4

## Data Models

No new database tables are needed. This epic reads from existing tables (installed_mods from Epic 2, client instance mods from Epic 4, community server data from Epic 7).

### Shared TypeScript Types

Added to `shared/src/index.ts`:

```typescript
// Mod loader type (may already exist from Epic 2)
// type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';

interface ServerModManifest {
  serverId: string;
  serverName: string;
  mcVersion: string;
  loader: ModLoader;
  loaderVersion: string;
  requiredMods: ManifestMod[];
  optionalMods: ManifestMod[];
  incompatibleMods: string[];  // Modrinth project IDs that must NOT be installed
  generatedAt: string;         // ISO timestamp
}

interface ManifestMod {
  modrinthId: string | null;   // null for non-Modrinth mods
  modrinthVersionId: string | null;  // null for non-Modrinth mods; needed for CDN URL construction and Modrinth API cross-verification
  fileName: string;
  fileHash: string;            // SHA-1
  fileSize: number;
  downloadUrl: string;         // Modrinth CDN or community server URL
  name: string;
  version: string;
  side: 'server' | 'client' | 'both';
}

interface ModSyncDiff {
  toInstall: ManifestMod[];
  toUpdate: Array<{
    current: InstalledMod;
    target: ManifestMod;
  }>;
  toRemove: InstalledMod[];
  toDisable: InstalledMod[];
  toKeep: InstalledMod[];
  optionalAvailable: ManifestMod[];
}

interface ModSyncProgress {
  phase: 'downloading' | 'verifying' | 'installing' | 'complete' | 'error';
  currentMod: string | null;
  completed: number;
  total: number;
  error: string | null;
}

interface ModSyncResult {
  success: boolean;
  installed: number;
  updated: number;
  removed: number;
  disabled: number;
  errors: string[];
}
```

## Error Handling

### Error Scenarios

1. **Server not found or no access**
   - **Handling**: Manifest endpoint returns 403 ForbiddenError or 404 NotFoundError.
   - **User Impact**: Toast error "No access to this server" or "Server not found".

2. **Hash mismatch after download**
   - **Handling**: Downloaded file is deleted. Error recorded for that mod. Other downloads continue.
   - **User Impact**: Progress dialog shows error. Sync result lists failed mods. User can retry.

3. **Download failure (network error)**
   - **Handling**: Error recorded for that specific mod. Other parallel downloads continue unaffected.
   - **User Impact**: Progress dialog shows error for that mod. Partial sync result shown with option to retry.

4. **Untrusted download URL**
   - **Handling**: Download rejected immediately with security error. File is not downloaded.
   - **User Impact**: Error shown: "Untrusted download URL" for the specific mod.

5. **Modrinth hash verification mismatch**
   - **Handling**: The manifest claims a mod has a Modrinth ID, but the hash from the Modrinth API doesn't match the manifest hash. Download is rejected.
   - **User Impact**: Error shown: "Mod hash doesn't match Modrinth registry. The server may have a modified version of this mod."

6. **No compatible client instance**
   - **Handling**: Join flow checks for a client instance matching the server's Minecraft version before fetching manifest.
   - **User Impact**: Toast error "No compatible client instance found for version X.Y.Z".

7. **Path traversal in mod file download**
   - **Handling**: Backend resolves the file path and verifies it is within the server directory. Returns 403 if not.
   - **User Impact**: Never seen by legitimate users. Blocks malicious requests.

8. **Stale manifest**
   - **Handling**: Manifest includes `generatedAt` timestamp. Future enhancement: warn if manifest is older than 1 hour.
   - **User Impact**: Rare edge case where host updates mods after manifest was generated.

9. **Mod file not found on server**
   - **Handling**: Mod download endpoint returns 404. Treated as a download failure.
   - **User Impact**: Error for that specific mod in sync results.

## File Structure

### New Files
```
packages/backend/src/services/mod-manifest-service.ts        # Manifest generation service
packages/frontend/src/services/mod-sync-service.ts            # Diff computation service
packages/frontend/src/services/mod-download-service.ts        # Download + hash verify service
packages/frontend/src/components/community/ModSyncDialog.tsx   # Sync confirmation dialog
packages/frontend/src/components/community/ModSyncProgressDialog.tsx  # Progress overlay
```

### Modified Files
```
shared/src/index.ts                                            # Add mod sync types
packages/backend/src/routes/community-servers.ts               # Add manifest + download endpoints
packages/frontend/src/components/ServerCard.tsx                # Wire sync into Join button
```

## Dependencies

### New Backend npm Packages
- None required. All functionality uses existing packages (express, better-sqlite3, path, crypto).

### New Frontend npm Packages
- None required. Uses existing Tauri invoke API for file system operations and HTTP downloads. SHA-1 computed via Web Crypto API or Tauri backend.

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual verification.
- Key verification: diff computation logic (all 5 categories), hash verification, URL validation.

### Integration Testing
- **No changes needed**: Join a server where local mods already match the manifest. Verify no dialog appears and game launches directly.
- **Install required mod**: Server requires Sodium, client does not have it. Dialog shows "Install 1 mod". Confirm. Mod downloaded, verified, installed. Game launches.
- **Update mod version**: Client has Sodium 0.5.0, server requires 0.6.0. Dialog shows "Update 1 mod" with version change. Old version replaced.
- **Remove extra server mod**: Client has a server-side mod not in manifest. Dialog shows "Remove 1 mod" with warning. Mod disabled.
- **Disable incompatible mod**: Client has a minimap mod marked incompatible by server. Dialog shows "Disable 1 incompatible mod". Mod renamed to .jar.disabled.
- **Keep client-only mod**: Client has OptiFine (client-only). Dialog shows "Keep 1 client-only mod" in collapsible section.
- **Hash mismatch**: Simulate corrupted download. Verify file is deleted, error shown, mod not installed.
- **Untrusted URL**: Manifest contains URL from untrusted domain. Verify download is rejected with security error.
- **Cancel sync**: Open sync dialog, click Cancel. Verify no changes made.
- **Large modpack**: Server with 50+ mods. Progress dialog shows phases. All mods installed successfully.
- **Non-Modrinth mod**: Server has custom mod without Modrinth ID. Downloaded from community server file endpoint.

### End-to-End Testing
- Full flow: Host adds mods to server via Epic 2, shares server via Epic 7, player clicks Join, sync dialog appears, player confirms, mods sync, game launches and connects.
