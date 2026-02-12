# Epic 7 — Shared Minecraft Servers

> **Prerequisite for**: Epic 9 (Mod Sync)
> **Standalone value**: Community members can browse, join, and manage shared Minecraft servers with granular permissions
> **Dependencies**: Epic 5 (Multi-User Foundation) for auth/permissions; optionally Epic 3 (Client Launcher) for one-click join

---

## Executive Summary

Transform MC Server Manager from a personal server tool into a community platform by enabling server owners to share their Minecraft servers with community members. Members can browse shared servers, see who's playing, join with one click, and (if permitted) manage servers remotely. This epic bridges the social platform (Epic 6) with the core server management functionality.

### Key Decisions

- **Per-server permission model**: Four permission levels (view, join, manage, admin) — granular enough for flexibility, simple enough to understand
- **Whitelist auto-sync**: Server whitelists are automatically managed based on community membership and join permissions — no manual whitelist editing
- **One-click join requires Epic 3**: Without the client launcher, "join" provides connection info for manual copy-paste
- **Shared console is permission-gated**: The existing console feature (Epic 1) becomes available to remote users with admin permission
- **Server browser is member-only**: Only authenticated community members see shared servers — no public directory

---

## Architecture

### Current Architecture (Post-Epic 6)
```
Desktop App (Tauri)
  │
  ├──► Local Mode: Server management, no auth required
  │
  └──► Connected Mode: Authenticated to community server
         │
         ├──► Friends system, presence
         ├──► Text chat channels
         └──► (NEW) Shared server browser
```

### Target Architecture
```
┌─────────────────────────────────────────────────┐
│  Desktop App (Member)                           │
│  ┌───────────────────────────────────────────┐  │
│  │ Server Browser UI                         │  │
│  │  • List of shared servers                 │  │
│  │  • Live status, player count              │  │
│  │  • "Join" button → auto-configure client  │  │
│  │  • Permission-gated controls              │  │
│  └───────────────┬───────────────────────────┘  │
│                  │ HTTPS/WSS                     │
└──────────────────┼───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│  Community Server (Host)                         │
│  ┌───────────────────────────────────────────┐  │
│  │ Express Backend                           │  │
│  │  • User auth (Epic 5)                     │  │
│  │  • Server visibility settings             │  │
│  │  • Permission system                      │  │
│  │  • Whitelist sync service                 │  │
│  │  • Player tracking (existing)             │  │
│  └───────────────┬───────────────────────────┘  │
│                  │                               │
│  ┌───────────────▼───────────────────────────┐  │
│  │ SQLite                                    │  │
│  │  • servers (+ shared fields)              │  │
│  │  • server_permissions (NEW)               │  │
│  │  • users (Epic 5)                         │  │
│  │  • minecraft_accounts (Epic 3, optional)  │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ Java Child Processes (MC Servers)        │  │
│  │  • Whitelist auto-managed                │  │
│  │  • Player join/leave events tracked      │  │
│  └───────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Data Flow: One-Click Join

```
[Member clicks "Join" in browser]
         │
         ├──► GET /api/community/servers/:id/join
         │      • Verify user has "join" permission
         │      • Return server address, port
         │      • (If Epic 3) Return MC version, mods list
         │
         ├──► Frontend receives connection info
         │      • (If Epic 3) Tauri IPC → launch MC client
         │      • (No Epic 3) Show "Copy to clipboard" dialog
         │
         └──► Backend: Whitelist sync service
                • Add user's MC username to server whitelist
                • Send "whitelist add <username>" via stdin
                • Persist to whitelist.json
```

### Data Flow: Whitelist Sync

```
[User joins community OR granted "join" permission]
         │
         ├──► WhitelistSyncService.addUser(serverId, userId)
         │      • Resolve user's MC username (from Epic 3 auth)
         │      • If server is running: send "whitelist add <username>"
         │      • If server is stopped: edit whitelist.json directly
         │      • Reload whitelist: "whitelist reload"
         │
[User leaves community OR permission revoked]
         │
         └──► WhitelistSyncService.removeUser(serverId, userId)
                • Send "whitelist remove <username>"
                • Edit whitelist.json
                • Reload whitelist
```

---

## Phase 7A: Database Schema & Types

### 7A.1: Extend `servers` table for sharing

Migration: `packages/backend/migrations/007_shared_servers.sql`

```sql
-- Add sharing fields to servers table
ALTER TABLE servers ADD COLUMN shared INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE servers ADD COLUMN shared_name TEXT;
ALTER TABLE servers ADD COLUMN shared_description TEXT;
ALTER TABLE servers ADD COLUMN shared_at INTEGER;

-- Index for querying shared servers
CREATE INDEX idx_servers_shared ON servers(shared) WHERE shared = 1;
```

**Fields:**
- `shared`: Boolean (0/1) — whether this server is visible to community members
- `shared_name`: Display name for the server browser (may differ from internal `name`)
- `shared_description`: Rich text description shown in browser
- `shared_at`: Unix timestamp when sharing was enabled

### 7A.2: Create `server_permissions` table

```sql
-- Per-server, per-user permissions
CREATE TABLE server_permissions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK(permission IN ('view', 'join', 'manage', 'admin')),
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id),
  UNIQUE(server_id, user_id)
);

