# Epic 2 — Server Mod & Modpack Management

> **Prerequisite for**: Epic 4 (Client Mods), Epic 9 (Mod Sync)
> **Standalone value**: Discover, install, update, and manage mods and modpacks on managed Minecraft servers — all from the UI
> **Dependencies**: Epic 1 (Tauri Desktop) — loosely. Most backend work is independent of Tauri. Frontend work can run in browser during development.

---

## Executive Summary

Add full mod management to the existing server management system. Users can search Modrinth for mods, install them to any managed server, resolve dependencies, manage mod loaders (Fabric, Forge, NeoForge), and import/export modpacks in `.mrpack` format.

### Key Decisions

- **Modrinth-first**: Modrinth has the best API (open, no key required for reads, good documentation). CurseForge is deferred — its distribution restrictions make automated installation unreliable.
- **Fabric-first loader**: Fabric's meta API is clean and installation is straightforward. Forge/NeoForge follow the same patterns but with more complexity.
- **Modpack = `.mrpack`**: Modrinth's modpack format is the standard. It's a ZIP with a manifest and override files.
- **Backend-driven**: All mod operations happen on the backend (download, install, resolve). Frontend is a thin UI layer.

---

## Architecture

### Data Flow

```
Frontend (ModManager UI)
  │
  ├── GET /api/servers/:id/mods          → List installed mods
  ├── POST /api/servers/:id/mods         → Install mod(s) from Modrinth
  ├── DELETE /api/servers/:id/mods/:hash  → Remove a mod
  ├── POST /api/servers/:id/mods/update   → Check/apply updates
  │
  ├── GET /api/modrinth/search            → Proxy search to Modrinth
  ├── GET /api/modrinth/project/:id       → Proxy project details
  │
  ├── POST /api/servers/:id/modpack/import  → Import .mrpack
  ├── POST /api/servers/:id/modpack/export  → Export .mrpack
  │
  └── POST /api/servers/:id/loader        → Install/change mod loader
      
Backend
  ├── ModService         → Business logic for mod CRUD, dependency resolution
  ├── ModrinthClient     → HTTP client for Modrinth API v2
  ├── ModLoaderService   → Install/manage Fabric, Forge, NeoForge loaders
  ├── ModpackService     → Import/export .mrpack files
  └── File I/O           → Read/write server mods/ directory
```

### Database Changes

New table for tracking installed mods (the `mods/` directory is the source of truth, but the DB provides metadata and faster lookups):

```sql
-- Migration: 00X_mod_management.sql

CREATE TABLE installed_mods (
  id            TEXT PRIMARY KEY,         -- nanoid
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,            -- e.g. "sodium-fabric-0.6.0.jar"
  file_hash     TEXT NOT NULL,            -- SHA-1 of the JAR file
  file_size     INTEGER NOT NULL,         -- bytes
  modrinth_id   TEXT,                     -- Modrinth project ID (null if manually added)
  modrinth_version_id TEXT,               -- Modrinth version ID
  name          TEXT NOT NULL,            -- Display name (from Modrinth or filename)
  slug          TEXT,                     -- Modrinth slug
  version       TEXT,                     -- Mod version string
  loader        TEXT,                     -- fabric, forge, neoforge, quilt
  mc_versions   TEXT,                     -- JSON array of compatible MC versions
  side          TEXT DEFAULT 'both',      -- client, server, both
  icon_url      TEXT,                     -- Mod icon URL
  enabled       INTEGER NOT NULL DEFAULT 1, -- 0 = disabled (.disabled extension)
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, file_name)
);

CREATE INDEX idx_installed_mods_server ON installed_mods(server_id);
CREATE INDEX idx_installed_mods_hash ON installed_mods(file_hash);
```

### Shared Types

Add to `shared/src/index.ts`:

