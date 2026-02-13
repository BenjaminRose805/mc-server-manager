# Design Document -- Shared Minecraft Servers

## Overview

Enable Minecraft server sharing within a community: server owners toggle sharing, set display names and descriptions, and grant per-user permissions (view, join, manage, admin). Community members browse shared servers in a live-updating card grid, join with one click (or clipboard copy), and -- if authorized -- manage servers remotely. Whitelists are automatically synced based on permissions. All real-time updates use the existing WebSocket infrastructure with new broadcast logic. Data is stored in the existing SQLite database with two schema additions (sharing fields on `servers`, new `server_permissions` table).

## Steering Document Alignment

No steering docs exist. This design follows existing project conventions (Express routes, Zod validation, SQLite models with prepared statements, Zustand stores, Tailwind UI, WebSocket message protocol with `type` discriminator).

## Code Reuse Analysis

### Existing Components to Leverage
- **WebSocket server (packages/backend/src/ws/)**: Already handles real-time messaging for console output and server status. Extended with permission-aware broadcasting to community members. Same connection, same protocol pattern.
- **WebSocket client (packages/frontend/src/api/ws.ts)**: `WsClient` with auto-reconnect. Extended to handle shared server status and player events for the browser page.
- **ServerManager singleton (packages/backend/src/services/server-manager.ts)**: Already tracks server processes, status, and player lists. Extended with a broadcast method that filters by permission.
- **ServerProcess class (packages/backend/src/services/process.ts)**: Already manages Java child processes and stdin command sending. Reused directly for whitelist commands.
- **Auth middleware (packages/backend/src/middleware/auth.ts)**: All new routes require `requireAuth`. New `requireServerPermission` middleware follows same pattern.
- **Error classes (packages/backend/src/utils/errors.ts)**: `NotFoundError`, `ForbiddenError`, `UnauthorizedError` used in permission checks and route handlers.
- **Zod validation**: All new route handlers use Zod schemas following existing patterns.
- **Pino logger**: Existing logger for whitelist sync and permission events.
- **Zustand store pattern (packages/frontend/src/stores/serverStore.ts)**: Pattern reused for community server state in the existing store or a new slice.
- **Console UI (packages/frontend/src/components/)**: Existing console components reused for shared server console access -- no new console UI needed.

### Integration Points
- **`servers` table**: Extended with sharing columns (shared, shared_name, shared_description, shared_at).
- **`users` table (Epic 5)**: Foreign key target for server_permissions. Optional `minecraft_username` and `minecraft_uuid` columns for whitelist sync.
- **Express app (app.ts or index.ts)**: Mount new routes for community servers and server sharing.
- **Frontend routing (App.tsx)**: Add `/community/servers` route for the server browser page.

## Architecture

### Server Sharing Data Flow

```
Owner toggles "Share" in server settings
  --> PUT /api/servers/:id/sharing { shared: true, sharedName, sharedDescription }
  --> Backend updates servers table (shared=1, shared_name, shared_description, shared_at)
  --> If enabling: WhitelistSyncService.syncAll() adds all users with "join" permission to whitelist.json
  --> Server now appears in GET /api/community/servers responses
  --> WebSocket broadcasts status changes to all users with "view" permission
```

### One-Click Join Flow

```
Member clicks "Join" in server browser
  --> POST /api/community/servers/:id/join
  --> Backend verifies user has "join" permission via middleware
  --> Backend returns { address, port, version, requiresMods }
  --> Frontend receives connection info:
      - If Electron + Client Launcher: IPC call to launch Minecraft client
      - Otherwise: copy address:port to clipboard, show toast
  --> Backend: WhitelistSyncService ensures user is on whitelist
```

### Whitelist Sync Flow

```
User granted "join" permission (or higher)
  --> WhitelistSyncService.addUser(server, mcUsername, mcUuid)
  --> Read whitelist.json, add entry if not present, write back
  --> If server running: send "whitelist add <username>" via stdin
  --> If server running: send "whitelist reload" via stdin

User permission revoked (drops below "join")
  --> WhitelistSyncService.removeUser(server, mcUsername, mcUuid)
  --> Read whitelist.json, remove entry, write back
  --> If server running: send "whitelist remove <username>" + "whitelist reload"
```