CREATE INDEX idx_server_permissions_server ON server_permissions(server_id);
CREATE INDEX idx_server_permissions_user ON server_permissions(user_id);
```

**Permission levels:**
- `view`: Can see the server in the browser, view status/players
- `join`: Can join the server (auto-added to whitelist)
- `manage`: Can start/stop/restart, edit server.properties, view console
- `admin`: Full control (delete server, change sharing settings, grant permissions)

**Inheritance**: Each level includes all lower levels (admin → manage → join → view).

### 7A.3: Shared TypeScript types

Add to `shared/src/index.ts`:

```typescript
// Server sharing
export type ServerPermissionLevel = 'view' | 'join' | 'manage' | 'admin';

export interface ServerPermission {
  id: string;
  serverId: string;
  userId: string;
  permission: ServerPermissionLevel;
  grantedBy: string;
  grantedAt: number;
}

export interface SharedServerInfo {
  id: string;
  sharedName: string;
  sharedDescription: string | null;
  status: ServerStatus;
  playerCount: number;
  maxPlayers: number;
  version: string;
  type: ServerType;
  onlinePlayers: string[]; // MC usernames
  myPermission: ServerPermissionLevel | null;
  sharedAt: number;
}

export interface ServerSharingSettings {
  shared: boolean;
  sharedName: string;
  sharedDescription: string | null;
}

// API request/response types
export interface GrantPermissionRequest {
  userId: string;
  permission: ServerPermissionLevel;
}

export interface JoinServerResponse {
  address: string;
  port: number;
  version: string;
  requiresMods: boolean;
  mods?: Array<{ id: string; version: string }>; // For Epic 9
}
```

**Files created**: `packages/backend/migrations/007_shared_servers.sql`
**Files modified**: `shared/src/index.ts`

---

## Phase 7B: Backend — Permission System

### 7B.1: Permission model

Create `packages/backend/src/models/server-permission.ts`:

```typescript
import { db } from '../database.js';
import { nanoid } from 'nanoid';
import type { ServerPermission, ServerPermissionLevel } from '@mc-server-manager/shared';

const PERMISSION_HIERARCHY: Record<ServerPermissionLevel, number> = {
  view: 1,
  join: 2,
  manage: 3,
  admin: 4,
};

export function hasPermission(
  userLevel: ServerPermissionLevel | null,
  requiredLevel: ServerPermissionLevel
): boolean {
  if (!userLevel) return false;
  return PERMISSION_HIERARCHY[userLevel] >= PERMISSION_HIERARCHY[requiredLevel];
}

export function getServerPermission(
  serverId: string,
  userId: string
): ServerPermission | null {
  const row = db
    .prepare(
      `SELECT id, server_id, user_id, permission, granted_by, granted_at
       FROM server_permissions
       WHERE server_id = ? AND user_id = ?`
    )
    .get(serverId, userId) as any;

  if (!row) return null;

  return {
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    permission: row.permission,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

export function grantPermission(
  serverId: string,
  userId: string,
  permission: ServerPermissionLevel,
  grantedBy: string
): ServerPermission {
  const id = nanoid();
  const grantedAt = Date.now();

  db.prepare(
    `INSERT INTO server_permissions (id, server_id, user_id, permission, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, user_id) DO UPDATE SET
       permission = excluded.permission,
       granted_by = excluded.granted_by,
       granted_at = excluded.granted_at`
  ).run(id, serverId, userId, permission, grantedBy, grantedAt);

  return { id, serverId, userId, permission, grantedBy, grantedAt };
}

export function revokePermission(serverId: string, userId: string): void {
  db.prepare('DELETE FROM server_permissions WHERE server_id = ? AND user_id = ?').run(
    serverId,
    userId
  );
}

export function listServerPermissions(serverId: string): ServerPermission[] {
  const rows = db
    .prepare(
      `SELECT id, server_id, user_id, permission, granted_by, granted_at
       FROM server_permissions
       WHERE server_id = ?
       ORDER BY granted_at DESC`
    )
    .all(serverId) as any[];

  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    permission: row.permission,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  }));
}

export function listUserPermissions(userId: string): ServerPermission[] {
  const rows = db
    .prepare(
      `SELECT id, server_id, user_id, permission, granted_by, granted_at
       FROM server_permissions
       WHERE user_id = ?`
    )
    .all(userId) as any[];

  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    permission: row.permission,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  }));
}
```

### 7B.2: Permission middleware

Create `packages/backend/src/middleware/server-permission.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { getServerPermission, hasPermission } from '../models/server-permission.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import type { ServerPermissionLevel } from '@mc-server-manager/shared';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Middleware: Require user to have a specific permission level for a server.
 * Assumes req.userId is set by auth middleware (Epic 5).
 */
export function requireServerPermission(requiredLevel: ServerPermissionLevel) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { userId } = req;
    const serverId = req.params.id || req.params.serverId;

    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!serverId) {
      throw new Error('Server ID not found in route params');
    }

    const permission = getServerPermission(serverId, userId);

    if (!hasPermission(permission?.permission ?? null, requiredLevel)) {
      throw new ForbiddenError(
        `Requires ${requiredLevel} permission for this server`
      );
    }

    next();
  };
}
```

**Files created**: `packages/backend/src/models/server-permission.ts`, `packages/backend/src/middleware/server-permission.ts`

---

## Phase 7C: Backend — Whitelist Sync Service

### 7C.1: Whitelist sync service

Create `packages/backend/src/services/whitelist-sync.ts`:

```typescript
import { serverManager } from './server-manager.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import type { Server } from '@mc-server-manager/shared';