```typescript
// --- Mod Management Types ---

export interface InstalledMod {
  id: string;
  serverId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  modrinthId: string | null;
  modrinthVersionId: string | null;
  name: string;
  slug: string | null;
  version: string | null;
  loader: string | null;
  mcVersions: string[];
  side: 'client' | 'server' | 'both';
  iconUrl: string | null;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface ModSearchResult {
  slug: string;
  title: string;
  description: string;
  projectId: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  categories: string[];
  clientSide: 'required' | 'optional' | 'unsupported';
  serverSide: 'required' | 'optional' | 'unsupported';
  versions: string[];      // Compatible MC versions
  loaders: string[];       // Compatible loaders
  dateModified: string;
}

export interface ModVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  changelog: string | null;
  gameVersions: string[];
  loaders: string[];
  versionType: 'release' | 'beta' | 'alpha';
  featured: boolean;
  dependencies: ModDependency[];
  files: ModFile[];
  datePublished: string;
  downloads: number;
}

export interface ModDependency {
  projectId: string;
  versionId: string | null;
  dependencyType: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface ModFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  hashes: {
    sha1: string;
    sha512: string;
  };
}

export interface InstallModRequest {
  modrinthVersionId: string;
  /** If true, also install required dependencies */
  installDependencies?: boolean;
}

export interface ModUpdateInfo {
  modId: string;
  currentVersion: string;
  latestVersion: ModVersion;
  hasUpdate: boolean;
}

export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';

export interface InstallLoaderRequest {
  loader: ModLoader;
  loaderVersion?: string;   // Defaults to latest stable
}

export interface ModpackExportRequest {
  name: string;
  versionId: string;
  summary?: string;
}
```

---

## Phase 2A: Modrinth API Client

### 2A.1: HTTP client for Modrinth

**New file**: `packages/backend/src/services/modrinth-client.ts`

```typescript
import { ModSearchResult, ModVersion } from '@mc-server-manager/shared';

const BASE_URL = 'https://api.modrinth.com/v2';
const USER_AGENT = 'mc-server-manager/0.1.0 (https://github.com/your-repo)';

export class ModrinthClient {
  private async fetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Modrinth API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as T;
  }

  /** Search for mods/modpacks on Modrinth */
  async search(params: {
    query: string;
    facets?: string[][];
    index?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';
    offset?: number;
    limit?: number;
  }): Promise<{ hits: ModSearchResult[]; totalHits: number; offset: number; limit: number }>;

  /** Get project details */
  async getProject(idOrSlug: string): Promise<ModrinthProject>;

  /** List versions for a project, filtered by loader and game version */
  async getProjectVersions(
    idOrSlug: string,
    loaders?: string[],
    gameVersions?: string[]
  ): Promise<ModVersion[]>;

  /** Get a specific version */
  async getVersion(versionId: string): Promise<ModVersion>;

  /** Get multiple projects by ID */
  async getProjects(ids: string[]): Promise<ModrinthProject[]>;

  /** Identify a mod by its file hash (SHA-1) */
  async getVersionByHash(sha1: string): Promise<ModVersion | null>;

  /** Check for updates for multiple mods */
  async getLatestVersionsFromHashes(
    hashes: string[],
    loaders: string[],
    gameVersions: string[]
  ): Promise<Record<string, ModVersion>>;
}
```

### 2A.2: Modrinth proxy routes

**New file**: `packages/backend/src/routes/modrinth.ts`

The frontend doesn't call Modrinth directly — the backend proxies requests. This avoids CORS issues in Tauri's WebView and allows server-side caching.

```
GET  /api/modrinth/search?q=sodium&loader=fabric&mcVersion=1.21.4&limit=20
GET  /api/modrinth/project/:idOrSlug
GET  /api/modrinth/project/:idOrSlug/versions?loader=fabric&mcVersion=1.21.4
GET  /api/modrinth/version/:versionId
```

Apply response caching (5-minute TTL) using the `TTLCache` utility from PHASE2_PLAN.

**Files created**: `packages/backend/src/services/modrinth-client.ts`, `packages/backend/src/routes/modrinth.ts`
**Files modified**: `packages/backend/src/app.ts` (mount modrinth routes)

---

## Phase 2B: Mod Service & Database Layer

### 2B.1: Mod model

**New file**: `packages/backend/src/models/mod.ts`