### Permission-Gated WebSocket Broadcasting

```
Server status changes (start, stop, player join/leave)
  --> ServerManager detects change (existing behavior)
  --> If server is shared: query server_permissions for all users with "view" or higher
  --> Broadcast status/stats event to those users' WebSocket connections
  --> Each client's store updates, re-renders server browser card
```

### Modular Design Principles
- **Permission hierarchy in code**: A numeric mapping (view=1, join=2, manage=3, admin=4) with a `hasPermission(userLevel, requiredLevel)` utility for clean comparisons.
- **Middleware composition**: `requirePermissionLevel(level)` is a reusable middleware factory that composes with `requireAuth` on any route.
- **Fire-and-forget whitelist sync**: Permission changes return immediately; whitelist sync runs asynchronously with error logging but no blocking.
- **Unified server model**: Sharing fields are columns on the existing `servers` table, not a separate table, keeping queries simple.

## Components and Interfaces

### Component 1: Server Permission Model (`packages/backend/src/models/server-permission.ts`)
- **Purpose**: CRUD for server_permissions table -- grant, revoke, query by server, query by user, check permission level
- **Interfaces**: `getServerPermission(serverId, userId)`, `grantPermission(serverId, userId, permission, grantedBy)`, `revokePermission(serverId, userId)`, `listServerPermissions(serverId)`, `listUserPermissions(userId)`, `hasPermission(userLevel, requiredLevel)`
- **Dependencies**: Database module, nanoid, shared types
- **Reuses**: Existing model patterns (prepared statements, snake_case to camelCase mapping)
- **Note**: This reuses Epic 5's `server-permission.ts` model. The `hasPermission` hierarchy check is an ADDITIONAL utility that maps levels to boolean flag combinations. It does NOT replace Epic 5's boolean flag model.

### Component 2: Server Permission Middleware (`packages/backend/src/middleware/server-permission.ts`)
- **Purpose**: Express middleware factory that translates hierarchical permission levels to Epic 5's boolean flag checks. `requirePermissionLevel('manage')` internally checks `can_view AND can_start AND can_console`.
- **Interfaces**: `requirePermissionLevel(requiredLevel: ServerPermissionLevel)` returns middleware function
- **Dependencies**: Server permission model, auth middleware (Epic 5), error classes
- **Reuses**: Error classes (UnauthorizedError, ForbiddenError), middleware composition pattern from auth.ts
- **Note**: This is distinct from Epic 5's `requireServerPermission(flag)` which checks individual boolean flags. This middleware translates hierarchical levels to flag combinations.

### Component 3: Whitelist Sync Service (`packages/backend/src/services/whitelist-sync.ts`)
- **Purpose**: Manages Minecraft server whitelists based on community permissions -- adds/removes users from whitelist.json and sends runtime commands to running servers
- **Interfaces**: `addUser(server, mcUsername, mcUuid)`, `removeUser(server, mcUsername, mcUuid)`, `syncAll(server, authorizedUsers[])`
- **Dependencies**: ServerManager (for sending stdin commands), fs module, logger
- **Reuses**: ServerProcess.sendCommand() for runtime whitelist updates

### Component 4: Community Servers Routes (`packages/backend/src/routes/community-servers.ts`)
- **Purpose**: REST API for browsing shared servers and joining
- **Endpoints**: `GET /api/community/servers` (list all shared), `GET /api/community/servers/:id` (detail), `POST /api/community/servers/:id/join` (get connection info)
- **Dependencies**: Auth middleware, server permission middleware/model, ServerManager, database
- **Reuses**: Route handler patterns, Zod validation

### Component 5: Server Sharing Routes (`packages/backend/src/routes/server-sharing.ts`)
- **Purpose**: REST API for managing sharing settings and permissions
- **Endpoints**: `PUT /api/servers/:id/sharing` (toggle sharing, set name/description), `GET /api/servers/:id/permissions` (list), `PUT /api/servers/:id/permissions/:userId` (grant/update), `DELETE /api/servers/:id/permissions/:userId` (revoke)
- **Dependencies**: Auth middleware, server permission middleware/model, whitelist sync service, Zod
- **Reuses**: Route handler patterns

