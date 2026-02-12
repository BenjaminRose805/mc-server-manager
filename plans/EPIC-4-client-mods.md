# Epic 4 — Client Mod Management

> **Prerequisite for**: Epic 9 (Mod Sync)
> **Standalone value**: Install, update, and manage mods on local Minecraft client instances — same interface as server mods
> **Dependencies**: Epic 2 (Server Mods) for Modrinth client and mod services, Epic 3 (Client Launcher) for instance management

---

## Executive Summary

Extend the mod management system (Epic 2) to work with client instances (Epic 3). Users can search Modrinth for client-side mods, install them to any managed instance, resolve dependencies, manage mod loaders (Fabric, Forge, NeoForge), and import/export modpacks in `.mrpack` format — all from the same UI they use for server mods.

### Key Decisions

- **Reuse Epic 2 infrastructure**: The existing ModrinthClient, dependency resolver, and modpack parser are generalized to work with both servers and instances. No duplication.
- **ModTarget abstraction**: A common interface abstracts the difference between server and instance mod directories. Services operate on ModTarget, not directly on servers or instances.
- **Client-side filtering**: Mods are filtered by `client_side: required|optional` from Modrinth. Server-only mods are hidden in instance mod search.
- **Fabric client profile installation**: Client mod loaders are installed differently than server loaders. Fabric client installation downloads a version JSON and libraries, not a server launcher JAR.
- **Resource packs and shader packs**: Stretch goal for Phase 4D. The architecture supports them, but they're deferred until core mod management is proven.

---

## Architecture

### Data Flow

```
Frontend (Instance Detail → Mods Tab)
  │
  ├── GET /api/instances/:id/mods          → List installed mods
  ├── POST /api/instances/:id/mods         → Install mod(s) from Modrinth
  ├── DELETE /api/instances/:id/mods/:hash  → Remove a mod
  ├── POST /api/instances/:id/mods/update   → Check/apply updates
  │
  ├── GET /api/modrinth/search?side=client  → Proxy search (client-side filter)
  ├── GET /api/modrinth/project/:id         → Proxy project details
  │
  ├── POST /api/instances/:id/modpack/import  → Import .mrpack
  ├── POST /api/instances/:id/modpack/export  → Export .mrpack
  │
  └── POST /api/instances/:id/loader        → Install/change mod loader

Backend
  ├── ModService (generalized)    → Works with ModTarget (server OR instance)
  ├── ModrinthClient (unchanged)  → Already exists from Epic 2
  ├── ModLoaderService (extended) → Add client loader installation
  ├── ModpackService (generalized)→ Works with ModTarget
  └── File I/O                    → Read/write instance mods/ directory
```

### ModTarget Abstraction

The core insight: servers and instances are nearly identical from a mod management perspective. Both have:
- A mods directory
- A Minecraft version
- A mod loader (or none)
- A loader version

**New interface** (add to `shared/src/index.ts`):

```typescript
export interface ModTarget {
  type: 'server' | 'instance';
  id: string;
  modsDir: string;           // Absolute path to mods/ directory
  mcVersion: string;
  loader: ModLoader | null;
  loaderVersion: string | null;
}
```

**Conversion helpers** (add to backend services):

```typescript
// In packages/backend/src/services/mod-service.ts

function serverToModTarget(server: Server): ModTarget {
  return {
    type: 'server',
    id: server.id,
    modsDir: path.join(server.path, 'mods'),
    mcVersion: server.version,
    loader: detectServerLoader(server),
    loaderVersion: detectServerLoaderVersion(server),
  };
}

function instanceToModTarget(instance: Instance): ModTarget {
  return {
    type: 'instance',
    id: instance.id,
    modsDir: path.join(instance.gameDir, 'mods'),
    mcVersion: instance.version,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
  };
}
```

### Database Changes

Extend the `installed_mods` table from Epic 2 to support both servers and instances:

```sql
-- Migration: 00X_client_mods.sql

-- Add instance_id column (nullable, mutually exclusive with server_id)
ALTER TABLE installed_mods ADD COLUMN instance_id TEXT REFERENCES instances(id) ON DELETE CASCADE;

-- Add check constraint: exactly one of server_id or instance_id must be set
-- SQLite doesn't support CHECK constraints on existing tables, so recreate:

CREATE TABLE installed_mods_new (
  id            TEXT PRIMARY KEY,
  server_id     TEXT REFERENCES servers(id) ON DELETE CASCADE,
  instance_id   TEXT REFERENCES instances(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  file_size     INTEGER NOT NULL,
  modrinth_id   TEXT,
  modrinth_version_id TEXT,
  name          TEXT NOT NULL,
  slug          TEXT,
  version       TEXT,
  loader        TEXT,
  mc_versions   TEXT,
  side          TEXT DEFAULT 'both',
  icon_url      TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((server_id IS NOT NULL AND instance_id IS NULL) OR (server_id IS NULL AND instance_id IS NOT NULL)),
  UNIQUE(server_id, file_name),
  UNIQUE(instance_id, file_name)
);

-- Copy data from old table
INSERT INTO installed_mods_new SELECT *, NULL FROM installed_mods;

-- Drop old table and rename
DROP TABLE installed_mods;
ALTER TABLE installed_mods_new RENAME TO installed_mods;

-- Recreate indexes
CREATE INDEX idx_installed_mods_server ON installed_mods(server_id);
CREATE INDEX idx_installed_mods_instance ON installed_mods(instance_id);
CREATE INDEX idx_installed_mods_hash ON installed_mods(file_hash);
```

### Shared Types

Add to `shared/src/index.ts`:

```typescript
// --- Client Mod Management Types ---

// ModTarget is defined above in Architecture section

// Extend InstalledMod to support instances
export interface InstalledMod {
  id: string;
  serverId: string | null;      // Changed from non-null
  instanceId: string | null;    // NEW
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

// Client loader installation differs from server
export interface InstallClientLoaderRequest {
  loader: ModLoader;
  loaderVersion?: string;   // Defaults to latest stable
}

// Resource pack and shader pack types (Phase 4D)
export interface ResourcePack {
  id: string;
  instanceId: string;
  fileName: string;
  name: string;
  description: string | null;
  format: number;           // pack_format from pack.mcmeta
  iconUrl: string | null;
  enabled: boolean;
}

export interface ShaderPack {
  id: string;
  instanceId: string;
  folderName: string;
  name: string;
  enabled: boolean;
}
```

---

## Phase 4A: Generalize ModService for ModTarget

### 4A.1: Refactor ModService to use ModTarget

The existing ModService from Epic 2 operates on `serverId: string`. Refactor all methods to accept `target: ModTarget` instead.

**Before** (Epic 2):
```typescript
async installMod(serverId: string, request: InstallModRequest): Promise<InstalledMod[]>
```

**After** (Epic 4):
```typescript
async installMod(target: ModTarget, request: InstallModRequest): Promise<InstalledMod[]>
```

**Changes required**:
- Replace all `serverId` parameters with `target: ModTarget`
- Replace `path.join(server.path, 'mods')` with `target.modsDir`
- Replace `server.version` with `target.mcVersion`
- Replace `server.loader` with `target.loader`
- Update database queries to use `server_id` or `instance_id` based on `target.type`

**Example refactor** (dependency resolution):

```typescript
// Before
private async resolveDependencies(
  version: ModVersion,
  serverId: string,
  loader: string,
  mcVersion: string,
  // ...
): Promise<ResolvedDependencies> {
  const installedMods = this.modModel.getByServerId(serverId);
  // ...
}

// After
private async resolveDependencies(
  version: ModVersion,
  target: ModTarget,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<ResolvedDependencies> {
  const installedMods = target.type === 'server'
    ? this.modModel.getByServerId(target.id)
    : this.modModel.getByInstanceId(target.id);
  // ...
}
```

### 4A.2: Update ModModel for instance support

Add instance-specific queries to `packages/backend/src/models/mod.ts`:

```typescript
export interface ModModel {
  // Existing server methods
  getByServerId(serverId: string): InstalledMod[];
  
  // NEW: Instance methods
  getByInstanceId(instanceId: string): InstalledMod[];
  
  // Generalized methods
  getByHash(targetType: 'server' | 'instance', targetId: string, hash: string): InstalledMod | null;
  create(mod: Omit<InstalledMod, 'id' | 'installedAt' | 'updatedAt'>): InstalledMod;
  update(id: string, updates: Partial<InstalledMod>): InstalledMod;
  delete(id: string): void;
  deleteByServerId(serverId: string): void;
  deleteByInstanceId(instanceId: string): void;  // NEW
}
```

### 4A.3: Generalize ModpackService

The ModpackService from Epic 2 also operates on servers. Refactor to use ModTarget:

```typescript
export class ModpackService {
  async importModpack(
    target: ModTarget,
    mrpackPath: string,
    options?: { overwriteExisting?: boolean }
  ): Promise<{
    modsInstalled: number;
    overridesApplied: number;
    loaderInstalled: string | null;
    warnings: string[];
  }>;

  async exportModpack(
    target: ModTarget,
    request: ModpackExportRequest
  ): Promise<string>; // Returns path to generated .mrpack
}
```

**Key difference for client modpacks**: The `overrides/` directory in a `.mrpack` should be applied to the instance's `.minecraft/` directory, not the root directory. Server modpacks use `server-overrides/` or `overrides/` → server root. Client modpacks use `overrides/` → `.minecraft/`.

**Files modified**: `packages/backend/src/services/mod-service.ts`, `packages/backend/src/services/modpack-service.ts`, `packages/backend/src/models/mod.ts`

---

## Phase 4B: Client Mod Loader Installation

### 4B.1: Fabric client profile installation

Client mod loaders are installed differently than server loaders. For Fabric:

**Server** (Epic 2): Download `fabric-server-launch.jar`, update server's `jarPath`

**Client** (Epic 4): Download Fabric's version JSON and libraries, add to instance's version directory

**Fabric client installation steps**:

1. Fetch loader versions: `GET https://meta.fabricmc.net/v2/versions/loader/{mcVersion}`
2. Download profile JSON: `GET https://meta.fabricmc.net/v2/versions/loader/{mcVersion}/{loaderVersion}/profile/json`
3. Parse the profile JSON — it contains:
   - `id`: The version ID (e.g., `"fabric-loader-0.16.0-1.21.4"`)
   - `inheritsFrom`: The base Minecraft version (e.g., `"1.21.4"`)
   - `libraries[]`: Array of library dependencies
   - `mainClass`: Fabric's main class
4. Save the profile JSON to `{instanceDir}/versions/{id}/{id}.json`
5. Download all libraries from `libraries[]` to `{instanceDir}/libraries/` (shared across instances)
6. Update the instance record: `loader = 'fabric'`, `loaderVersion = '0.16.0'`, `versionId = 'fabric-loader-0.16.0-1.21.4'`

**Example profile JSON structure**:

```json
{
  "id": "fabric-loader-0.16.0-1.21.4",
  "inheritsFrom": "1.21.4",
  "releaseTime": "2024-12-01T00:00:00+00:00",
  "time": "2024-12-01T00:00:00+00:00",
  "type": "release",
  "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
  "libraries": [
    {
      "name": "net.fabricmc:fabric-loader:0.16.0",
      "url": "https://maven.fabricmc.net/"
    },
    // ... more libraries
  ]
}
```

### 4B.2: Extend ModLoaderService for client loaders

Add client loader methods to `packages/backend/src/services/mod-loader-service.ts`:

```typescript
export class ModLoaderService {
  // Existing server methods from Epic 2
  async installServerLoader(serverId: string, loader: ModLoader, mcVersion: string, loaderVersion?: string): Promise<void>;
  
  // NEW: Client methods
  async installClientLoader(instanceId: string, loader: ModLoader, loaderVersion?: string): Promise<void>;
  
  async getClientLoaderVersions(loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]>;
  
  async detectClientLoader(instanceId: string): Promise<{
    loader: ModLoader | null;
    version: string | null;
  }>;
  
  async removeClientLoader(instanceId: string): Promise<void>;
}
```

### 4B.3: Fabric client loader implementation