```typescript
export interface ModModel {
  getByServerId(serverId: string): InstalledMod[];
  getByHash(serverId: string, hash: string): InstalledMod | null;
  create(mod: Omit<InstalledMod, 'id' | 'installedAt' | 'updatedAt'>): InstalledMod;
  update(id: string, updates: Partial<InstalledMod>): InstalledMod;
  delete(id: string): void;
  deleteByServerId(serverId: string): void;
}
```

### 2B.2: Mod service

**New file**: `packages/backend/src/services/mod-service.ts`

Core business logic:

```typescript
export class ModService {
  constructor(
    private modModel: ModModel,
    private modrinthClient: ModrinthClient,
    private modLoaderService: ModLoaderService
  ) {}

  /** List all mods installed on a server */
  async listMods(serverId: string): Promise<InstalledMod[]>;

  /** 
   * Install a mod from Modrinth.
   * 1. Fetch version details from Modrinth
   * 2. Resolve required dependencies (recursive)
   * 3. Download all JARs to server's mods/ directory
   * 4. Verify hashes
   * 5. Record in database
   * Returns list of all installed mods (including dependencies)
   */
  async installMod(serverId: string, request: InstallModRequest): Promise<InstalledMod[]>;

  /**
   * Remove a mod from a server.
   * 1. Delete JAR from mods/ directory
   * 2. Remove from database
   * 3. Warn if other mods depend on it
   */
  async removeMod(serverId: string, modId: string): Promise<{ removed: InstalledMod; dependents: string[] }>;

  /**
   * Enable/disable a mod (rename .jar ↔ .jar.disabled)
   */
  async toggleMod(serverId: string, modId: string, enabled: boolean): Promise<InstalledMod>;

  /**
   * Check for updates for all mods on a server.
   * Uses Modrinth's batch hash lookup.
   */
  async checkUpdates(serverId: string): Promise<ModUpdateInfo[]>;

  /**
   * Apply updates: download new versions, replace old JARs, update DB.
   */
  async applyUpdates(serverId: string, modIds: string[]): Promise<InstalledMod[]>;

  /**
   * Scan the mods/ directory and reconcile with database.
   * Identifies: manually added mods, deleted mods, hash mismatches.
   * For unknown JARs, attempts identification via Modrinth hash lookup.
   */
  async syncModsDirectory(serverId: string): Promise<{
    added: InstalledMod[];
    removed: string[];
    identified: InstalledMod[];
    unknown: string[];
  }>;
}
```

### 2B.3: Dependency resolution

The dependency resolver is the most complex piece. It must handle:
- **Required** dependencies: auto-install
- **Optional** dependencies: present to user
- **Incompatible** dependencies: block installation with clear error
- **Transitive** dependencies: recursively resolve (up to 5 levels deep, then error)
- **Circular** dependencies: detect and break cycles
- **Already installed**: skip if compatible version exists

```typescript
// In mod-service.ts

interface ResolvedDependency {
  projectId: string;
  version: ModVersion;
  type: 'required' | 'optional';
  depth: number;
}

private async resolveDependencies(
  version: ModVersion,
  serverId: string,
  loader: string,
  mcVersion: string,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<{
  required: ResolvedDependency[];
  optional: ResolvedDependency[];
  incompatible: string[];
}> {
  if (depth > 5) throw new Error('Dependency chain too deep (>5 levels)');

  const result = { required: [], optional: [], incompatible: [] };
  const installedMods = this.modModel.getByServerId(serverId);

  for (const dep of version.dependencies) {
    if (visited.has(dep.projectId)) continue; // Cycle detection
    visited.add(dep.projectId);

    if (dep.dependencyType === 'incompatible') {
      const installed = installedMods.find(m => m.modrinthId === dep.projectId);
      if (installed) {
        result.incompatible.push(installed.name);
      }
      continue;
    }

    // Skip if already installed
    const existing = installedMods.find(m => m.modrinthId === dep.projectId);
    if (existing) continue;

    // Fetch the best version for this dependency
    const depVersion = dep.versionId
      ? await this.modrinthClient.getVersion(dep.versionId)
      : await this.findBestVersion(dep.projectId, loader, mcVersion);

    if (!depVersion) continue;

    const resolved: ResolvedDependency = {
      projectId: dep.projectId,
      version: depVersion,
      type: dep.dependencyType as 'required' | 'optional',
      depth,
    };

    if (dep.dependencyType === 'required') {
      result.required.push(resolved);
      // Recurse for required deps' dependencies
      const subDeps = await this.resolveDependencies(
        depVersion, serverId, loader, mcVersion, depth + 1, visited
      );
      result.required.push(...subDeps.required);
      result.optional.push(...subDeps.optional);
      result.incompatible.push(...subDeps.incompatible);
    } else if (dep.dependencyType === 'optional') {
      result.optional.push(resolved);
    }
  }

  return result;
}
```

