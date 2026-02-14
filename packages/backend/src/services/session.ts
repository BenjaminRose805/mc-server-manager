import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { Session } from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";
import { logger } from "../utils/logger.js";

const REFRESH_TOKEN_EXPIRY_DAYS = 30;

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    deviceInfo: row.device_info,
    ipAddress: row.ip_address,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  userId: string,
  refreshToken: string,
  deviceInfo: string | null,
  ipAddress: string | null,
): Session {
  const db = getDb();
  const id = nanoid();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  db.prepare(
    `
    INSERT INTO sessions (id, user_id, refresh_token_hash, device_info, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, userId, refreshTokenHash, deviceInfo, ipAddress, expiresAt);

  logger.info({ userId, sessionId: id }, "Session created");

  const row = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as SessionRow;
  return rowToSession(row);
}

export function validateRefreshToken(
  token: string,
): (Session & { userId: string }) | null {
  const db = getDb();
  const tokenHash = hashRefreshToken(token);

  const row = db
    .prepare(
      `
    SELECT * FROM sessions
    WHERE refresh_token_hash = ?
      AND datetime(expires_at) > datetime('now')
  `,
    )
    .get(tokenHash) as SessionRow | undefined;

  if (!row) {
    return null;
  }

  db.prepare(
    `
    UPDATE sessions
    SET last_used_at = datetime('now')
    WHERE id = ?
  `,
  ).run(row.id);

  const updatedRow = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(row.id) as SessionRow;
  return { ...rowToSession(updatedRow), userId: updatedRow.user_id };
}

export function revokeSession(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  logger.info({ sessionId }, "Session revoked");
}

export function revokeAllUserSessions(userId: string): number {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM sessions WHERE user_id = ?")
    .run(userId);
  logger.info(
    { userId, revokedCount: result.changes },
    "All user sessions revoked",
  );
  return result.changes;
}

export function cleanupExpiredSessions(): number {
  const db = getDb();
  const result = db
    .prepare(
      `
    DELETE FROM sessions
    WHERE datetime(expires_at) <= datetime('now')
  `,
    )
    .run();
  logger.info({ cleanedUp: result.changes }, "Expired sessions cleaned up");
  return result.changes;
}