```typescript
// In ModLoaderService

async installClientLoader(instanceId: string, loader: ModLoader, loaderVersion?: string): Promise<void> {
  const instance = this.instanceModel.getById(instanceId);
  if (!instance) throw new NotFoundError('Instance not found');
  
  if (loader !== 'fabric') {
    throw new Error('Only Fabric is supported for client loaders in this phase');
  }
  
  // 1. Fetch loader versions
  const versions = await this.getClientLoaderVersions('fabric', instance.version);
  const targetVersion = loaderVersion ?? versions[0]?.version;
  if (!targetVersion) throw new Error('No Fabric loader versions available');
  
  // 2. Download profile JSON
  const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${instance.version}/${targetVersion}/profile/json`;
  const profile = await fetch(profileUrl).then(r => r.json());
  
  // 3. Save profile JSON
  const versionId = profile.id;
  const versionDir = path.join(instance.gameDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(
    path.join(versionDir, `${versionId}.json`),
    JSON.stringify(profile, null, 2)
  );
  
  // 4. Download libraries
  const librariesDir = path.join(instance.gameDir, 'libraries');
  for (const lib of profile.libraries) {
    await this.downloadLibrary(lib, librariesDir);
  }
  
  // 5. Update instance record
  this.instanceModel.update(instanceId, {
    loader: 'fabric',
    loaderVersion: targetVersion,
    versionId,
  });
}

private async downloadLibrary(lib: any, librariesDir: string): Promise<void> {
  // Parse Maven coordinates: "net.fabricmc:fabric-loader:0.16.0"
  const [group, artifact, version] = lib.name.split(':');
  const groupPath = group.replace(/\./g, '/');
  const fileName = `${artifact}-${version}.jar`;
  const relativePath = `${groupPath}/${artifact}/${version}/${fileName}`;
  const localPath = path.join(librariesDir, relativePath);
  
  // Skip if already downloaded
  if (fs.existsSync(localPath)) return;
  
  // Download from Maven repo
  const baseUrl = lib.url ?? 'https://libraries.minecraft.net/';
  const downloadUrl = `${baseUrl}${relativePath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Failed to download library: ${downloadUrl}`);
  
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(localPath, Buffer.from(buffer));
}
```

### 4B.4: Client loader routes

**New routes** (add to `packages/backend/src/routes/instances.ts` or new `packages/backend/src/routes/instance-mods.ts`):

```
POST   /api/instances/:id/loader          → Install mod loader
GET    /api/instances/:id/loader          → Get current loader info
DELETE /api/instances/:id/loader          → Remove mod loader (revert to vanilla)
GET    /api/loaders/:type/client-versions?mcVersion=1.21.4  → Available client loader versions
```

**Files modified**: `packages/backend/src/services/mod-loader-service.ts`, `packages/backend/src/routes/instances.ts`

---

## Phase 4C: Instance Mod CRUD Routes & UI

### 4C.1: Instance mod routes

**New file**: `packages/backend/src/routes/instance-mods.ts`

```
GET    /api/instances/:id/mods                    → List installed mods
POST   /api/instances/:id/mods                    → Install mod from Modrinth
DELETE /api/instances/:id/mods/:modId             → Remove mod
PATCH  /api/instances/:id/mods/:modId             → Toggle enable/disable
POST   /api/instances/:id/mods/sync               → Sync mods directory with DB
POST   /api/instances/:id/mods/check-updates      → Check for available updates
POST   /api/instances/:id/mods/apply-updates      → Apply selected updates
POST   /api/instances/:id/modpack/import          → Import .mrpack
POST   /api/instances/:id/modpack/export          → Export .mrpack
```

**Implementation** (route handlers):

```typescript
// In packages/backend/src/routes/instance-mods.ts

router.get('/instances/:id/mods', async (req, res, next) => {
  try {
    const instance = instanceModel.getById(req.params.id);
    if (!instance) throw new NotFoundError('Instance not found');
    
    const target = instanceToModTarget(instance);
    const mods = await modService.listMods(target);
    res.json(mods);
  } catch (err) {
    next(err);
  }
});

router.post('/instances/:id/mods', async (req, res, next) => {
  try {
    const request = installModSchema.parse(req.body);
    const instance = instanceModel.getById(req.params.id);
    if (!instance) throw new NotFoundError('Instance not found');
    
    const target = instanceToModTarget(instance);
    const installed = await modService.installMod(target, request);
    res.json(installed);
  } catch (err) {
    next(err);
  }
});

