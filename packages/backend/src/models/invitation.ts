import type { Invitation, UserRole } from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";

interface InvitationRow {
  id: string;
  code: string;
  created_by: string;
  max_uses: number;
  uses: number;
  role: string;
  expires_at: string | null;
  created_at: string;
}

function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    maxUses: row.max_uses,
    uses: row.uses,
    role: row.role as UserRole,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function createInvitation(data: {
  id: string;
  code: string;
  createdBy: string;
  maxUses: number;
  role: UserRole;
  expiresAt: string | null;
}): Invitation {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO invitations (id, code, created_by, max_uses, role, expires_at)
    VALUES (@id, @code, @createdBy, @maxUses, @role, @expiresAt)
  `);

  stmt.run({
    id: data.id,
    code: data.code,
    createdBy: data.createdBy,
    maxUses: data.maxUses,
    role: data.role,
    expiresAt: data.expiresAt,
  });

  const row = db
    .prepare("SELECT * FROM invitations WHERE id = ?")
    .get(data.id) as InvitationRow;
  return rowToInvitation(row);
}

export function getInvitationByCode(code: string): Invitation | null {
  const db = getDb();

  const row = db
    .prepare(
      `
    SELECT * FROM invitations
    WHERE code = ?
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      AND (max_uses = 0 OR uses < max_uses)
  `,
    )
    .get(code) as InvitationRow | undefined;

  return row ? rowToInvitation(row) : null;
}

export function listInvitations(): Invitation[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM invitations ORDER BY created_at DESC")
    .all() as InvitationRow[];
  return rows.map(rowToInvitation);
}

export function deleteInvitation(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM invitations WHERE id = ?").run(id);
}

export function incrementInvitationUses(id: string): void {
  const db = getDb();
  db.prepare("UPDATE invitations SET uses = uses + 1 WHERE id = ?").run(id);
}
