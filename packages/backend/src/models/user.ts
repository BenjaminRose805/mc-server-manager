import type { User, UserRole } from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  password_hash: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  minecraft_username: string | null;
  minecraft_uuid: string | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role as UserRole,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    minecraftUsername: row.minecraft_username,
    minecraftUuid: row.minecraft_uuid,
  };
}

export function createUser(data: {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
}): User {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role)
    VALUES (@id, @username, @displayName, @passwordHash, @role)
  `);

  stmt.run({
    id: data.id,
    username: data.username,
    displayName: data.displayName,
    passwordHash: data.passwordHash,
    role: data.role,
  });

  return getUserById(data.id)!;
}

export function getUserById(id: string): User | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  if (!row) {
    return null;
  }
  return rowToUser(row);
}

export function getUserByUsername(username: string): User | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserRow | undefined;
  if (!row) {
    return null;
  }
  return rowToUser(row);
}

export function listUsers(filters?: {
  role?: UserRole;
  active?: boolean;
}): User[] {
  const db = getDb();

  const whereClauses: string[] = [];
  const values: Record<string, unknown> = {};

  if (filters?.role !== undefined) {
    whereClauses.push("role = @role");
    values.role = filters.role;
  }
  if (filters?.active !== undefined) {
    whereClauses.push("is_active = @active");
    values.active = filters.active ? 1 : 0;
  }

  const whereClause =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
    SELECT id, username, display_name, avatar_url, role, is_active, created_at, updated_at, last_login_at, minecraft_username, minecraft_uuid
    FROM users
    ${whereClause}
    ORDER BY created_at DESC
  `;

  const rows = db.prepare(sql).all(values) as Omit<UserRow, "password_hash">[];
  return rows.map((row) => rowToUser({ ...row, password_hash: "" }));
}

export function updateUserRole(id: string, role: UserRole): void {
  const db = getDb();

  db.prepare(
    `
    UPDATE users
    SET role = @role, updated_at = datetime('now')
    WHERE id = @id
  `,
  ).run({ id, role });
}

export function deactivateUser(id: string): void {
  const db = getDb();

  db.prepare(
    `
    UPDATE users
    SET is_active = 0, updated_at = datetime('now')
    WHERE id = @id
  `,
  ).run({ id });
}

export function updateUserProfile(
  id: string,
  data: {
    displayName?: string;
    avatarUrl?: string;
    passwordHash?: string;
    minecraftUsername?: string;
    minecraftUuid?: string;
  },
): void {
  const db = getDb();

  const setClauses: string[] = [];
  const values: Record<string, unknown> = { id };

  if (data.displayName !== undefined) {
    setClauses.push("display_name = @displayName");
    values.displayName = data.displayName;
  }
  if (data.avatarUrl !== undefined) {
    setClauses.push("avatar_url = @avatarUrl");
    values.avatarUrl = data.avatarUrl;
  }
  if (data.passwordHash !== undefined) {
    setClauses.push("password_hash = @passwordHash");
    values.passwordHash = data.passwordHash;
  }
  if (data.minecraftUsername !== undefined) {
    setClauses.push("minecraft_username = @minecraftUsername");
    values.minecraftUsername = data.minecraftUsername;
  }
  if (data.minecraftUuid !== undefined) {
    setClauses.push("minecraft_uuid = @minecraftUuid");
    values.minecraftUuid = data.minecraftUuid;
  }

  if (setClauses.length === 0) {
    return;
  }

  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE users SET ${setClauses.join(", ")} WHERE id = @id`;
  db.prepare(sql).run(values);
}

export function updateLastLogin(id: string): void {
  const db = getDb();

  db.prepare(
    `
    UPDATE users
    SET last_login_at = datetime('now')
    WHERE id = @id
  `,
  ).run({ id });
}

export function countUsers(): number {
  const db = getDb();
  const result = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
    count: number;
  };
  return result.count;
}

export function getUserWithPasswordHash(
  id: string,
): (User & { passwordHash: string }) | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  if (!row) {
    return null;
  }
  return {
    ...rowToUser(row),
    passwordHash: row.password_hash,
  };
}

export function getUserByUsernameWithHash(
  username: string,
): (User & { passwordHash: string }) | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserRow | undefined;
  if (!row) {
    return null;
  }
  return {
    ...rowToUser(row),
    passwordHash: row.password_hash,
  };
}