// ... similar for other routes
```

### 4C.2: Modrinth search client-side filtering

When searching for mods for an instance, filter by `client_side: required|optional`. Server-only mods should not appear.

**Modify** `packages/backend/src/routes/modrinth.ts`:

```typescript
router.get('/modrinth/search', async (req, res, next) => {
  try {
    const { q, loader, mcVersion, side, limit = 20, offset = 0 } = req.query;
    
    const facets: string[][] = [];
    if (loader) facets.push([`categories:${loader}`]);
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    
    // NEW: Filter by side (client, server, or both)
    if (side === 'client') {
      facets.push(['client_side:required', 'client_side:optional']);
    } else if (side === 'server') {
      facets.push(['server_side:required', 'server_side:optional']);
    }
    
    const results = await modrinthClient.search({
      query: q as string,
      facets,
      limit: Number(limit),
      offset: Number(offset),
    });
    
    res.json(results);
  } catch (err) {
    next(err);
  }
});
```

### 4C.3: Frontend — Instance Mod Manager UI

Add a **Mods** tab to the `InstanceDetail.tsx` page (from Epic 3). The UI is nearly identical to the server mod manager from Epic 2, with minor differences:

**Differences from server mod UI**:
- Search filters by `side=client` instead of `side=server`
- Loader installation UI shows "Install Fabric for Client" instead of "Install Fabric Server"
- Mod list shows client-side mods (shaders, minimaps, HUDs) that wouldn't appear for servers

**New components** (or reuse from Epic 2 with props):

| Component | Purpose |
|-----------|---------|
| `InstanceModManagerTab.tsx` | Container for instance mod management |
| `ModManagerTab.tsx` (generalized) | Shared component for both server and instance mods |
| `ModSearchPanel.tsx` (generalized) | Accepts `targetType: 'server' | 'instance'` prop |
| `ModLoaderSetup.tsx` (generalized) | Accepts `targetType` prop, shows appropriate install UI |

**Recommended approach**: Generalize the Epic 2 components to accept a `target` prop instead of duplicating them.

**Example generalization**:

```typescript
// Before (Epic 2)
interface ModManagerTabProps {
  serverId: string;
}

// After (Epic 4)
interface ModManagerTabProps {
  targetType: 'server' | 'instance';
  targetId: string;
}

export function ModManagerTab({ targetType, targetId }: ModManagerTabProps) {
  const apiBase = targetType === 'server' 
    ? `/api/servers/${targetId}` 
    : `/api/instances/${targetId}`;
  
  const { data: mods } = useQuery(['mods', targetType, targetId], () =>
    fetch(`${apiBase}/mods`).then(r => r.json())
  );
  
  // ... rest of component uses apiBase for all requests
}
```

### 4C.4: Zustand store additions

Extend the mod store (or create a separate instance mod store):

```typescript
interface ModState {
  // Existing server mod state from Epic 2
  modsByServer: Record<string, InstalledMod[]>;
  
  // NEW: Instance mod state
  modsByInstance: Record<string, InstalledMod[]>;
  