interface WhitelistEntry {
  uuid: string;
  name: string;
}

/**
 * Manages Minecraft server whitelists based on community permissions.
 * Syncs whitelist.json and sends runtime commands to running servers.
 */
class WhitelistSyncService {
  /**
   * Add a user to a server's whitelist.
   * @param server Server configuration
   * @param minecraftUsername User's Minecraft username (from Epic 3 auth)
   * @param minecraftUuid User's Minecraft UUID (from Epic 3 auth)
   */
  async addUser(
    server: Server,
    minecraftUsername: string,
    minecraftUuid: string
  ): Promise<void> {
    logger.info(
      { serverId: server.id, username: minecraftUsername },
      'Adding user to whitelist'
    );

    const whitelistPath = join(server.path, 'whitelist.json');

    // Update whitelist.json
    const whitelist = this.readWhitelist(whitelistPath);
    const existing = whitelist.find((entry) => entry.uuid === minecraftUuid);

    if (!existing) {
      whitelist.push({ uuid: minecraftUuid, name: minecraftUsername });
      this.writeWhitelist(whitelistPath, whitelist);
    }

    // If server is running, send runtime command
    const process = serverManager.getServer(server.id);
    if (process && process.status === 'running') {
      await process.sendCommand(`whitelist add ${minecraftUsername}`);
      await process.sendCommand('whitelist reload');
    }
  }

  /**
   * Remove a user from a server's whitelist.
   */
  async removeUser(
    server: Server,
    minecraftUsername: string,
    minecraftUuid: string
  ): Promise<void> {
    logger.info(
      { serverId: server.id, username: minecraftUsername },
      'Removing user from whitelist'
    );

    const whitelistPath = join(server.path, 'whitelist.json');

    // Update whitelist.json
    const whitelist = this.readWhitelist(whitelistPath);
    const filtered = whitelist.filter((entry) => entry.uuid !== minecraftUuid);

    if (filtered.length !== whitelist.length) {
      this.writeWhitelist(whitelistPath, filtered);
    }

    // If server is running, send runtime command
    const process = serverManager.getServer(server.id);
    if (process && process.status === 'running') {
      await process.sendCommand(`whitelist remove ${minecraftUsername}`);
      await process.sendCommand('whitelist reload');
    }
  }

  /**
   * Sync all users with "join" permission to the whitelist.
   * Called when a server is shared or when permissions change in bulk.
   */
  async syncAll(server: Server, authorizedUsers: Array<{ username: string; uuid: string }>): Promise<void> {
    logger.info({ serverId: server.id }, 'Syncing whitelist for all authorized users');

    const whitelistPath = join(server.path, 'whitelist.json');
    const whitelist: WhitelistEntry[] = authorizedUsers.map((user) => ({
      uuid: user.uuid,
      name: user.username,
    }));

    this.writeWhitelist(whitelistPath, whitelist);

    // Reload if running
    const process = serverManager.getServer(server.id);
    if (process && process.status === 'running') {
      await process.sendCommand('whitelist reload');
    }
  }

  private readWhitelist(path: string): WhitelistEntry[] {
    if (!existsSync(path)) {
      return [];
    }
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      logger.warn({ path, err }, 'Failed to read whitelist.json, treating as empty');
      return [];
    }
  }

  private writeWhitelist(path: string, whitelist: WhitelistEntry[]): void {
    writeFileSync(path, JSON.stringify(whitelist, null, 2), 'utf-8');
  }
}

export const whitelistSyncService = new WhitelistSyncService();
```

### 7C.2: Wire whitelist sync to permission changes

Modify `packages/backend/src/models/server-permission.ts` to trigger sync:

```typescript
import { whitelistSyncService } from '../services/whitelist-sync.js';
import { getServer } from './server.js';
import { getUser } from './user.js'; // Epic 5

export function grantPermission(
  serverId: string,
  userId: string,
  permission: ServerPermissionLevel,
  grantedBy: string
): ServerPermission {
  // ... existing code ...

  // If granting "join" or higher, add to whitelist
  if (hasPermission(permission, 'join')) {
    const server = getServer(serverId);
    const user = getUser(userId);

    if (server && user && user.minecraftUsername && user.minecraftUuid) {
      whitelistSyncService
        .addUser(server, user.minecraftUsername, user.minecraftUuid)
        .catch((err) => logger.error({ err, serverId, userId }, 'Whitelist sync failed'));
    }
  }

  return { id, serverId, userId, permission, grantedBy, grantedAt };
}