### Component 6: Community Servers API Client (`packages/frontend/src/api/community-servers.ts`)
- **Purpose**: Frontend fetch wrappers for all community server and sharing endpoints
- **Interfaces**: `listSharedServers()`, `getSharedServer(id)`, `joinServer(id)`, `updateSharingSettings(id, settings)`, `listServerPermissions(id)`, `grantServerPermission(serverId, userId, permission)`, `revokeServerPermission(serverId, userId)`
- **Dependencies**: API client base (BASE_URL, auth headers)
- **Reuses**: Existing fetch pattern from api/client.ts

### Component 7: Server Browser Page (`packages/frontend/src/pages/ServerBrowser.tsx`)
- **Purpose**: Main community server browser page with card grid layout
- **Dependencies**: Community servers API client, ServerCard component, Zustand store
- **Reuses**: Page layout patterns, Loader2 spinner from lucide-react

### Component 8: Server Card Component (`packages/frontend/src/components/ServerCard.tsx`)
- **Purpose**: Card displaying a shared server's status, player count, permission level, and action buttons (Join, Manage)
- **Dependencies**: Community servers API, shared types, lucide-react icons, sonner toasts
- **Reuses**: Tailwind card patterns, status color mapping from existing server UI

### Component 9: Server Sharing Settings Panel (`packages/frontend/src/components/ServerSharingSettings.tsx`)
- **Purpose**: UI for toggling sharing, editing display name and description, viewing permission count
- **Dependencies**: Community servers API, shared types, sonner toasts
- **Reuses**: Tailwind form patterns

### Component 10: Server Permissions Manager (`packages/frontend/src/components/ServerPermissionsManager.tsx`)
- **Purpose**: UI for listing, granting, and revoking per-user permissions on a server
- **Dependencies**: Community servers API, shared types, lucide-react icons, sonner toasts
- **Reuses**: Tailwind list/table patterns

### Component 11: WebSocket Broadcasting Extension (modify `packages/backend/src/services/server-manager.ts`)
- **Purpose**: Broadcast server status and player changes to all community members with view permission
- **Interfaces**: `broadcastToAuthorizedUsers(serverId, event)` helper method
- **Dependencies**: Server permission model (listServerPermissions), WebSocket server
- **Reuses**: Existing WebSocket broadcast infrastructure

**WebSocket Extension Pattern**: This epic adds new `case` branches to the existing WebSocket message handler switch statement. It does NOT restructure the handler. Epic 5 adds auth verification on connect. Epic 6 adds chat/presence handlers. This epic adds shared server broadcasting. Each epic extends the same handler file with its own message types — no epic should restructure the handler.

## Data Models

### servers table (ALTER -- add sharing columns)

```sql
ALTER TABLE servers ADD COLUMN shared INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE servers ADD COLUMN shared_name TEXT;
ALTER TABLE servers ADD COLUMN shared_description TEXT;
ALTER TABLE servers ADD COLUMN shared_at TEXT DEFAULT NULL;

CREATE INDEX idx_servers_shared ON servers(shared) WHERE shared = 1;
```

Fields:
- `shared`: Boolean (0/1) -- whether visible to community members
- `shared_name`: Display name for the server browser (may differ from internal name)
- `shared_description`: Description shown in browser (at most 500 characters)
- `shared_at`: ISO 8601 timestamp when sharing was enabled (or NULL if not shared)

### server_permissions table (EXTENDED -- uses Epic 5's table)

Epic 5 (migration 009) creates the `server_permissions` table with boolean flags (`can_view`, `can_start`, `can_console`, `can_edit`). This epic adds `granted_by` and reuses the existing columns. The hierarchical permission levels used in this spec map to boolean flag combinations:

| Level | can_view | can_start | can_console | can_edit | can_join |
|-------|----------|-----------|-------------|----------|----------|
| view  | 1        | 0         | 0           | 0        | 0        |
| join  | 1        | 0         | 0           | 0        | 1        |
| manage| 1        | 1         | 1           | 0        | 1        |
| admin | 1        | 1         | 1           | 1        | 1        |

