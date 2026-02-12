# Epic 9 — Server-Client Mod Synchronization

> **Prerequisite for**: None (capstone epic)
> **Standalone value**: One-click join with automatic mod synchronization — no manual mod matching required
> **Dependencies**: Epic 2 (Server Mods), Epic 4 (Client Mods), Epic 7 (Shared Servers)

---

## Executive Summary

Enable automatic mod synchronization when a user joins a shared Minecraft server. When clicking "Join" on a shared server, the client fetches the server's mod manifest, compares it with the target client instance's installed mods, computes a diff, and presents a confirmation dialog showing what will be installed, updated, or removed. After user confirmation, the client downloads missing mods from trusted sources (Modrinth CDN), verifies hashes, and launches Minecraft with the correct mod configuration.

### Key Decisions

- **Server-driven manifest**: The community server (host) provides a canonical mod manifest with hashes and download URLs
- **Client-side reconciliation**: The desktop app compares the manifest with the local instance and computes the diff
- **Modrinth CDN only**: Only download from `cdn.modrinth.com` or the community server itself (for non-Modrinth mods)
- **Hash verification**: All downloaded files must match SHA-1 hashes from the manifest
- **User confirmation required**: Never auto-install without showing the user what will change
- **Non-destructive**: Client-only mods (minimaps, shaders) are preserved unless explicitly incompatible

---

## Architecture

### Data Flow

```
User clicks "Join" on shared server
  │
  ├─► Frontend: GET /api/community/servers/:id/mod-manifest
  │     └─► Community Server returns ServerModManifest
  │
  ├─► Frontend: Compare manifest with local instance mods
  │     └─► Compute diff: { toInstall, toUpdate, toRemove, toDisable }
  │
  ├─► Frontend: Show ModSyncDialog with diff summary
  │     └─► User confirms or cancels
  │
  ├─► Frontend: Download missing mods (parallel, concurrency=5)
  │     ├─► Verify SHA-1 hash for each file
  │     ├─► Install to instance mods/ directory
  │     └─► Update installed_mods table
  │
  ├─► Frontend: Disable incompatible mods
  │     └─► Rename .jar → .jar.disabled
  │
  └─► Frontend: Launch Minecraft with instance
        └─► Auto-connect to server IP:port
```

### Sync Protocol

```
┌─────────────────────────────────────────────────────────┐
│ Community Server (Host)                                 │
│                                                         │
│  GET /api/community/servers/:id/mod-manifest           │
│  ──────────────────────────────────────────────────►   │
│                                                         │
│  ◄──────────────────────────────────────────────────   │
│  {                                                      │
│    serverId: "abc123",                                  │
│    serverName: "My Modded Server",                      │
│    mcVersion: "1.21.4",                                 │
│    loader: "fabric",                                    │
│    loaderVersion: "0.16.0",                             │
│    requiredMods: [                                      │
│      {                                                  │
│        modrinthId: "AANobbMI",                          │
│        fileName: "sodium-fabric-0.6.0.jar",             │
│        fileHash: "a1b2c3...",                           │
│        fileSize: 1234567,                               │
│        downloadUrl: "https://cdn.modrinth.com/...",     │
│        name: "Sodium",                                  │
│        version: "0.6.0",                                │
│        side: "both"                                     │
│      },                                                 │
│      ...                                                │
│    ],                                                   │
│    optionalMods: [...],                                 │
│    incompatibleMods: ["P7dR8mSH"]  // Minimap mod ID   │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Desktop App (Client)                                    │
│                                                         │
│  1. Fetch local instance mods from DB                   │
│  2. Compare with manifest:                              │
│     - Missing required mod → toInstall                  │
│     - Wrong version → toUpdate                          │
│     - Extra client-only mod → keep (ignore)             │
│     - Extra server-side mod → warn (optional disable)   │
│     - Incompatible mod → toDisable (must remove)        │
│  3. Show confirmation dialog                            │
│  4. Download, verify, install                           │
│  5. Launch MC and connect                               │
└─────────────────────────────────────────────────────────┘
```

---

## Shared Types

Add to `shared/src/index.ts`:

```typescript
// --- Mod Sync Types ---

export interface ServerModManifest {
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

export interface ManifestMod {
  modrinthId: string | null;   // null for non-Modrinth mods
  fileName: string;
  fileHash: string;            // SHA-1
  fileSize: number;
  downloadUrl: string;         // Modrinth CDN or community server URL
  name: string;
  version: string;
  side: 'server' | 'client' | 'both';
}

export interface ModSyncDiff {
  toInstall: ManifestMod[];    // Missing required mods
  toUpdate: {
    current: InstalledMod;     // From Epic 4 types
    target: ManifestMod;
  }[];
  toRemove: InstalledMod[];    // Server-side mods not in manifest
  toDisable: InstalledMod[];   // Incompatible mods
  toKeep: InstalledMod[];      // Client-only mods (informational)
  optionalAvailable: ManifestMod[];  // Optional mods user can choose to install
}

export interface ModSyncProgress {
  phase: 'downloading' | 'verifying' | 'installing' | 'complete' | 'error';
  currentMod: string | null;
  completed: number;
  total: number;
  error: string | null;
}

export interface ModSyncResult {
  success: boolean;
  installed: number;
  updated: number;
  removed: number;
  disabled: number;
  errors: string[];
}
```

---

## Phase 9A: Backend — Mod Manifest Generation

### 9A.1: Manifest generation service

**New file**: `packages/backend/src/services/mod-manifest-service.ts`

This service generates the `ServerModManifest` for a managed Minecraft server. It reads the server's installed mods (from Epic 2) and builds a manifest that clients can use for synchronization.

```typescript
export class ModManifestService {
  constructor(
    private modModel: ModModel,
    private serverModel: ServerModel
  ) {}

  /**
   * Generate a mod manifest for a server.
   * Includes all installed mods with download URLs and hashes.
   * For Modrinth mods, uses CDN URLs. For non-Modrinth mods,
   * generates URLs pointing to the community server's file endpoint.
   */
  async generateManifest(serverId: string): Promise<ServerModManifest> {
    const server = this.serverModel.getById(serverId);
    if (!server) throw new NotFoundError('Server not found');

    const installedMods = this.modModel.getByServerId(serverId);
    const loader = this.detectLoader(server);

    const requiredMods: ManifestMod[] = [];
    const optionalMods: ManifestMod[] = [];
    const incompatibleMods: string[] = [];

    for (const mod of installedMods) {
      if (!mod.enabled) continue;

      const manifestMod: ManifestMod = {
        modrinthId: mod.modrinthId,
        fileName: mod.fileName,
        fileHash: mod.fileHash,
        fileSize: mod.fileSize,
        downloadUrl: this.getDownloadUrl(mod, serverId),
        name: mod.name,
        version: mod.version || 'unknown',
        side: mod.side,
      };

      // Categorize based on side
      if (mod.side === 'server' || mod.side === 'both') {
        requiredMods.push(manifestMod);
      } else if (mod.side === 'client') {
        optionalMods.push(manifestMod);
      }
    }

    return {
      serverId,
      serverName: server.name,
      mcVersion: server.version,
      loader: loader.type,
      loaderVersion: loader.version,
      requiredMods,
      optionalMods,
      incompatibleMods,  // Could be populated from server config
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get download URL for a mod.
   * - Modrinth mods: Use CDN URL from version metadata
   * - Non-Modrinth mods: Use community server file endpoint
   */
  private getDownloadUrl(mod: InstalledMod, serverId: string): string {
    if (mod.modrinthId && mod.modrinthVersionId) {
      // Modrinth CDN URL (from Epic 2 ModVersion.files[0].url)
      return `https://cdn.modrinth.com/data/${mod.modrinthId}/versions/${mod.modrinthVersionId}/${mod.fileName}`;
    } else {
      // Community server file endpoint (see 9A.2)
      return `/api/community/servers/${serverId}/mods/${mod.fileHash}/download`;
    }
  }

  private detectLoader(server: Server): { type: ModLoader; version: string } {
    // Parse from server.jarPath or server.type
    // Implementation depends on Epic 2 loader detection
    // Placeholder:
    return { type: 'fabric', version: '0.16.0' };
  }
}
```

### 9A.2: Manifest API endpoint

**Modified file**: `packages/backend/src/routes/community.ts` (from Epic 7)

Add endpoint to serve the mod manifest:

```typescript
// GET /api/community/servers/:id/mod-manifest
router.get('/servers/:id/mod-manifest', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Authorization: User must have access to this shared server (Epic 7)
    const hasAccess = await communityService.checkServerAccess(req.userId, id);
    if (!hasAccess) {
      throw new ForbiddenError('No access to this server');
    }

    const manifest = await modManifestService.generateManifest(id);
    res.json(manifest);
  } catch (err) {
    next(err);
  }
});