**Files created**: `packages/backend/src/models/mod.ts`, `packages/backend/src/services/mod-service.ts`
**Files modified**: `packages/backend/migrations/` (new migration file)

---

## Phase 2C: Mod Loader Installation

### 2C.1: Mod loader service

**New file**: `packages/backend/src/services/mod-loader-service.ts`

This service handles installing and managing mod loaders on servers. It extends the existing provider system from PHASE2_PLAN.

```typescript
export class ModLoaderService {
  /**
   * Install a mod loader on a server.
   * - For Fabric: uses Fabric Meta API to download server launcher
   * - For Forge: uses the Forge installer (Phase 3 from PHASE2_PLAN)
   * - Updates server record with new jarPath and type
   */
  async installLoader(
    serverId: string,
    loader: ModLoader,
    mcVersion: string,
    loaderVersion?: string
  ): Promise<void>;

  /** Get available loader versions for a Minecraft version */
  async getLoaderVersions(loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]>;

  /** Detect if a mod loader is installed by scanning the server directory */
  async detectLoader(serverId: string): Promise<{
    loader: ModLoader | null;
    version: string | null;
  }>;

  /** Remove a mod loader, reverting to vanilla */
  async removeLoader(serverId: string): Promise<void>;
}
```

### 2C.2: Fabric server-side installation

Fabric is the simplest loader to install on a server:

1. Fetch loader versions: `GET https://meta.fabricmc.net/v2/versions/loader/{mcVersion}`
2. Download server launcher JAR: `GET https://meta.fabricmc.net/v2/versions/loader/{mcVersion}/{loaderVersion}/{installerVersion}/server/jar`
3. Save as `fabric-server-launch.jar` in the server directory
4. Update the server's `jarPath` to point to the new JAR
5. The existing Fabric provider (from PHASE2_PLAN) handles launching

### 2C.3: Loader routes

```
POST   /api/servers/:id/loader          → Install mod loader
GET    /api/servers/:id/loader          → Get current loader info
DELETE /api/servers/:id/loader          → Remove mod loader (revert to vanilla)
GET    /api/loaders/:type/versions?mcVersion=1.21.4  → Available loader versions
```

**Files created**: `packages/backend/src/services/mod-loader-service.ts`
**Files modified**: `packages/backend/src/routes/servers.ts` or new `packages/backend/src/routes/mods.ts`

---

## Phase 2D: Mod CRUD Routes

### 2D.1: Mod management routes

**New file**: `packages/backend/src/routes/mods.ts`

```
GET    /api/servers/:id/mods                    → List installed mods
POST   /api/servers/:id/mods                    → Install mod from Modrinth
DELETE /api/servers/:id/mods/:modId             → Remove mod
PATCH  /api/servers/:id/mods/:modId             → Toggle enable/disable
POST   /api/servers/:id/mods/sync               → Sync mods directory with DB
POST   /api/servers/:id/mods/check-updates      → Check for available updates
POST   /api/servers/:id/mods/apply-updates      → Apply selected updates
```

### 2D.2: Request validation (Zod)

```typescript
export const installModSchema = z.object({
  modrinthVersionId: z.string().min(1),
  installDependencies: z.boolean().optional().default(true),
});

export const toggleModSchema = z.object({
  enabled: z.boolean(),
});

export const applyUpdatesSchema = z.object({
  modIds: z.array(z.string()).min(1),
});
```

