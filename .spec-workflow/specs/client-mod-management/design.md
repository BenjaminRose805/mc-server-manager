# Design Document -- Client Mod Management

## Overview

Generalize the existing server mod management system to support client game instances. The core change is a `ModTarget` abstraction that lets `ModService`, `ModpackService`, and the frontend components work with both servers and instances through a unified interface. This avoids duplicating the Modrinth client, dependency resolver, modpack parser, and UI components.

## Steering Document Alignment

No steering docs exist. This design follows project conventions and builds directly on Epic 2's existing patterns.

## Code Reuse Analysis

### Existing Components to Leverage (Heavy Reuse)
- **`packages/backend/src/services/mod-manager.ts`**: Core mod service. Refactored from `serverId` params to `ModTarget` params. All business logic (dependency resolution, hash verification, update checking) stays the same.
- **`packages/backend/src/services/modpack-manager.ts`**: Modpack import/export. Refactored to `ModTarget`. Override application logic differs for client (uses `overrides/` not `server-overrides/`).
- **`packages/backend/src/services/modpack-parser.ts`**: `.mrpack` parsing. No changes needed -- already target-agnostic.
- **`packages/backend/src/routes/mods.ts`**: Server mod routes. Pattern replicated for instance mod routes.
- **`packages/frontend/src/pages/Mods.tsx`**: Mod search UI. Generalized with `targetType` prop.
- **`packages/frontend/src/components/ModList.tsx`**: Installed mod list. Generalized with `targetType` prop.
- **`packages/frontend/src/api/client.ts`**: API client. Instance mod methods added following same patterns.

### Integration Points
- **`installed_mods` table**: Extended with `instance_id` column (nullable, mutually exclusive with `server_id` via CHECK constraint)
- **Modrinth search routes**: Add `side` query parameter for client-side filtering
- **Mod loader service**: Extended with client-specific Fabric installation (profile JSON + Maven libraries vs server launcher JAR)
- **Instance detail page**: New Mods tab using generalized mod components

## Architecture

### ModTarget Abstraction

The key architectural change is introducing `ModTarget` -- a common interface that abstracts the difference between servers and instances from the mod system's perspective:

```
                    ModTarget
                   ┌──────────────────┐
                   │ type: server|inst │
                   │ id: string       │
                   │ modsDir: string   │
                   │ mcVersion: string │
                   │ loader: ModLoader │
                   │ loaderVersion: str│
                   └────────┬─────────┘
                            │
              ┌─────────────┼─────────────┐
              │                           │
     serverToModTarget()         instanceToModTarget()
              │                           │
     ┌────────┴────────┐       ┌──────────┴──────────┐
     │ Server          │       │ LauncherInstance     │
     │ (existing)      │       │ (from Epic 3)       │
     └─────────────────┘       └─────────────────────┘
```

### Service Refactor Pattern

```
Before (Epic 2):
  ModService.installMod(serverId, request)
    → modModel.getByServerId(serverId)
    → path.join(server.path, 'mods')
    → server.version, server.loader

After (Epic 4):
  ModService.installMod(target: ModTarget, request)
    → target.type === 'server' ? modModel.getByServerId(target.id) : modModel.getByInstanceId(target.id)
    → target.modsDir
    → target.mcVersion, target.loader
```

### Client Loader Installation Flow

```
Fabric Server (Epic 2):              Fabric Client (Epic 4):
──────────────────────                ──────────────────────
1. Fetch loader versions              1. Fetch loader versions (same API)
2. Download server launcher JAR        2. Download profile JSON
3. Save as fabric-server-launch.jar    3. Save to instances/versions/{id}/
4. Update server jarPath               4. Download Maven libraries
                                       5. Update instance loader fields
```

### Modular Design Principles
- **Single Interface Change**: `serverId: string` → `target: ModTarget` is the only parameter change across all mod service methods.
- **Route Separation**: Instance mod routes live in `instance-mods.ts`, completely separate from server mod routes.
- **Component Generalization**: Frontend components accept `targetType` and `targetId` props, construct the appropriate API base URL internally.
- **No Cross-Contamination**: Server mod functionality is 100% unchanged after the refactor.

## Components and Interfaces

### Component 1: ModTarget Type (`shared/src/index.ts`)
- **Purpose**: Common interface abstracting server/instance for mod operations
- **Interface**: `{ type: 'server'|'instance', id: string, modsDir: string, mcVersion: string, loader: ModLoader|null, loaderVersion: string|null }`
- **Dependencies**: None
- **Reuses**: Existing `ModLoader` type

### Component 2: ModService Refactor (`packages/backend/src/services/mod-manager.ts`)
- **Purpose**: Generalize all mod operations to work with ModTarget
- **Interface changes**: All methods change `serverId: string` → `target: ModTarget`
- **Dependencies**: ModModel (extended), ModrinthClient (unchanged)
- **Reuses**: All existing business logic -- dependency resolution, hash verification, update checking