export function revokePermission(serverId: string, userId: string): void {
  const permission = getServerPermission(serverId, userId);

  db.prepare('DELETE FROM server_permissions WHERE server_id = ? AND user_id = ?').run(
    serverId,
    userId
  );

  // If user had "join" permission, remove from whitelist
  if (permission && hasPermission(permission.permission, 'join')) {
    const server = getServer(serverId);
    const user = getUser(userId);

    if (server && user && user.minecraftUsername && user.minecraftUuid) {
      whitelistSyncService
        .removeUser(server, user.minecraftUsername, user.minecraftUuid)
        .catch((err) => logger.error({ err, serverId, userId }, 'Whitelist sync failed'));
    }
  }
}
```

**Note**: This assumes Epic 3 is implemented and users have `minecraftUsername` and `minecraftUuid` fields. If Epic 3 is not yet implemented, whitelist sync is a no-op.

**Files created**: `packages/backend/src/services/whitelist-sync.ts`
**Files modified**: `packages/backend/src/models/server-permission.ts`

---

## Phase 7D: Backend — Community Server API

### 7D.1: List shared servers

Create `packages/backend/src/routes/community-servers.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth } from '../middleware/auth.js'; // Epic 5
import { getServerPermission } from '../models/server-permission.js';
import { serverManager } from '../services/server-manager.js';
import type { SharedServerInfo } from '@mc-server-manager/shared';

const router = Router();

/**
 * GET /api/community/servers
 * List all shared servers visible to the authenticated user.
 */
router.get('/', requireAuth, (req, res) => {
  const userId = req.userId!;

  const rows = db
    .prepare(
      `SELECT s.id, s.shared_name, s.shared_description, s.version, s.type, s.shared_at, s.max_players
       FROM servers s
       WHERE s.shared = 1
       ORDER BY s.shared_at DESC`
    )
    .all() as any[];

  const servers: SharedServerInfo[] = rows.map((row) => {
    const permission = getServerPermission(row.id, userId);
    const process = serverManager.getServer(row.id);

    return {
      id: row.id,
      sharedName: row.shared_name,
      sharedDescription: row.shared_description,
      status: process?.status ?? 'stopped',
      playerCount: process?.players.length ?? 0,
      maxPlayers: row.max_players,
      version: row.version,
      type: row.type,
      onlinePlayers: process?.players ?? [],
      myPermission: permission?.permission ?? null,
      sharedAt: row.shared_at,
    };
  });

  res.json(servers);
});

/**
 * GET /api/community/servers/:id
 * Get detailed info about a shared server.
 */
router.get('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.userId!;

  const row = db
    .prepare(
      `SELECT id, shared_name, shared_description, version, type, shared_at, max_players
       FROM servers
       WHERE id = ? AND shared = 1`
    )
    .get(id) as any;

  if (!row) {
    return res.status(404).json({ error: 'Server not found or not shared' });
  }

  const permission = getServerPermission(id, userId);
  const process = serverManager.getServer(id);

  const server: SharedServerInfo = {
    id: row.id,
    sharedName: row.shared_name,
    sharedDescription: row.shared_description,
    status: process?.status ?? 'stopped',
    playerCount: process?.players.length ?? 0,
    maxPlayers: row.max_players,
    version: row.version,
    type: row.type,
    onlinePlayers: process?.players ?? [],
    myPermission: permission?.permission ?? null,
    sharedAt: row.shared_at,
  };

  res.json(server);
});

export default router;
```

### 7D.2: Join server endpoint

Add to `packages/backend/src/routes/community-servers.ts`:

```typescript
import { requireServerPermission } from '../middleware/server-permission.js';
import type { JoinServerResponse } from '@mc-server-manager/shared';

/**
 * POST /api/community/servers/:id/join
 * Get connection info for joining a server.
 * Requires "join" permission.
 */
router.post('/:id/join', requireAuth, requireServerPermission('join'), (req, res) => {
  const { id } = req.params;

  const row = db
    .prepare('SELECT port, version FROM servers WHERE id = ?')
    .get(id) as any;

  if (!row) {
    return res.status(404).json({ error: 'Server not found' });
  }

  // TODO: If Epic 3 is implemented, include mod list for auto-sync (Epic 9)
  const response: JoinServerResponse = {
    address: 'localhost', // TODO: Use actual server host from settings
    port: row.port,
    version: row.version,
    requiresMods: false, // TODO: Check if server has mods (Epic 2)
  };

  res.json(response);
});
```

### 7D.3: Server sharing settings

Create `packages/backend/src/routes/server-sharing.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireServerPermission } from '../middleware/server-permission.js';
import { whitelistSyncService } from '../services/whitelist-sync.js';
import { getServer } from '../models/server.js';
import { listServerPermissions } from '../models/server-permission.js';
import { getUser } from '../models/user.js';

const router = Router();

const sharingSettingsSchema = z.object({
  shared: z.boolean(),
  sharedName: z.string().min(1).max(100).optional(),
  sharedDescription: z.string().max(500).optional().nullable(),
});

/**
 * PUT /api/servers/:id/sharing
 * Update server sharing settings.
 * Requires "admin" permission.
 */