// GET /api/community/servers/:serverId/mods/:hash/download
// Serves non-Modrinth mod files directly from the server's mods/ directory
router.get('/servers/:serverId/mods/:hash/download', async (req, res, next) => {
  try {
    const { serverId, hash } = req.params;

    const hasAccess = await communityService.checkServerAccess(req.userId, serverId);
    if (!hasAccess) {
      throw new ForbiddenError('No access to this server');
    }

    const mod = modModel.getByHash(serverId, hash);
    if (!mod) throw new NotFoundError('Mod not found');

    const filePath = path.join(getServerDirectory(serverId), 'mods', mod.fileName);
    
    // Security: Verify path is within server directory
    const resolvedPath = path.resolve(filePath);
    const serverDir = path.resolve(getServerDirectory(serverId));
    if (!resolvedPath.startsWith(serverDir)) {
      throw new ForbiddenError('Invalid file path');
    }

    res.download(filePath, mod.fileName);
  } catch (err) {
    next(err);
  }
});
```

**Files created**: `packages/backend/src/services/mod-manifest-service.ts`
**Files modified**: `packages/backend/src/routes/community.ts`

---

## Phase 9B: Frontend — Mod Diff Computation

### 9B.1: Mod sync service (frontend)

**New file**: `packages/frontend/src/services/mod-sync-service.ts`

Client-side service that compares the server manifest with the local instance's mods.

```typescript
import { ServerModManifest, ModSyncDiff, InstalledMod, ManifestMod } from '@mc-server-manager/shared';

export class ModSyncService {
  /**
   * Compare server manifest with local instance mods.
   * Returns a diff showing what needs to change.
   */
  computeDiff(
    manifest: ServerModManifest,
    localMods: InstalledMod[]
  ): ModSyncDiff {
    const diff: ModSyncDiff = {
      toInstall: [],
      toUpdate: [],
      toRemove: [],
      toDisable: [],
      toKeep: [],
      optionalAvailable: manifest.optionalMods,
    };

    // Build lookup maps
    const localByHash = new Map(localMods.map(m => [m.fileHash, m]));
    const localByModrinthId = new Map(
      localMods.filter(m => m.modrinthId).map(m => [m.modrinthId!, m])
    );
    const manifestByHash = new Map(manifest.requiredMods.map(m => [m.fileHash, m]));
    const manifestByModrinthId = new Map(
      manifest.requiredMods.filter(m => m.modrinthId).map(m => [m.modrinthId!, m])
    );

    // Check required mods
    for (const manifestMod of manifest.requiredMods) {
      const localByHashMatch = localByHash.get(manifestMod.fileHash);
      const localByIdMatch = manifestMod.modrinthId
        ? localByModrinthId.get(manifestMod.modrinthId)
        : null;

      if (localByHashMatch) {
        // Exact match — already installed
        continue;
      } else if (localByIdMatch) {
        // Same mod, different version
        diff.toUpdate.push({
          current: localByIdMatch,
          target: manifestMod,
        });
      } else {
        // Missing mod
        diff.toInstall.push(manifestMod);
      }
    }

    // Check local mods
    for (const localMod of localMods) {
      const inManifest = manifestByHash.has(localMod.fileHash) ||
        (localMod.modrinthId && manifestByModrinthId.has(localMod.modrinthId));

      if (inManifest) {
        continue; // Already handled above
      }

      // Check if incompatible
      if (localMod.modrinthId && manifest.incompatibleMods.includes(localMod.modrinthId)) {
        diff.toDisable.push(localMod);
        continue;
      }

      // Categorize based on side
      if (localMod.side === 'client') {
        // Client-only mod — keep it
        diff.toKeep.push(localMod);
      } else if (localMod.side === 'server' || localMod.side === 'both') {
        // Server-side mod not in manifest — warn user
        diff.toRemove.push(localMod);
      } else {
        // Unknown side — keep it to be safe
        diff.toKeep.push(localMod);
      }
    }

    return diff;
  }

  /**
   * Estimate download size for a diff.
   */
  estimateDownloadSize(diff: ModSyncDiff): number {
    let size = 0;
    for (const mod of diff.toInstall) {
      size += mod.fileSize;
    }
    for (const { target } of diff.toUpdate) {
      size += target.fileSize;
    }
    return size;
  }