### Component 3: ModModel Extension (`packages/backend/src/models/mod.ts` equivalent)
- **Purpose**: Add instance-aware queries alongside existing server queries
- **New methods**: `getByInstanceId(id)`, `deleteByInstanceId(id)`, `getByTarget(type, id)`
- **Dependencies**: better-sqlite3
- **Reuses**: Existing prepared statement patterns

### Component 4: Client Loader Installation (`packages/backend/src/services/mod-loader-service.ts` extension)
- **Purpose**: Install Fabric client profile (different from server Fabric installation)
- **New methods**: `installClientLoader(instanceId, loader, loaderVersion?)`, `getClientLoaderVersions()`, `removeClientLoader(instanceId)`
- **Dependencies**: Fabric Meta API, instance model, library download
- **Reuses**: Existing `getLoaderVersions()` method (same Fabric API)

### Component 5: Instance Mod Routes (`packages/backend/src/routes/instance-mods.ts`)
- **Purpose**: REST endpoints for instance mod operations
- **Endpoints**: Same pattern as server mod routes but under `/api/launcher/instances/:id/mods/*`
- **Dependencies**: ModService (with ModTarget), instance model
- **Reuses**: Route handler pattern from existing `mods.ts`

### Component 6: Generalized Frontend Components
- **Purpose**: Mod manager UI that works for both servers and instances
- **Interface change**: Components accept `targetType: 'server'|'instance'` and `targetId: string` instead of `serverId`
- **Dependencies**: API client (extended)
- **Reuses**: All existing mod UI components -- just parameterized

## Data Models

### installed_mods table (migration -- extend existing)
```sql
-- Recreate with instance_id column and CHECK constraint
CREATE TABLE installed_mods_new (
  id            TEXT PRIMARY KEY,
  server_id     TEXT REFERENCES servers(id) ON DELETE CASCADE,
  instance_id   TEXT REFERENCES launcher_instances(id) ON DELETE CASCADE,
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
  CHECK ((server_id IS NOT NULL AND instance_id IS NULL) OR
         (server_id IS NULL AND instance_id IS NOT NULL)),
  UNIQUE(server_id, file_name),
  UNIQUE(instance_id, file_name)
);
```

## Error Handling

### Error Scenarios

1. **Client loader installation fails mid-download**
   - **Handling**: Libraries are downloaded individually with retry. Partial state is cleaned up. Instance record is not updated until all downloads succeed.
   - **User Impact**: "Failed to install Fabric. Some libraries could not be downloaded. [Retry]"

2. **Server-only mod installed on instance**
   - **Handling**: Modrinth search filters by `client_side`, but manual installs (by version ID) check and warn. Installation proceeds with a warning.
   - **User Impact**: Warning toast: "This mod is server-side only and may not work in your game client."

3. **ModTarget conversion fails (instance not found)**
   - **Handling**: Route handler returns 404 before calling ModService.
   - **User Impact**: Standard "Instance not found" error.

4. **Database migration fails (table recreation)**
   - **Handling**: Migration uses transaction. Old table data is preserved if migration fails.
   - **User Impact**: App fails to start. User sees migration error in logs.

## File Structure

### New Files
```
packages/backend/src/routes/instance-mods.ts      # Instance mod CRUD routes
packages/backend/migrations/008_client_mods.sql    # Add instance_id to installed_mods
```

### Modified Files
```
shared/src/index.ts                                # ModTarget type, InstalledMod.instanceId
packages/backend/src/services/mod-manager.ts       # Refactor to ModTarget
packages/backend/src/services/modpack-manager.ts   # Refactor to ModTarget
packages/backend/src/models/mod.ts (or equivalent) # Add instance queries
packages/backend/src/services/mod-loader-service.ts (or equivalent) # Add client loader methods
packages/backend/src/routes/mods.ts (or equivalent)# Add side filter to Modrinth search
packages/backend/src/app.ts                        # Mount instance-mods routes
packages/frontend/src/components/ModList.tsx        # Generalize with targetType prop
packages/frontend/src/pages/Mods.tsx               # Generalize with targetType prop
packages/frontend/src/api/client.ts                # Add instance mod API methods
```

## Testing Strategy

### Unit Testing
- No automated tests exist. Manual verification.
- Key verification: install a mod on a server, verify it still works after refactor. Install same mod on instance, verify it works.

### Integration Testing
- **Backward compatibility**: All existing server mod operations work identically after refactor
- **Client mod install**: Install Sodium on a Fabric instance -> Fabric API auto-installs -> both appear in list
- **Client mod search**: Search from instance shows client-compatible mods, server-only mods hidden
- **Client loader**: Install Fabric on vanilla instance -> profile JSON + libraries downloaded -> instance launches with Fabric
- **Modpack import**: Import .mrpack to instance -> overrides applied to instance dir (not server-overrides)
- **Cross-target**: Same mod installed on server and instance independently, no interference

### End-to-End Testing
- Create server with Fabric + Sodium -> Create instance with Fabric + Sodium -> Both work independently
- Export server modpack -> Import to instance -> Mods match
- Disable mod on instance -> Launch game -> Mod not loaded -> Re-enable -> Mod loaded