**Files created**: `packages/backend/src/routes/mods.ts`
**Files modified**: `packages/backend/src/app.ts` (mount mod routes)

---

## Phase 2E: Modpack Import/Export

### 2E.1: Modpack service

**New file**: `packages/backend/src/services/modpack-service.ts`

#### Import `.mrpack`

1. **Parse**: Unzip the `.mrpack`, read `modrinth.index.json`
2. **Validate**: Check `formatVersion === 1`, `game === "minecraft"`
3. **Install loader**: Read `dependencies` (e.g., `"fabric-loader": "0.16.0"`) → install via `ModLoaderService`
4. **Download mods**: Iterate `files[]`, download each from `downloads[]` URLs, verify hashes
5. **Apply overrides**: Extract `server-overrides/` (preferred) or `overrides/` to server directory
6. **Record**: Add all mods to the `installed_mods` table
7. **Identify**: Use Modrinth hash lookup to populate metadata for each mod

```typescript
export class ModpackService {
  async importModpack(
    serverId: string,
    mrpackPath: string,
    options?: { overwriteExisting?: boolean }
  ): Promise<{
    modsInstalled: number;
    overridesApplied: number;
    loaderInstalled: string | null;
    warnings: string[];
  }>;

  async exportModpack(
    serverId: string,
    request: ModpackExportRequest
  ): Promise<string>; // Returns path to generated .mrpack
}
```

#### Export `.mrpack`