  /**
   * Format download size for display.
   */
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

export const modSyncService = new ModSyncService();
```

**Files created**: `packages/frontend/src/services/mod-sync-service.ts`

---

## Phase 9C: Frontend — Mod Sync Dialog

### 9C.1: ModSyncDialog component

**New file**: `packages/frontend/src/components/community/ModSyncDialog.tsx`

This dialog appears when the user clicks "Join" on a shared server and mods differ.

```tsx
import { useState } from 'react';
import { ServerModManifest, ModSyncDiff } from '@mc-server-manager/shared';
import { modSyncService } from '../../services/mod-sync-service';
import { Download, AlertTriangle, Check, X } from 'lucide-react';

interface ModSyncDialogProps {
  manifest: ServerModManifest;
  diff: ModSyncDiff;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ModSyncDialog({ manifest, diff, onConfirm, onCancel }: ModSyncDialogProps) {
  const downloadSize = modSyncService.estimateDownloadSize(diff);
  const hasChanges = diff.toInstall.length > 0 || diff.toUpdate.length > 0 ||
                     diff.toRemove.length > 0 || diff.toDisable.length > 0;

  if (!hasChanges) {
    // No changes needed — auto-proceed
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold">Sync Mods for {manifest.serverName}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            The following changes are required to join this server:
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-96">
          {/* To Install */}
          {diff.toInstall.length > 0 && (
            <Section
              icon={<Download className="w-5 h-5 text-green-500" />}
              title={`Install ${diff.toInstall.length} mod(s)`}
              items={diff.toInstall.map(m => `${m.name} ${m.version}`)}
            />
          )}

          {/* To Update */}
          {diff.toUpdate.length > 0 && (
            <Section
              icon={<Download className="w-5 h-5 text-blue-500" />}
              title={`Update ${diff.toUpdate.length} mod(s)`}
              items={diff.toUpdate.map(u => `${u.current.name} ${u.current.version} → ${u.target.version}`)}
            />
          )}

          {/* To Remove */}
          {diff.toRemove.length > 0 && (
            <Section
              icon={<X className="w-5 h-5 text-orange-500" />}
              title={`Remove ${diff.toRemove.length} mod(s)`}
              items={diff.toRemove.map(m => `${m.name} (not required by server)`)}
              warning="These mods are not used by the server and will be disabled."
            />
          )}

          {/* To Disable */}
          {diff.toDisable.length > 0 && (
            <Section
              icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
              title={`Disable ${diff.toDisable.length} incompatible mod(s)`}
              items={diff.toDisable.map(m => m.name)}
              warning="These mods are incompatible with the server and must be disabled."
            />
          )}

          {/* To Keep */}
          {diff.toKeep.length > 0 && (
            <Section
              icon={<Check className="w-5 h-5 text-gray-500" />}
              title={`Keep ${diff.toKeep.length} client-only mod(s)`}
              items={diff.toKeep.map(m => m.name)}
              collapsible
            />
          )}

          {/* Download size */}
          {downloadSize > 0 && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Total download size: <strong>{modSyncService.formatSize(downloadSize)}</strong>
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded"
          >
            Sync & Join
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  items,
  warning,
  collapsible = false,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  warning?: string;
  collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(collapsible);

  return (
    <div className="mb-4">
      <div
        className="flex items-center gap-2 mb-2 cursor-pointer"
        onClick={() => collapsible && setCollapsed(!collapsed)}
      >
        {icon}
        <h3 className="font-medium">{title}</h3>
        {collapsible && (
          <span className="text-xs text-gray-500 ml-auto">
            {collapsed ? 'Show' : 'Hide'}
          </span>
        )}
      </div>
      {warning && (
        <p className="text-sm text-orange-600 dark:text-orange-400 mb-2">{warning}</p>
      )}
      {!collapsed && (
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 ml-7">
          {items.map((item, i) => (
            <li key={i}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Files created**: `packages/frontend/src/components/community/ModSyncDialog.tsx`

---

## Phase 9D: Frontend — Mod Download & Installation

### 9D.1: Mod download service (Tauri)

**New file**: `packages/frontend/src/services/mod-download-service.ts`

This service handles downloading mods from Modrinth CDN or the community server, verifying hashes, and installing them to the client instance.

```typescript
import { ManifestMod, ModSyncProgress } from '@mc-server-manager/shared';
import { invoke } from '@tauri-apps/api/core';
import { createHash } from 'crypto';

export class ModDownloadService {
  /**
   * Download and install mods for a client instance.
   * Downloads in parallel (concurrency limit: 5).
   * Verifies SHA-1 hash for each file.
   * Reports progress via callback.
   */
  async downloadAndInstall(
    instanceId: string,
    mods: ManifestMod[],
    onProgress: (progress: ModSyncProgress) => void
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    let completed = 0;
    const total = mods.length;

    const concurrencyLimit = 5;
    const queue = [...mods];
    const inProgress: Promise<void>[] = [];

    const processNext = async () => {
      const mod = queue.shift();
      if (!mod) return;

      onProgress({
        phase: 'downloading',
        currentMod: mod.name,
        completed,
        total,
        error: null,
      });

      try {
        // Download file
        const fileData = await this.downloadFile(mod.downloadUrl);

        // Verify hash
        onProgress({
          phase: 'verifying',
          currentMod: mod.name,
          completed,
          total,
          error: null,
        });

        const hash = this.computeSHA1(fileData);
        if (hash !== mod.fileHash) {
          throw new Error(`Hash mismatch for ${mod.name}: expected ${mod.fileHash}, got ${hash}`);
        }

        // Install to instance
        onProgress({
          phase: 'installing',
          currentMod: mod.name,
          completed,
          total,
          error: null,
        });

        await this.installMod(instanceId, mod, fileData);

        completed++;
      } catch (err) {
        errors.push(`${mod.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      // Process next in queue
      if (queue.length > 0) {
        await processNext();
      }
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrencyLimit, mods.length); i++) {
      inProgress.push(processNext());
    }

    await Promise.all(inProgress);

    onProgress({
      phase: errors.length > 0 ? 'error' : 'complete',
      currentMod: null,
      completed,
      total,
      error: errors.length > 0 ? errors.join('; ') : null,
    });

    return { success: errors.length === 0, errors };
  }

  /**
   * Download a file from a URL.
   * Uses Tauri's HTTP client for security (no CORS issues).
   */
  private async downloadFile(url: string): Promise<Uint8Array> {
    // Validate URL
    if (!this.isTrustedUrl(url)) {
      throw new Error(`Untrusted download URL: ${url}`);
    }

    // Use Tauri's HTTP client
    const response = await invoke<number[]>('download_file', { url });
    return new Uint8Array(response);
  }

  /**
   * Verify URL is from a trusted source.
   */
  private isTrustedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const trustedHosts = [
        'cdn.modrinth.com',
        'github.com',
        'raw.githubusercontent.com',
      ];

      // Also allow community server URLs (relative or same origin)
      if (url.startsWith('/api/community/')) {
        return true;
      }

      return trustedHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }

  /**
   * Compute SHA-1 hash of file data.
   */
  private computeSHA1(data: Uint8Array): string {
    const hash = createHash('sha1');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Install a mod to a client instance.
   * Calls Tauri backend to write file and update DB.
   */
  private async installMod(
    instanceId: string,
    mod: ManifestMod,
    fileData: Uint8Array
  ): Promise<void> {
    await invoke('install_mod_to_instance', {
      instanceId,
      fileName: mod.fileName,
      fileData: Array.from(fileData),
      metadata: {
        modrinthId: mod.modrinthId,
        name: mod.name,
        version: mod.version,
        fileHash: mod.fileHash,
        fileSize: mod.fileSize,
        side: mod.side,
      },
    });
  }
}

export const modDownloadService = new ModDownloadService();
```

### 9D.2: Tauri backend command (Rust)

**New file**: `src-tauri/src/commands/mod_sync.rs` (Tauri Rust backend)

```rust
use tauri::command;
use std::fs;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
pub struct ModMetadata {
    modrinth_id: Option<String>,
    name: String,
    version: String,
    file_hash: String,
    file_size: u64,
    side: String,
}

#[command]
pub async fn download_file(url: String) -> Result<Vec<u8>, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    
    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    Ok(bytes.to_vec())
}

#[command]
pub async fn install_mod_to_instance(
    instance_id: String,
    file_name: String,
    file_data: Vec<u8>,
    metadata: ModMetadata,
) -> Result<(), String> {
    // Get instance directory
    let instance_dir = get_instance_directory(&instance_id)?;
    let mods_dir = instance_dir.join("mods");
    
    // Create mods directory if it doesn't exist
    fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("Failed to create mods directory: {}", e))?;
    
    // Write file
    let file_path = mods_dir.join(&file_name);
    fs::write(&file_path, &file_data)
        .map_err(|e| format!("Failed to write mod file: {}", e))?;
    
    // Update database (call into backend service via IPC or direct DB access)
    // This depends on Epic 4's client mod management implementation
    // Placeholder:
    update_instance_mod_db(&instance_id, &metadata)?;
    
    Ok(())
}

fn get_instance_directory(instance_id: &str) -> Result<PathBuf, String> {
    // Implementation depends on Epic 3/4 instance management
    // Placeholder:
    Ok(PathBuf::from(format!("/path/to/instances/{}", instance_id)))
}

fn update_instance_mod_db(instance_id: &str, metadata: &ModMetadata) -> Result<(), String> {
    // Call backend service or update SQLite directly
    // Placeholder:
    Ok(())
}
```

**Files created**: `packages/frontend/src/services/mod-download-service.ts`, `src-tauri/src/commands/mod_sync.rs`
**Files modified**: `src-tauri/src/main.rs` (register Tauri commands)

---

## Phase 9E: Frontend — Join Flow Integration

### 9E.1: Modify SharedServerCard component

**Modified file**: `packages/frontend/src/components/community/SharedServerCard.tsx` (from Epic 7)

Update the "Join" button to trigger mod sync:

```tsx
import { useState } from 'react';
import { SharedServer } from '@mc-server-manager/shared';
import { ModSyncDialog } from './ModSyncDialog';
import { modSyncService } from '../../services/mod-sync-service';
import { modDownloadService } from '../../services/mod-download-service';
import { useClientInstances } from '../../stores/instanceStore'; // From Epic 4

export function SharedServerCard({ server }: { server: SharedServer }) {
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [manifest, setManifest] = useState<ServerModManifest | null>(null);
  const [diff, setDiff] = useState<ModSyncDiff | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<ModSyncProgress | null>(null);

  const instances = useClientInstances();
  const targetInstance = instances.find(i => i.mcVersion === server.mcVersion);

  const handleJoinClick = async () => {
    if (!targetInstance) {
      toast.error('No compatible client instance found');
      return;
    }

    // Fetch manifest
    const manifest = await api.get<ServerModManifest>(
      `/api/community/servers/${server.id}/mod-manifest`
    );
    setManifest(manifest);

    // Fetch local mods
    const localMods = await api.get<InstalledMod[]>(
      `/api/instances/${targetInstance.id}/mods`
    );

    // Compute diff
    const diff = modSyncService.computeDiff(manifest, localMods);
    setDiff(diff);

    // Show dialog if changes needed
    const hasChanges = diff.toInstall.length > 0 || diff.toUpdate.length > 0 ||
                       diff.toRemove.length > 0 || diff.toDisable.length > 0;
    if (hasChanges) {
      setShowSyncDialog(true);
    } else {
      // No changes — launch directly
      await launchAndConnect(targetInstance.id, server);
    }
  };

  const handleSyncConfirm = async () => {
    if (!manifest || !diff || !targetInstance) return;

    setShowSyncDialog(false);
    setSyncing(true);

    try {
      // Download and install mods
      const modsToDownload = [...diff.toInstall, ...diff.toUpdate.map(u => u.target)];
      const result = await modDownloadService.downloadAndInstall(
        targetInstance.id,
        modsToDownload,
        setProgress
      );

      if (!result.success) {
        toast.error(`Mod sync failed: ${result.errors.join(', ')}`);
        return;
      }

      // Disable incompatible mods
      for (const mod of diff.toDisable) {
        await api.patch(`/api/instances/${targetInstance.id}/mods/${mod.id}`, {
          enabled: false,
        });
      }

      // Launch and connect
      await launchAndConnect(targetInstance.id, server);
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  const launchAndConnect = async (instanceId: string, server: SharedServer) => {
    // Launch Minecraft (Epic 3)
    await invoke('launch_minecraft', {
      instanceId,
      serverAddress: `${server.host}:${server.port}`,
    });
  };

  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-semibold">{server.name}</h3>
      <p className="text-sm text-gray-600">{server.description}</p>
      <button
        onClick={handleJoinClick}
        disabled={syncing}
        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {syncing ? 'Syncing...' : 'Join'}
      </button>

      {showSyncDialog && manifest && diff && (
        <ModSyncDialog
          manifest={manifest}
          diff={diff}
          onConfirm={handleSyncConfirm}
          onCancel={() => setShowSyncDialog(false)}
        />
      )}

      {syncing && progress && (
        <ModSyncProgressDialog progress={progress} />
      )}
    </div>
  );
}
```

### 9E.2: ModSyncProgressDialog component

**New file**: `packages/frontend/src/components/community/ModSyncProgressDialog.tsx`

Shows download/install progress:

```tsx
import { ModSyncProgress } from '@mc-server-manager/shared';
import { Loader2 } from 'lucide-react';

export function ModSyncProgressDialog({ progress }: { progress: ModSyncProgress }) {
  const percentage = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <h3 className="text-lg font-semibold">Syncing Mods...</h3>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 dark:text-gray-400">
                {progress.phase === 'downloading' && 'Downloading'}
                {progress.phase === 'verifying' && 'Verifying'}
                {progress.phase === 'installing' && 'Installing'}
                {progress.phase === 'complete' && 'Complete'}
                {progress.phase === 'error' && 'Error'}
              </span>
              <span className="font-medium">{Math.round(percentage)}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {progress.currentMod && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {progress.currentMod} ({progress.completed + 1}/{progress.total})
            </p>
          )}

          {progress.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{progress.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Files created**: `packages/frontend/src/components/community/ModSyncProgressDialog.tsx`
**Files modified**: `packages/frontend/src/components/community/SharedServerCard.tsx`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **9A** (Manifest generation) | ~3h | Backend service + API endpoint for mod manifest |
| 2 | **9B** (Diff computation) | ~2h | Frontend service to compare manifest with local mods |
| 3 | **9C** (Sync dialog) | ~3h | UI dialog showing diff and confirmation |
| 4 | **9D** (Download & install) | ~4h | Download service + Tauri commands for file I/O |
| 5 | **9E** (Join flow integration) | ~2h | Wire sync into "Join" button, progress UI |

**Total: ~14 hours**

---

## Complete File Change Summary

### New Files (8)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/src/services/mod-manifest-service.ts` | 9A | Generate mod manifest for a server |
| `packages/frontend/src/services/mod-sync-service.ts` | 9B | Compute diff between manifest and local mods |
| `packages/frontend/src/components/community/ModSyncDialog.tsx` | 9C | Confirmation dialog showing sync changes |
| `packages/frontend/src/services/mod-download-service.ts` | 9D | Download and install mods with verification |
| `packages/frontend/src/components/community/ModSyncProgressDialog.tsx` | 9E | Progress UI during sync |
| `src-tauri/src/commands/mod_sync.rs` | 9D | Tauri commands for file download and install |

### Modified Files (4)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 9A | Add mod sync types (ServerModManifest, ModSyncDiff, etc.) |
| `packages/backend/src/routes/community.ts` | 9A | Add manifest endpoint + mod file download endpoint |
| `packages/frontend/src/components/community/SharedServerCard.tsx` | 9E | Wire sync into "Join" button |
| `src-tauri/src/main.rs` | 9D | Register mod sync Tauri commands |

---

## Security Considerations

### Download Source Validation

- **Whitelist trusted domains**: Only `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`, and the community server itself
- **Reject unknown URLs**: Throw error if download URL is not from a trusted source
- **No arbitrary code execution**: Downloaded files are JAR mods only — never executed directly by the app

### Hash Verification

- **SHA-1 verification**: Every downloaded file must match the hash in the manifest
- **Fail on mismatch**: Delete the file and report error — never install unverified files
- **Retry once**: If download fails or hash mismatches, retry once before giving up

### Path Traversal Protection

- **Validate file names**: Reject file names with `..`, `/`, or `\` characters
- **Resolve paths**: Use `path.resolve()` and verify the final path is within the instance directory
- **Tauri sandboxing**: Leverage Tauri's file system scope restrictions

### User Consent

- **Never auto-install**: Always show the sync dialog and require user confirmation
- **Clear communication**: Show exactly what will be installed, updated, or removed
- **Abort option**: User can cancel at any time before sync starts

---

## Conflict Resolution Strategies

### Missing Required Mod

**Action**: Download and install from Modrinth CDN or community server.

**User experience**: Listed in "Install X mod(s)" section of sync dialog.

### Wrong Version (Update)

**Action**: Download new version, replace old JAR, update DB record.

**User experience**: Listed in "Update X mod(s)" section with version change shown.

### Extra Client-Only Mod

**Action**: Keep it — client-only mods don't affect server compatibility.

**User experience**: Listed in "Keep X client-only mod(s)" section (collapsible).

### Extra Server-Side Mod

**Action**: Optionally disable (rename to `.jar.disabled`). Warn user.

**User experience**: Listed in "Remove X mod(s)" section with warning that they're not required by the server.

### Incompatible Mod

**Action**: Must disable before joining. Rename to `.jar.disabled`.

**User experience**: Listed in "Disable X incompatible mod(s)" section with red warning icon.

### Non-Modrinth Mod in Manifest

**Action**: Download from community server's file endpoint (`/api/community/servers/:id/mods/:hash/download`).

**User experience**: Same as Modrinth mods — user doesn't see the difference.

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Corrupted download (network error, incomplete file) | Verify SHA-1 hash. Retry once. Delete corrupt file. Show clear error to user. |
| Malicious manifest (host serves malware) | Only download from whitelisted domains. Verify hashes. Never execute downloaded files. Trust model: user trusts the community server host. |
| Large modpacks (100+ mods, 500MB+) | Parallel downloads (concurrency=5). Progress reporting. Resumable downloads (future enhancement). |

### Medium

| Risk | Mitigation |
|------|------------|
| Manifest out of sync (host updates mods after manifest generated) | Manifest includes `generatedAt` timestamp. Client can warn if manifest is stale (>1 hour old). |
| Client instance has custom mods user wants to keep | Diff categorizes mods by side. Client-only mods are preserved. User can review before confirming. |
| Download fails mid-sync | Atomic operations: only update DB after file is verified and installed. User can retry sync. |

### Low

| Risk | Mitigation |
|------|------------|
| Modrinth CDN rate limiting | Unlikely for individual users. If it happens, retry with exponential backoff. |
| Disk space exhausted during download | Check available disk space before starting (future enhancement). Show clear error if write fails. |

---

## Testing Checklist

1. **No changes**: Join a server where local mods already match → no dialog, direct launch
2. **Install required mod**: Join a server requiring Sodium → dialog shows "Install 1 mod" → confirm → downloads, verifies, installs → launches
3. **Install with dependencies**: Join a server requiring Sodium → Fabric API auto-included in install list → both installed
4. **Update mod**: Local has Sodium 0.5.0, server requires 0.6.0 → dialog shows "Update 1 mod" with version change → updates
5. **Remove extra mod**: Local has a server-side mod not in manifest → dialog shows "Remove 1 mod" with warning → disables it
6. **Disable incompatible mod**: Local has a minimap mod, server marks it incompatible → dialog shows "Disable 1 incompatible mod" → disables it
7. **Keep client-only mod**: Local has Optifine (client-only), server doesn't require it → dialog shows "Keep 1 client-only mod" → keeps it
8. **Hash mismatch**: Simulate corrupted download → sync fails with clear error → file deleted, not installed
9. **Untrusted URL**: Manifest contains download URL from `evil.com` → sync fails with security error
10. **Large modpack**: Join a server with 50+ mods → progress dialog shows download/verify/install phases → completes successfully
11. **Cancel sync**: Open sync dialog → click Cancel → no changes made, server not joined
12. **Non-Modrinth mod**: Server has a custom mod not on Modrinth → downloads from community server file endpoint → installs successfully

---

## Future Enhancements

### Resumable Downloads

If a download fails mid-sync, allow resuming from where it left off instead of restarting.

**Implementation**: Track downloaded files in a temporary manifest. On retry, skip already-downloaded files.

### Differential Updates

For large mods, download only the changed bytes instead of the entire file.

**Implementation**: Use HTTP range requests if the server supports them. Requires server-side support.

### Mod Caching

Cache downloaded mods globally (not per-instance) to avoid re-downloading the same mod for multiple instances.

**Implementation**: Shared mod cache directory with hash-based lookup. Symlink or copy to instance on install.

### Automatic Sync on Server Update

If the server's mod manifest changes while the user is connected, notify them and offer to re-sync.

**Implementation**: WebSocket event from community server when manifest changes. Client shows toast notification.

### Bandwidth Throttling

Allow users to limit download speed to avoid saturating their connection.

**Implementation**: Add throttle option to download service. Use a rate limiter (e.g., `p-throttle`).

---

## Estimated Effort

**Total: ~14 hours**

Breakdown:
- Backend (manifest generation, API endpoints): ~3 hours
- Frontend (diff computation, UI dialogs): ~5 hours
- Download service (Tauri integration, hash verification): ~4 hours
- Integration (join flow, progress UI): ~2 hours

This is the smallest epic in the plan due to heavy reuse of Epic 2 (server mods) and Epic 4 (client mods) infrastructure.