```sql
-- Migration 011: Add sharing columns and extend server_permissions
ALTER TABLE servers ADD COLUMN shared INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE servers ADD COLUMN shared_name TEXT;
ALTER TABLE servers ADD COLUMN shared_description TEXT;
ALTER TABLE servers ADD COLUMN shared_at TEXT DEFAULT NULL;

ALTER TABLE server_permissions ADD COLUMN granted_by TEXT REFERENCES users(id);

CREATE INDEX idx_servers_shared ON servers(shared) WHERE shared = 1;
```

Note: SQLite does not enforce FK constraints on columns added via ALTER TABLE ADD COLUMN. Application-level validation of `granted_by` is required in the `grantPermission` model function.

The `ServerPermissionLevel` type is a convenience abstraction that maps to boolean flag combinations. The `requirePermissionLevel(level)` middleware translates levels to flag checks using Epic 5's existing `requireServerPermission('can_view')` etc.

### Shared TypeScript Types

```typescript
// Re-export from Epic 5 (do not redefine)
// ServerPermission is defined in Epic 5 with boolean flags:
// { id, serverId, userId, canView, canStart, canConsole, canEdit, canJoin, createdAt }
// This epic adds the ServerPermissionLevel convenience type:
export type ServerPermissionLevel = 'view' | 'join' | 'manage' | 'admin';

// Mapping utility (used in middleware and UI):
// view  = { canView: true }
// join  = { canView: true, canJoin: true } + whitelist entry
// manage = { canView: true, canStart: true, canConsole: true, canJoin: true }
// admin  = { canView: true, canStart: true, canConsole: true, canEdit: true, canJoin: true }

export interface SharedServerInfo {
  id: string;
  sharedName: string;
  sharedDescription: string | null;
  status: ServerStatus;
  playerCount: number;
  maxPlayers: number;
  version: string;
  type: ServerType;
  onlinePlayers: string[];
  myPermission: ServerPermissionLevel | null;
  sharedAt: string | null;
}

export interface ServerSharingSettings {
  shared: boolean;
  sharedName: string;
  sharedDescription: string | null;
}

export interface GrantPermissionRequest {
  userId: string;
  permission: ServerPermissionLevel;
}

export interface JoinServerResponse {
  address: string;
  port: number;
  version: string;
  requiresMods: boolean;
}

// WebSocket message types (server -> client)
// SharedServerStatusEvent: type 'shared:status', serverId, status
// SharedServerStatsEvent: type 'shared:stats', serverId, playerCount, maxPlayers, onlinePlayers
```

## Error Handling

### Error Scenarios

1. **User without permission attempts to join a server**
    - **Handling**: `requirePermissionLevel('join')` middleware throws ForbiddenError (403).
    - **User Impact**: "Requires join permission for this server" error. UI disables the Join button for users without join permission.

2. **User attempts to manage permissions without admin permission**
    - **Handling**: `requirePermissionLevel('admin')` middleware throws ForbiddenError (403).
    - **User Impact**: Permission management UI not shown. API returns 403 if bypassed.

3. **Server not found or not shared**
   - **Handling**: Community server routes return 404 NotFoundError.
   - **User Impact**: "Server not found or not shared" message.

4. **Whitelist sync fails (file I/O or command error)**
   - **Handling**: Errors are caught and logged via Pino. Permission change still succeeds (fire-and-forget).
   - **User Impact**: No visible error. Permission is granted but whitelist may be out of sync. Admin can manually trigger sync.

5. **Whitelist sync skipped (no Minecraft account linked)**
   - **Handling**: WhitelistSyncService checks for minecraft_username and minecraft_uuid. If missing, logs a warning and returns without action.
   - **User Impact**: Permission is granted but user is not whitelisted. They will see "not whitelisted" when trying to connect in Minecraft.

6. **Duplicate permission grant**
   - **Handling**: SQL uses `ON CONFLICT(server_id, user_id) DO UPDATE` for upsert behavior. No error thrown.
   - **User Impact**: Permission level is updated silently. No duplicate entries.