router.put('/:id/sharing', requireAuth, requireServerPermission('admin'), (req, res) => {
  const { id } = req.params;
  const body = sharingSettingsSchema.parse(req.body);

  const server = getServer(id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const sharedAt = body.shared ? Date.now() : null;

  db.prepare(
    `UPDATE servers
     SET shared = ?, shared_name = ?, shared_description = ?, shared_at = ?
     WHERE id = ?`
  ).run(
    body.shared ? 1 : 0,
    body.sharedName ?? server.name,
    body.sharedDescription ?? null,
    sharedAt,
    id
  );

  // If enabling sharing, sync whitelist for all users with "join" permission
  if (body.shared) {
    const permissions = listServerPermissions(id);
    const authorizedUsers = permissions
      .filter((p) => p.permission === 'join' || p.permission === 'manage' || p.permission === 'admin')
      .map((p) => {
        const user = getUser(p.userId);
        return user && user.minecraftUsername && user.minecraftUuid
          ? { username: user.minecraftUsername, uuid: user.minecraftUuid }
          : null;
      })
      .filter((u): u is { username: string; uuid: string } => u !== null);

    whitelistSyncService.syncAll(server, authorizedUsers).catch((err) => {
      logger.error({ err, serverId: id }, 'Failed to sync whitelist on share');
    });
  }

  res.json({ success: true });
});

export default router;
```

### 7D.4: Permission management endpoints

Add to `packages/backend/src/routes/server-sharing.ts`:

```typescript
import {
  grantPermission,
  revokePermission,
  listServerPermissions,
} from '../models/server-permission.js';
import type { GrantPermissionRequest } from '@mc-server-manager/shared';

const grantPermissionSchema = z.object({
  userId: z.string(),
  permission: z.enum(['view', 'join', 'manage', 'admin']),
});

/**
 * GET /api/servers/:id/permissions
 * List all permissions for a server.
 * Requires "admin" permission.
 */
router.get('/:id/permissions', requireAuth, requireServerPermission('admin'), (req, res) => {
  const { id } = req.params;
  const permissions = listServerPermissions(id);
  res.json(permissions);
});

/**
 * PUT /api/servers/:id/permissions/:userId
 * Grant or update a user's permission for a server.
 * Requires "admin" permission.
 */
router.put(
  '/:id/permissions/:userId',
  requireAuth,
  requireServerPermission('admin'),
  (req, res) => {
    const { id, userId } = req.params;
    const body = grantPermissionSchema.parse(req.body);

    const permission = grantPermission(id, userId, body.permission, req.userId!);
    res.json(permission);
  }
);

/**
 * DELETE /api/servers/:id/permissions/:userId
 * Revoke a user's permission for a server.
 * Requires "admin" permission.
 */
router.delete(
  '/:id/permissions/:userId',
  requireAuth,
  requireServerPermission('admin'),
  (req, res) => {
    const { id, userId } = req.params;
    revokePermission(id, userId);
    res.json({ success: true });
  }
);
```

### 7D.5: Wire routes into Express app

Modify `packages/backend/src/index.ts`:

```typescript
import communityServersRouter from './routes/community-servers.js';
import serverSharingRouter from './routes/server-sharing.js';

// ... existing routes ...

app.use('/api/community/servers', communityServersRouter);
app.use('/api/servers', serverSharingRouter); // Extends existing /api/servers routes
```

**Files created**: `packages/backend/src/routes/community-servers.ts`, `packages/backend/src/routes/server-sharing.ts`
**Files modified**: `packages/backend/src/index.ts`

---

## Phase 7E: Frontend — Server Browser UI

### 7E.1: API client for community servers

Create `packages/frontend/src/api/community-servers.ts`:

```typescript
import { BASE_URL } from './client';
import type {
  SharedServerInfo,
  JoinServerResponse,
  ServerPermission,
  ServerSharingSettings,
  GrantPermissionRequest,
} from '@mc-server-manager/shared';

export async function listSharedServers(): Promise<SharedServerInfo[]> {
  const res = await fetch(`${BASE_URL}/api/community/servers`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch shared servers');
  return res.json();
}

export async function getSharedServer(id: string): Promise<SharedServerInfo> {
  const res = await fetch(`${BASE_URL}/api/community/servers/${id}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch server');
  return res.json();
}

export async function joinServer(id: string): Promise<JoinServerResponse> {
  const res = await fetch(`${BASE_URL}/api/community/servers/${id}/join`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to join server');
  return res.json();
}

export async function updateSharingSettings(
  id: string,
  settings: ServerSharingSettings
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/servers/${id}/sharing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update sharing settings');
}

export async function listServerPermissions(id: string): Promise<ServerPermission[]> {
  const res = await fetch(`${BASE_URL}/api/servers/${id}/permissions`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch permissions');
  return res.json();
}

export async function grantServerPermission(
  serverId: string,
  userId: string,
  permission: GrantPermissionRequest['permission']
): Promise<ServerPermission> {
  const res = await fetch(`${BASE_URL}/api/servers/${serverId}/permissions/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ userId, permission }),
  });
  if (!res.ok) throw new Error('Failed to grant permission');
  return res.json();
}

export async function revokeServerPermission(serverId: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/servers/${serverId}/permissions/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to revoke permission');
}
```

### 7E.2: Server browser page

Create `packages/frontend/src/pages/ServerBrowser.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { listSharedServers } from '../api/community-servers';
import { ServerCard } from '../components/ServerCard';
import type { SharedServerInfo } from '@mc-server-manager/shared';
import { Loader2 } from 'lucide-react';