1. **Gather mods**: Read all installed mods from DB
2. **Build manifest**: For each mod with a Modrinth ID, add to `files[]` with download URLs and hashes
3. **Handle non-Modrinth mods**: Add to `overrides/mods/` (they'll be embedded in the ZIP)
4. **Include config overrides**: Optionally include `server.properties`, `config/` directory as overrides
5. **Package**: Create ZIP with `modrinth.index.json` + `overrides/`

### 2E.2: Modpack routes

```
POST /api/servers/:id/modpack/import    → Upload and import .mrpack
     Content-Type: multipart/form-data
     Body: file (the .mrpack file)

POST /api/servers/:id/modpack/export    → Export server as .mrpack
     Body: { name, versionId, summary? }
     Response: Binary .mrpack file download
```

**Files created**: `packages/backend/src/services/modpack-service.ts`
**Files modified**: `packages/backend/src/routes/mods.ts` (add modpack endpoints)

---

## Phase 2F: Frontend — Mod Manager UI

### 2F.1: Mod Manager tab in ServerDetail

Add a new **Mods** tab to the existing `ServerDetail.tsx` page.

**New components:**

| Component | Purpose |
|-----------|---------|
| `ModManagerTab.tsx` | Container for the entire mod management UI |
| `InstalledModList.tsx` | Table/list of installed mods with actions (remove, disable, update) |
| `ModSearchPanel.tsx` | Search Modrinth, browse results, install |
| `ModSearchResult.tsx` | Individual search result card |
| `ModDetailPanel.tsx` | Expanded view of a mod (description, versions, dependencies) |
| `ModLoaderSetup.tsx` | Install/change mod loader (shown if no loader detected) |
| `ModpackImportExport.tsx` | Import/export .mrpack UI |
| `DependencyDialog.tsx` | Confirmation dialog showing dependencies to be installed |
| `UpdatesPanel.tsx` | Available updates list with apply button |

### 2F.2: ModManagerTab layout

```
┌──────────────────────────────────────────────────────┐
│ Mods Tab                                             │
│                                                      │
│ ┌─ Loader Info Bar ─────────────────────────────────┐│
│ │ Fabric 0.16.0 for MC 1.21.4  [Change] [Remove]  ││
│ │ — OR —                                            ││
│ │ No mod loader installed. [Install Fabric] [Forge] ││
│ └───────────────────────────────────────────────────┘│
│                                                      │
│ ┌─ Toolbar ─────────────────────────────────────────┐│
│ │ [Search Mods] [Check Updates (3)] [Import] [Export]│
│ └───────────────────────────────────────────────────┘│
│                                                      │
│ ┌─ Installed Mods ──────────────────────────────────┐│
│ │ Icon | Name        | Version | Size  | Actions    ││
│ │ ─────┼─────────────┼─────────┼───────┼──────────  ││
│ │  🧊  │ Sodium      │ 0.6.0   │ 1.2MB │ ⏸ 🗑 ↑   ││
│ │  🌿  │ Fabric API  │ 0.100.8 │ 2.4MB │ ⏸ 🗑 ↑   ││
│ │  📦  │ Lithium     │ 0.13.1  │ 0.5MB │ ⏸ 🗑     ││
│ │  ❓  │ custom.jar  │ unknown │ 0.1MB │ ⏸ 🗑     ││
│ └───────────────────────────────────────────────────┘│
│                                                      │
│ ┌─ Search Panel (overlay/drawer) ───────────────────┐│
│ │ [Search: ___________] [Loader: Fabric ▼]          ││
│ │                                                    ││
│ │  Sodium - Rendering engine for MC                  ││
│ │  ★ 5.2M downloads  [Install]                      ││
│ │                                                    ││
│ │  Lithium - Server performance optimizer            ││
│ │  ★ 3.1M downloads  [Install]                      ││
│ └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### 2F.3: Zustand store additions

Add to `serverStore.ts` or create a new `modStore.ts`:

```typescript
interface ModState {
  // Per-server mod data
  modsByServer: Record<string, InstalledMod[]>;
  searchResults: ModSearchResult[];
  searchLoading: boolean;

  // Actions
  fetchMods: (serverId: string) => Promise<void>;
  searchMods: (query: string, serverId: string) => Promise<void>;
  installMod: (serverId: string, versionId: string) => Promise<void>;
  removeMod: (serverId: string, modId: string) => Promise<void>;
  toggleMod: (serverId: string, modId: string, enabled: boolean) => Promise<void>;
  checkUpdates: (serverId: string) => Promise<ModUpdateInfo[]>;
  applyUpdates: (serverId: string, modIds: string[]) => Promise<void>;
}
```

### 2F.4: Dependency confirmation dialog

When installing a mod with dependencies, show a confirmation:

```
┌─ Install Sodium? ───────────────────┐
│                                     │
│  Sodium requires:                   │
│  ✅ Fabric API (will be installed)  │
│                                     │
│  Optional:                          │
│  ☐ Indium (adds Fabric Rendering   │
│    API support)                     │
│                                     │
│  [Cancel]  [Install 2 mods]        │
└─────────────────────────────────────┘
```

**Files created**: `packages/frontend/src/components/mods/ModManagerTab.tsx`, `InstalledModList.tsx`, `ModSearchPanel.tsx`, `ModSearchResult.tsx`, `ModDetailPanel.tsx`, `ModLoaderSetup.tsx`, `ModpackImportExport.tsx`, `DependencyDialog.tsx`, `UpdatesPanel.tsx`
**Files modified**: `packages/frontend/src/pages/ServerDetail.tsx` (add Mods tab), `packages/frontend/src/stores/` (new mod store or extend server store), `packages/frontend/src/api/client.ts` (mod API methods)

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **2A** (Modrinth client) | ~3h | Modrinth API client + proxy routes |
| 2 | **2B** (Mod service + DB) | ~5h | Mod CRUD, dependency resolution, DB migration |
| 3 | **2C** (Mod loader install) | ~4h | Fabric installer, loader management routes |
| 4 | **2D** (Mod CRUD routes) | ~3h | REST endpoints for mod management |
| 5 | **2E** (Modpack import/export) | ~5h | .mrpack parsing, generation, file handling |
| 6 | **2F** (Frontend UI) | ~8h | Full mod manager UI with search, install, update |

**Total: ~28 hours**

---

## Complete File Change Summary

### New Files (15+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/src/services/modrinth-client.ts` | 2A | Modrinth API v2 HTTP client |
| `packages/backend/src/routes/modrinth.ts` | 2A | Modrinth proxy routes |
| `packages/backend/src/models/mod.ts` | 2B | Installed mod DB model |
| `packages/backend/src/services/mod-service.ts` | 2B | Mod CRUD + dependency resolution |
| `packages/backend/src/services/mod-loader-service.ts` | 2C | Mod loader installation |
| `packages/backend/src/routes/mods.ts` | 2D | Mod management REST routes |
| `packages/backend/src/services/modpack-service.ts` | 2E | Modpack import/export |
| `packages/backend/migrations/00X_mod_management.sql` | 2B | installed_mods table |
| `packages/frontend/src/components/mods/ModManagerTab.tsx` | 2F | Main mod management container |
| `packages/frontend/src/components/mods/InstalledModList.tsx` | 2F | Installed mods table |
| `packages/frontend/src/components/mods/ModSearchPanel.tsx` | 2F | Modrinth search UI |
| `packages/frontend/src/components/mods/ModSearchResult.tsx` | 2F | Search result card |
| `packages/frontend/src/components/mods/ModDetailPanel.tsx` | 2F | Mod detail view |
| `packages/frontend/src/components/mods/ModLoaderSetup.tsx` | 2F | Loader install UI |
| `packages/frontend/src/components/mods/ModpackImportExport.tsx` | 2F | Import/export UI |
| `packages/frontend/src/components/mods/DependencyDialog.tsx` | 2F | Dependency confirmation |
| `packages/frontend/src/components/mods/UpdatesPanel.tsx` | 2F | Update checker UI |

### Modified Files (6)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 2B | Mod management types |
| `packages/backend/src/app.ts` | 2A, 2D | Mount modrinth + mod routes |
| `packages/frontend/src/pages/ServerDetail.tsx` | 2F | Add Mods tab |
| `packages/frontend/src/api/client.ts` | 2F | Mod API + Modrinth proxy methods |
| `packages/frontend/src/stores/serverStore.ts` | 2F | Mod state (or new store) |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Modrinth rate limiting (undocumented) | Cache aggressively (5-min TTL for searches, 1-hour for project details). Implement exponential backoff. Batch hash lookups instead of per-mod requests. |
| Dependency resolution infinite loops | Cycle detection via `visited` set. Max depth of 5. Timeout after 30 seconds. |
| Mod file corrupted during download | Verify SHA-1 hash after download. Retry once. Delete corrupt file. |

### Medium

| Risk | Mitigation |
|------|------------|
| Mods directory diverges from DB | `syncModsDirectory` reconciliation on every load. DB is secondary — filesystem is source of truth. |
| Forge/NeoForge loader installation complexity | Fabric is primary. Forge deferred until PHASE2_PLAN Phase 3 is implemented. NeoForge follows same pattern. |
| Large modpacks (100+ mods) | Parallel downloads (concurrency limit: 5). Progress reporting via WebSocket. Download queue with retry. |
| `.mrpack` with non-Modrinth download URLs | Support `github.com` and `raw.githubusercontent.com` URLs per spec. Reject unknown domains. |

### Low

| Risk | Mitigation |
|------|------------|
| CurseForge mods in imported modpacks | `.mrpack` files from Modrinth won't include CF-only mods. Warn user if any files fail to download. |
| Mod conflicts (incompatible mods installed) | Check `incompatible` dependency type before install. Warn but don't block — user may know better. |

---

## Testing Checklist

1. **Search**: Search for "sodium" → see results with icons, download counts, descriptions
2. **Install**: Install Sodium → Fabric API auto-installs as dependency → both appear in installed list
3. **Dependency dialog**: Shows required and optional deps before confirming install
4. **Remove**: Remove Fabric API → warns that Sodium depends on it → proceeds if confirmed
5. **Toggle**: Disable a mod → file renamed to `.jar.disabled` → re-enable restores `.jar`
6. **Updates**: Install old version → check updates → update available → apply → new version installed
7. **Manual mod**: Drop a JAR into `mods/` manually → sync picks it up → attempts Modrinth identification
8. **Modpack import**: Import a `.mrpack` → loader installed, all mods downloaded, overrides applied
9. **Modpack export**: Export server as `.mrpack` → import into a new server → identical mod setup
10. **Loader install**: Install Fabric on a vanilla server → server type changes → server starts with Fabric
11. **Server must be stopped**: Mod operations blocked while server is running (except viewing)