  // Generalized actions
  fetchMods: (targetType: 'server' | 'instance', targetId: string) => Promise<void>;
  searchMods: (query: string, targetType: 'server' | 'instance', targetId: string) => Promise<void>;
  installMod: (targetType: 'server' | 'instance', targetId: string, versionId: string) => Promise<void>;
  removeMod: (targetType: 'server' | 'instance', targetId: string, modId: string) => Promise<void>;
  toggleMod: (targetType: 'server' | 'instance', targetId: string, modId: string, enabled: boolean) => Promise<void>;
  checkUpdates: (targetType: 'server' | 'instance', targetId: string) => Promise<ModUpdateInfo[]>;
  applyUpdates: (targetType: 'server' | 'instance', targetId: string, modIds: string[]) => Promise<void>;
}
```

**Files created**: `packages/backend/src/routes/instance-mods.ts`, `packages/frontend/src/components/instances/InstanceModManagerTab.tsx` (or generalize existing components)
**Files modified**: `packages/backend/src/routes/modrinth.ts`, `packages/frontend/src/pages/InstanceDetail.tsx`, `packages/frontend/src/stores/modStore.ts`, `packages/frontend/src/api/client.ts`

---

## Phase 4D: Resource Packs & Shader Packs (Stretch)

### 4D.1: Resource pack management

Resource packs live in `{instanceDir}/resourcepacks/`. They are ZIP files with a `pack.mcmeta` file.

**New routes**:
```
GET    /api/instances/:id/resourcepacks       → List installed resource packs
POST   /api/instances/:id/resourcepacks       → Upload/install resource pack
DELETE /api/instances/:id/resourcepacks/:id   → Remove resource pack
PATCH  /api/instances/:id/resourcepacks/:id   → Enable/disable (updates options.txt)
```

**Database table**:
```sql
CREATE TABLE resource_packs (
  id            TEXT PRIMARY KEY,
  instance_id   TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  format        INTEGER NOT NULL,
  icon_url      TEXT,
  enabled       INTEGER NOT NULL DEFAULT 0,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(instance_id, file_name)
);
```

**Implementation notes**:
- Parse `pack.mcmeta` to extract name, description, pack_format
- Extract `pack.png` (if present) for icon
- Enabling/disabling requires editing `options.txt` (key: `resourcePacks`)

### 4D.2: Shader pack management

Shader packs live in `{instanceDir}/shaderpacks/`. They are ZIP files or directories.

**New routes**:
```
GET    /api/instances/:id/shaderpacks       → List installed shader packs
POST   /api/instances/:id/shaderpacks       → Upload/install shader pack
DELETE /api/instances/:id/shaderpacks/:id   → Remove shader pack
PATCH  /api/instances/:id/shaderpacks/:id   → Enable (updates optionsshaders.txt)
```

**Database table**:
```sql
CREATE TABLE shader_packs (
  id            TEXT PRIMARY KEY,
  instance_id   TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  folder_name   TEXT NOT NULL,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(instance_id, folder_name)
);
```

**Implementation notes**:
- Shader packs require Optifine or Iris (Fabric mod)
- Enabling requires editing `optionsshaders.txt` (key: `shaderPack`)
- Only one shader pack can be enabled at a time

### 4D.3: Frontend UI for packs

Add **Resource Packs** and **Shader Packs** tabs to the Instance Detail page, or sub-tabs within the Mods tab.

**Components**:
- `ResourcePackList.tsx` — List of installed resource packs with enable/disable toggles
- `ShaderPackList.tsx` — List of installed shader packs with enable radio buttons
- `PackUploadDialog.tsx` — Drag-and-drop or file picker for uploading packs

**Files created**: `packages/backend/src/routes/resource-packs.ts`, `packages/backend/src/routes/shader-packs.ts`, `packages/backend/src/services/resource-pack-service.ts`, `packages/backend/src/services/shader-pack-service.ts`, `packages/frontend/src/components/instances/ResourcePackList.tsx`, `packages/frontend/src/components/instances/ShaderPackList.tsx`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **4A** (Generalize ModService) | ~4h | ModTarget abstraction, refactored ModService, DB migration |
| 2 | **4B** (Client loader install) | ~4h | Fabric client profile installation, loader routes |
| 3 | **4C** (Instance mod CRUD + UI) | ~5h | Instance mod routes, generalized frontend components |
| 4 | **4D** (Resource/shader packs) | ~4h | Resource pack and shader pack management (stretch) |

**Total: ~17 hours** (13h without Phase 4D)

---

## Complete File Change Summary

### New Files (8+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/migrations/00X_client_mods.sql` | 4A | Add instance_id to installed_mods table |
| `packages/backend/src/routes/instance-mods.ts` | 4C | Instance mod CRUD routes |
| `packages/backend/src/routes/resource-packs.ts` | 4D | Resource pack routes (stretch) |
| `packages/backend/src/routes/shader-packs.ts` | 4D | Shader pack routes (stretch) |
| `packages/backend/src/services/resource-pack-service.ts` | 4D | Resource pack business logic (stretch) |
| `packages/backend/src/services/shader-pack-service.ts` | 4D | Shader pack business logic (stretch) |
| `packages/frontend/src/components/instances/InstanceModManagerTab.tsx` | 4C | Instance mod manager UI (or generalize existing) |
| `packages/frontend/src/components/instances/ResourcePackList.tsx` | 4D | Resource pack list UI (stretch) |
| `packages/frontend/src/components/instances/ShaderPackList.tsx` | 4D | Shader pack list UI (stretch) |