export default function ServerBrowser() {
  const [servers, setServers] = useState<SharedServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSharedServers()
      .then(setServers)
      .catch((err) => console.error('Failed to load shared servers:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-lg">No shared servers available</p>
        <p className="text-sm mt-2">Ask your community admin to share a server</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Community Servers</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {servers.map((server) => (
          <ServerCard key={server.id} server={server} />
        ))}
      </div>
    </div>
  );
}
```

### 7E.3: Server card component

Create `packages/frontend/src/components/ServerCard.tsx`:

```typescript
import { useState } from 'react';
import { joinServer } from '../api/community-servers';
import { Users, Play, Settings, Eye } from 'lucide-react';
import { toast } from 'sonner';
import type { SharedServerInfo } from '@mc-server-manager/shared';
import { isTauri } from '../utils/tauri';

interface ServerCardProps {
  server: SharedServerInfo;
}

export function ServerCard({ server }: ServerCardProps) {
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!server.myPermission || server.myPermission === 'view') {
      toast.error('You do not have permission to join this server');
      return;
    }

    setJoining(true);
    try {
      const info = await joinServer(server.id);

      if (isTauri()) {
        // TODO: Epic 3 — Tauri IPC to launch MC client
        toast.success('Launching Minecraft...');
      } else {
        // Fallback: Copy to clipboard
        const address = `${info.address}:${info.port}`;
        await navigator.clipboard.writeText(address);
        toast.success(`Server address copied: ${address}`);
      }
    } catch (err) {
      toast.error('Failed to join server');
    } finally {
      setJoining(false);
    }
  };

  const statusColor = {
    running: 'bg-green-500',
    starting: 'bg-yellow-500',
    stopping: 'bg-orange-500',
    stopped: 'bg-slate-500',
    crashed: 'bg-red-500',
  }[server.status];

  const canJoin = server.myPermission && server.myPermission !== 'view';
  const canManage = server.myPermission === 'manage' || server.myPermission === 'admin';

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{server.sharedName}</h3>
          <p className="text-sm text-slate-400">
            {server.type} {server.version}
          </p>
        </div>
        <div className={`w-3 h-3 rounded-full ${statusColor}`} title={server.status} />
      </div>

      {server.sharedDescription && (
        <p className="text-sm text-slate-300 mb-3 line-clamp-2">{server.sharedDescription}</p>
      )}

      <div className="flex items-center gap-4 text-sm text-slate-400 mb-4">
        <div className="flex items-center gap-1">
          <Users className="w-4 h-4" />
          <span>
            {server.playerCount}/{server.maxPlayers}
          </span>
        </div>
        {server.onlinePlayers.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs">{server.onlinePlayers.join(', ')}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {canJoin && (
          <button
            onClick={handleJoin}
            disabled={joining || server.status !== 'running'}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition"
          >
            <Play className="w-4 h-4" />
            {joining ? 'Joining...' : 'Join'}
          </button>
        )}
        {canManage && (
          <button
            onClick={() => {
              /* TODO: Navigate to server management page */
            }}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition"
            title="Manage server"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
        {!canJoin && !canManage && (
          <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 text-slate-400 rounded">
            <Eye className="w-4 h-4" />
            View Only
          </div>
        )}
      </div>
    </div>
  );
}
```

### 7E.4: Add route to app

Modify `packages/frontend/src/App.tsx`:

```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ServerBrowser from './pages/ServerBrowser';
// ... existing imports ...

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Existing routes */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers/:id" element={<ServerDetail />} />

        {/* New route */}
        <Route path="/community/servers" element={<ServerBrowser />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Files created**: `packages/frontend/src/api/community-servers.ts`, `packages/frontend/src/pages/ServerBrowser.tsx`, `packages/frontend/src/components/ServerCard.tsx`
**Files modified**: `packages/frontend/src/App.tsx`

---

## Phase 7F: Frontend — Server Sharing Settings

### 7F.1: Sharing settings panel

Create `packages/frontend/src/components/ServerSharingSettings.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { updateSharingSettings, listServerPermissions } from '../api/community-servers';
import { toast } from 'sonner';
import { Globe, Lock } from 'lucide-react';
import type { ServerSharingSettings, ServerPermission } from '@mc-server-manager/shared';

interface ServerSharingSettingsProps {
  serverId: string;
  currentSettings: ServerSharingSettings;
  onUpdate: () => void;
}

export function ServerSharingSettingsPanel({
  serverId,
  currentSettings,
  onUpdate,
}: ServerSharingSettingsProps) {
  const [settings, setSettings] = useState(currentSettings);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<ServerPermission[]>([]);

  useEffect(() => {
    if (settings.shared) {
      listServerPermissions(serverId)
        .then(setPermissions)
        .catch((err) => console.error('Failed to load permissions:', err));
    }
  }, [serverId, settings.shared]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSharingSettings(serverId, settings);
      toast.success('Sharing settings updated');
      onUpdate();
    } catch (err) {
      toast.error('Failed to update sharing settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-semibold text-slate-100 mb-4">Sharing Settings</h2>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="shared"
            checked={settings.shared}
            onChange={(e) => setSettings({ ...settings, shared: e.target.checked })}
            className="w-4 h-4"
          />
          <label htmlFor="shared" className="text-slate-200 flex items-center gap-2">
            {settings.shared ? (
              <>
                <Globe className="w-4 h-4 text-green-500" />
                Shared with community
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-slate-500" />
                Private
              </>
            )}
          </label>
        </div>

        {settings.shared && (
          <>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Display Name</label>
              <input
                type="text"
                value={settings.sharedName}
                onChange={(e) => setSettings({ ...settings, sharedName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-100"
                placeholder="Server name visible to members"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <textarea
                value={settings.sharedDescription ?? ''}
                onChange={(e) =>
                  setSettings({ ...settings, sharedDescription: e.target.value || null })
                }
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-100 h-24 resize-none"
                placeholder="Optional description for the server browser"
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                Permissions ({permissions.length})
              </h3>
              <p className="text-xs text-slate-500 mb-2">
                Manage who can view, join, and control this server in the Permissions tab.
              </p>
            </div>
          </>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white rounded transition"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
```

### 7F.2: Permission management UI

Create `packages/frontend/src/components/ServerPermissionsManager.tsx`:

```typescript
import { useState, useEffect } from 'react';
import {
  listServerPermissions,
  grantServerPermission,
  revokeServerPermission,
} from '../api/community-servers';
import { toast } from 'sonner';
import { UserPlus, Trash2 } from 'lucide-react';
import type { ServerPermission, ServerPermissionLevel } from '@mc-server-manager/shared';

interface ServerPermissionsManagerProps {
  serverId: string;
}

export function ServerPermissionsManager({ serverId }: ServerPermissionsManagerProps) {
  const [permissions, setPermissions] = useState<ServerPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPermissions = () => {
    listServerPermissions(serverId)
      .then(setPermissions)
      .catch((err) => console.error('Failed to load permissions:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPermissions();
  }, [serverId]);

  const handleRevoke = async (userId: string) => {
    try {
      await revokeServerPermission(serverId, userId);
      toast.success('Permission revoked');
      loadPermissions();
    } catch (err) {
      toast.error('Failed to revoke permission');
    }
  };

  const handleGrant = async (userId: string, permission: ServerPermissionLevel) => {
    try {
      await grantServerPermission(serverId, userId, permission);
      toast.success('Permission granted');
      loadPermissions();
    } catch (err) {
      toast.error('Failed to grant permission');
    }
  };

  const permissionBadgeColor = (level: ServerPermissionLevel) => {
    switch (level) {
      case 'view':
        return 'bg-slate-600 text-slate-200';
      case 'join':
        return 'bg-blue-600 text-blue-100';
      case 'manage':
        return 'bg-purple-600 text-purple-100';
      case 'admin':
        return 'bg-red-600 text-red-100';
    }
  };

  if (loading) {
    return <div className="text-slate-400">Loading permissions...</div>;
  }

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-100">Permissions</h2>
        <button
          onClick={() => {
            /* TODO: Open "Add User" modal */
          }}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {permissions.length === 0 ? (
        <p className="text-slate-400 text-sm">No permissions set. Add users to share this server.</p>
      ) : (
        <div className="space-y-2">
          {permissions.map((perm) => (
            <div
              key={perm.id}
              className="flex items-center justify-between p-3 bg-slate-900 rounded border border-slate-700"
            >
              <div>
                <p className="text-slate-200 font-medium">{perm.userId}</p>
                <span
                  className={`inline-block px-2 py-1 text-xs rounded mt-1 ${permissionBadgeColor(
                    perm.permission
                  )}`}
                >
                  {perm.permission}
                </span>
              </div>
              <button
                onClick={() => handleRevoke(perm.userId)}
                className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition"
                title="Revoke permission"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Files created**: `packages/frontend/src/components/ServerSharingSettings.tsx`, `packages/frontend/src/components/ServerPermissionsManager.tsx`

---

## Phase 7G: WebSocket Events for Live Updates

### 7G.1: Broadcast server status to community members

Modify `packages/backend/src/services/server-manager.ts` to broadcast status changes to all users with "view" permission:

```typescript
import { listServerPermissions } from '../models/server-permission.js';
import { wsServer } from '../websocket.js'; // Existing WS server

// In ServerManager.start(), stop(), etc.:
private broadcastToAuthorizedUsers(serverId: string, event: any) {
  const permissions = listServerPermissions(serverId);
  const authorizedUserIds = permissions.map((p) => p.userId);

  // Broadcast to all connected clients with permission
  wsServer.clients.forEach((client) => {
    if (client.userId && authorizedUserIds.includes(client.userId)) {
      client.send(JSON.stringify(event));
    }
  });
}

// Call after status changes:
this.broadcastToAuthorizedUsers(serverId, {
  type: 'status',
  serverId,
  status: process.status,
});
```

### 7G.2: Frontend: Subscribe to shared server updates

Modify `packages/frontend/src/stores/serverStore.ts` to handle community server events:

```typescript
import { wsClient } from '../api/ws';

// Subscribe to shared server updates
wsClient.on('status', (data) => {
  // Update server status in store
  // This works for both owned and shared servers
});

wsClient.on('stats', (data) => {
  // Update player count, online players
});
```

**Files modified**: `packages/backend/src/services/server-manager.ts`, `packages/frontend/src/stores/serverStore.ts`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **7A** (database & types) | ~2h | Schema migration, shared types |
| 2 | **7B** (permission system) | ~3h | Permission model, middleware |
| 3 | **7C** (whitelist sync) | ~3h | Whitelist sync service, auto-add/remove |
| 4 | **7D** (backend API) | ~4h | Community server routes, sharing settings, permissions |
| 5 | **7E** (server browser UI) | ~4h | Server browser page, server cards, join flow |
| 6 | **7F** (sharing settings UI) | ~3h | Sharing settings panel, permission manager |
| 7 | **7G** (live updates) | ~1h | WebSocket events for shared servers |

**Total: ~20 hours**

---

## Complete File Change Summary

### New Files (12)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/migrations/007_shared_servers.sql` | 7A | Database schema for sharing and permissions |
| `packages/backend/src/models/server-permission.ts` | 7B | Permission CRUD, hierarchy logic |
| `packages/backend/src/middleware/server-permission.ts` | 7B | Express middleware for permission checks |
| `packages/backend/src/services/whitelist-sync.ts` | 7C | Whitelist auto-sync service |
| `packages/backend/src/routes/community-servers.ts` | 7D | Community server browser API |
| `packages/backend/src/routes/server-sharing.ts` | 7D | Sharing settings and permission management API |
| `packages/frontend/src/api/community-servers.ts` | 7E | API client for shared servers |
| `packages/frontend/src/pages/ServerBrowser.tsx` | 7E | Server browser page |
| `packages/frontend/src/components/ServerCard.tsx` | 7E | Server card component |
| `packages/frontend/src/components/ServerSharingSettings.tsx` | 7F | Sharing settings panel |
| `packages/frontend/src/components/ServerPermissionsManager.tsx` | 7F | Permission management UI |

### Modified Files (6)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 7A | Add shared server types, permission types |
| `packages/backend/src/index.ts` | 7D | Wire community server routes |
| `packages/backend/src/services/server-manager.ts` | 7G | Broadcast status to authorized users |
| `packages/frontend/src/App.tsx` | 7E | Add server browser route |
| `packages/frontend/src/stores/serverStore.ts` | 7G | Handle shared server WebSocket events |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Whitelist sync fails silently if MC username not linked | Require Epic 3 (MC auth) before enabling sharing. Show clear error in UI if user lacks MC account. Gracefully degrade: allow sharing but warn that whitelist is manual. |
| Permission escalation via race conditions | Use database UNIQUE constraint on (server_id, user_id). Validate permission hierarchy in middleware. Audit log all permission changes (future). |
| Shared console exposes sensitive data (e.g., player IPs) | Gate console access behind "admin" permission. Consider filtering sensitive log lines (future). Document security implications. |

### Medium

| Risk | Mitigation |
|------|------------|
| One-click join without Epic 3 is confusing | Show clear UI state: "Copy address" button if Epic 3 not available. Tooltip explains one-click join requires client launcher. |
| Whitelist.json corruption if edited manually | Validate JSON before writing. Keep backup. Log errors. Provide "Repair whitelist" admin tool (future). |
| Server owner accidentally shares server publicly | Require explicit "Share" toggle. Show warning dialog: "This will make the server visible to all community members." |

### Low

| Risk | Mitigation |
|------|------------|
| Player count/status out of sync | WebSocket events already handle this. Fallback: poll every 30s. |
| Permission UI doesn't show user's display name | Fetch user details from Epic 5 user API. Cache in frontend store. |

---

## Testing Checklist

1. **Database migration**: Run migration, verify schema changes, rollback test
2. **Permission hierarchy**: Grant "join" → user can join but not manage. Grant "admin" → user can do everything.
3. **Whitelist sync**: Grant "join" permission → user added to whitelist.json and runtime whitelist. Revoke → removed.
4. **Server browser**: List shows only shared servers. Status, player count, online players update in real-time.
5. **One-click join (with Epic 3)**: Click "Join" → MC client launches with correct server address.
6. **One-click join (without Epic 3)**: Click "Join" → address copied to clipboard, toast notification shown.
7. **Sharing settings**: Toggle "Share" → server appears in browser. Edit name/description → changes reflected.
8. **Permission management**: Add user → appears in list. Change permission level → updates. Revoke → removed.
9. **Shared console**: User with "admin" permission can view console. User with "manage" cannot.
10. **WebSocket events**: Start/stop server → status updates in browser for all authorized users.
11. **Security**: User without permission cannot access `/api/community/servers/:id/join` (403 error).
12. **Edge case**: Share server with no permissions set → no users can join (expected).

---

## Future Enhancements (Not in Scope)

- **Public server directory**: Servers can be listed publicly (not just to community members)
- **Server tags/categories**: Filter servers by game mode, modpack, etc.
- **Server favorites**: Members can bookmark servers
- **Join history**: Track which servers a user has joined
- **Server analytics**: Track player activity, peak hours, etc.
- **Permission templates**: "Moderator", "VIP", etc. presets
- **Audit log**: Track all permission changes, sharing toggles
- **Server invites**: Generate one-time invite links for specific servers
- **Cross-community servers**: Join servers from other communities (federated model)

---

## Dependencies on Other Epics

### Required
- **Epic 5 (Multi-User)**: User accounts, authentication, `users` table

### Optional (Graceful Degradation)
- **Epic 3 (Client Launcher)**: One-click join auto-launches MC client. Without Epic 3, users copy-paste the address.
- **Epic 2 (Server Mods)**: Detect if server requires mods, show in browser. Without Epic 2, `requiresMods` is always false.
- **Epic 9 (Mod Sync)**: Auto-sync mods when joining. Without Epic 9, users must manually install mods.

### Enables
- **Epic 9 (Mod Sync)**: Shared servers provide the mod list for auto-sync on join.