7. **WebSocket disconnect during server browser viewing**
   - **Handling**: Auto-reconnect (existing). On reconnect, client re-fetches shared server list for current state.
   - **User Impact**: Brief stale data, then automatic refresh.

8. **Corrupted whitelist.json**
   - **Handling**: WhitelistSyncService catches JSON parse errors, logs a warning, and treats the file as empty (rebuilds from scratch on next sync).
   - **User Impact**: No visible error. Whitelist is rebuilt correctly.

## File Structure

### New Files
```
packages/backend/migrations/011_shared_servers.sql             # Sharing columns + permissions table
packages/backend/src/models/server-permission.ts                # Permission CRUD and hierarchy logic (MODIFY -- extends Epic 5's file)
packages/backend/src/middleware/server-permission.ts            # Express permission middleware
packages/backend/src/services/whitelist-sync.ts                 # Whitelist auto-sync service
packages/backend/src/routes/community-servers.ts                # Community server browser API
packages/backend/src/routes/server-sharing.ts                   # Sharing settings + permission management API
packages/frontend/src/api/community-servers.ts                  # Frontend API client for shared servers
packages/frontend/src/pages/ServerBrowser.tsx                   # Server browser page
packages/frontend/src/components/ServerCard.tsx                 # Server card component
packages/frontend/src/components/ServerSharingSettings.tsx      # Sharing settings panel
packages/frontend/src/components/ServerPermissionsManager.tsx   # Permission management UI
```

### Modified Files
```
shared/src/index.ts                                             # Export shared server types, permission types
packages/backend/src/index.ts (or app.ts)                       # Mount community server and sharing routes
packages/backend/src/services/server-manager.ts                 # Add broadcastToAuthorizedUsers for shared servers
packages/frontend/src/App.tsx                                   # Add /community/servers route
packages/frontend/src/stores/serverStore.ts                     # Handle shared server WebSocket events (optional)
packages/frontend/src/api/ws.ts                                 # Handle shared:status and shared:stats events
```

## Dependencies

### New Backend npm Packages
- None required. All functionality uses existing packages (ws, express, better-sqlite3, zod, nanoid, pino, fs).

### New Frontend npm Packages
- None required. All functionality uses existing packages (react, zustand, sonner, lucide-react, @tanstack/react-virtual for potential future use).

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual verification.
- Key verification: permission hierarchy logic (hasPermission utility), whitelist JSON read/write, permission middleware access control.

### Integration Testing
- **Sharing toggle**: Enable sharing on a server, verify it appears in community server list. Disable sharing, verify it disappears.
- **Permission lifecycle**: Grant "join" permission to a user. Verify they can call the join endpoint. Revoke permission. Verify 403 on join attempt.
- **Permission hierarchy**: Grant "admin" permission. Verify the user can access join, manage, and admin endpoints. Grant only "view". Verify the user cannot join.
- **Whitelist sync on grant**: Grant "join" permission. Verify whitelist.json contains the user's entry. If server is running, verify "whitelist add" command was sent.
- **Whitelist sync on revoke**: Revoke permission. Verify whitelist.json no longer contains the user. If server is running, verify "whitelist remove" was sent.
- **Full whitelist sync**: Enable sharing with 3 users having "join" permission. Verify all 3 are in whitelist.json.
- **Join flow (no Epic 3)**: Click Join on a running server. Verify address is copied to clipboard with toast notification.
- **Server browser updates**: Start a shared server. Verify server browser updates status from "stopped" to "starting" to "running" in real time via WebSocket.
- **Permission-gated controls**: Log in as a user with "manage" permission. Verify start/stop buttons are visible. Log in as "view" user. Verify no control buttons.
- **Shared console access**: Log in as "admin" user. Subscribe to shared server console. Verify console output streams. Log in as "manage" user. Verify console subscription is denied.

### End-to-End Testing
- Full sharing flow: Create a server, enable sharing, grant permissions to 2 users, verify browser shows server, User A (join) clicks Join and gets address, User B (admin) accesses console and sends a command.
- Permission revocation flow: Revoke User A's permission. Verify they can no longer join. Verify whitelist.json updated. Re-grant and verify access restored.
