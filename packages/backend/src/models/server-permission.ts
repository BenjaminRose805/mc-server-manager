import type { ServerPermission } from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";

interface PermissionRow {
  id: string;
  server_id: string;
  user_id: string;
  can_view: number;
  can_start: number;
  can_console: number;
  can_edit: number;
  can_join: number;
  created_at: string;
}

function rowToPermission(row: PermissionRow): ServerPermission {
  return {
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    canView: row.can_view === 1,
    canStart: row.can_start === 1,
    canConsole: row.can_console === 1,
    canEdit: row.can_edit === 1,
    canJoin: row.can_join === 1,
    createdAt: row.created_at,
  };
}

export function getPermissionsForServer(
  serverId: string,
): (ServerPermission & { username: string; displayName: string })[] {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT sp.*, u.username, u.display_name
    FROM server_permissions sp
    JOIN users u ON sp.user_id = u.id
    WHERE sp.server_id = ?
  `,
    )
    .all(serverId) as (PermissionRow & {
    username: string;
    display_name: string;
  })[];

  return rows.map((row) => ({
    ...rowToPermission(row),
    username: row.username,
    displayName: row.display_name,
  }));
}

export function getPermission(
  serverId: string,
  userId: string,
): ServerPermission | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT * FROM server_permissions
    WHERE server_id = ? AND user_id = ?
  `,
    )
    .get(serverId, userId) as PermissionRow | undefined;

  return row ? rowToPermission(row) : null;
}

export function upsertPermission(data: {
  id: string;
  serverId: string;
  userId: string;
  canView: boolean;
  canStart: boolean;
  canConsole: boolean;
  canEdit: boolean;
  canJoin: boolean;
}): ServerPermission {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO server_permissions
      (id, server_id, user_id, can_view, can_start, can_console, can_edit, can_join)
    VALUES (@id, @serverId, @userId, @canView, @canStart, @canConsole, @canEdit, @canJoin)
  `);

  stmt.run({
    id: data.id,
    serverId: data.serverId,
    userId: data.userId,
    canView: data.canView ? 1 : 0,
    canStart: data.canStart ? 1 : 0,
    canConsole: data.canConsole ? 1 : 0,
    canEdit: data.canEdit ? 1 : 0,
    canJoin: data.canJoin ? 1 : 0,
  });

  const row = db
    .prepare("SELECT * FROM server_permissions WHERE id = ?")
    .get(data.id) as PermissionRow;
  return rowToPermission(row);
}

export function deletePermission(serverId: string, userId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM server_permissions WHERE server_id = ? AND user_id = ?",
  ).run(serverId, userId);
}

export function getViewableServerIds(userId: string): string[] {
  const db = getDb();

  const rows = db
    .prepare(
      `
    SELECT server_id FROM server_permissions
    WHERE user_id = ? AND can_view = 1
  `,
    )
    .all(userId) as { server_id: string }[];

  return rows.map((row) => row.server_id);
}