### Modified Files (10)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 4A | ModTarget interface, extend InstalledMod, client loader types |
| `packages/backend/src/services/mod-service.ts` | 4A | Refactor to use ModTarget instead of serverId |
| `packages/backend/src/services/modpack-service.ts` | 4A | Refactor to use ModTarget, handle client overrides |
| `packages/backend/src/services/mod-loader-service.ts` | 4B | Add client loader installation methods |
| `packages/backend/src/models/mod.ts` | 4A | Add instance queries, generalize methods |
| `packages/backend/src/routes/modrinth.ts` | 4C | Add client-side filtering to search |
| `packages/backend/src/routes/instances.ts` | 4B | Add loader routes (or create instance-mods.ts) |
| `packages/backend/src/app.ts` | 4C | Mount instance-mods routes |
| `packages/frontend/src/pages/InstanceDetail.tsx` | 4C | Add Mods tab |
| `packages/frontend/src/stores/modStore.ts` | 4C | Add instance mod state and actions |
| `packages/frontend/src/api/client.ts` | 4C | Add instance mod API methods |
| `packages/frontend/src/components/mods/ModManagerTab.tsx` | 4C | Generalize to accept targetType prop (or duplicate) |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Fabric client profile JSON format changes | Fabric's meta API is stable. Version the parser. Fallback to manual installation instructions if parsing fails. |
| Library download failures (Maven repos down) | Retry with exponential backoff. Cache downloaded libraries. Provide manual download links in error messages. |
| Mod conflicts between client and server | Clearly label mods as client-only, server-only, or both. Warn when installing server-only mods on instances. |

### Medium

| Risk | Mitigation |
| Mods directory diverges from DB (manual file changes) | `syncModsDirectory` reconciliation on every load (same as Epic 2). Modrinth hash lookup identifies unknown mods. |
| Forge/NeoForge client installation complexity | Fabric is primary. Forge client installation is deferred (requires Forge installer, more complex than server). |
| Resource pack `options.txt` parsing fragility | Use a robust parser (or regex). Backup `options.txt` before editing. Validate after write. |
| Shader packs require Optifine/Iris | Detect if Iris is installed. Show warning if not. Provide install link. |

### Low

| Risk | Mitigation |
|------|------------|
| Large modpacks (100+ mods) on client | Same mitigation as Epic 2: parallel downloads (limit 5), progress reporting, retry queue. |
| Client-side mods with server-side dependencies | Dependency resolver already handles this. Install server-side deps if required. |

---

## Testing Checklist

1. **Generalized ModService**: Install a mod on a server → works. Install a mod on an instance → works. Both use the same service.
2. **Client loader install**: Install Fabric on an instance → profile JSON created, libraries downloaded, instance launches with Fabric.
3. **Client mod search**: Search for "sodium" in instance mod manager → only client-compatible mods appear.
4. **Client mod install**: Install Sodium on instance → Fabric API auto-installs as dependency → both appear in mods list.
5. **Client mod enable/disable**: Disable a mod → file renamed to `.jar.disabled` → instance launches without it.
6. **Client mod updates**: Install old version → check updates → update available → apply → new version installed.
7. **Client modpack import**: Import a `.mrpack` → Fabric installed, all mods downloaded, overrides applied to `.minecraft/`.
8. **Client modpack export**: Export instance as `.mrpack` → import into a new instance → identical mod setup.
9. **Resource pack install** (4D): Upload a resource pack → appears in list → enable → `options.txt` updated → pack loads in-game.
10. **Shader pack install** (4D): Upload a shader pack → enable → `optionsshaders.txt` updated → shaders load in-game (if Iris installed).
11. **Cross-target consistency**: Install the same mod on a server and an instance → both work independently, no conflicts.
12. **Instance must be stopped**: Mod operations blocked while instance is running (except viewing).
