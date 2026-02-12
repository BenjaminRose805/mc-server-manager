import { getDb } from "../services/database.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;
const CLEANUP_DAYS = 7;

export function recordLoginAttempt(
  username: string,
  ipAddress: string,
  success: boolean,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)",
  ).run(username, ipAddress, success ? 1 : 0);
}

export function isLockedOut(username: string, ipAddress: string): boolean {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare(
      "SELECT COUNT(*) as count FROM login_attempts WHERE (username = ? OR ip_address = ?) AND success = 0 AND datetime(attempted_at) > datetime(?)",
    )
    .get(username, ipAddress, cutoff) as { count: number } | undefined;

  return result ? result.count >= MAX_FAILED_ATTEMPTS : false;
}

export function clearLoginAttempts(username: string): void {
  const db = getDb();
  db.prepare("DELETE FROM login_attempts WHERE username = ?").run(username);
}

export function cleanupOldAttempts(): number {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare(
      "DELETE FROM login_attempts WHERE datetime(attempted_at) < datetime(?)",
    )
    .run(cutoff) as { changes: number };

  return result.changes;
}
