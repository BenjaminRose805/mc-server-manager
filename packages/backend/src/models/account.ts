import type { LauncherAccount } from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";
import { NotFoundError } from "../utils/errors.js";

interface AccountRow {
  id: string;
  uuid: string;
  username: string;
  account_type: string;
  last_used: string | null;
  created_at: string;
}

function rowToAccount(row: AccountRow): LauncherAccount {
  return {
    id: row.id,
    uuid: row.uuid,
    username: row.username,
    accountType: row.account_type as "msa" | "legacy",
    lastUsed: row.last_used,
    createdAt: row.created_at,
  };
}

export function getAllAccounts(): LauncherAccount[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM launcher_accounts ORDER BY last_used DESC NULLS LAST, created_at DESC",
    )
    .all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function getAccountById(id: string): LauncherAccount {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM launcher_accounts WHERE id = ?")
    .get(id) as AccountRow | undefined;
  if (!row) {
    throw new NotFoundError("Account", id);
  }
  return rowToAccount(row);
}

export interface CreateAccountParams {
  id: string;
  uuid: string;
  username: string;
  accountType: string;
}

export function createAccount(params: CreateAccountParams): LauncherAccount {
  const db = getDb();

  db.prepare(
    `
    INSERT INTO launcher_accounts (id, uuid, username, account_type)
    VALUES (@id, @uuid, @username, @accountType)
  `,
  ).run({
    id: params.id,
    uuid: params.uuid,
    username: params.username,
    accountType: params.accountType,
  });

  return getAccountById(params.id);
}

export function deleteAccount(id: string): void {
  const db = getDb();
  getAccountById(id);
  db.prepare("DELETE FROM launcher_accounts WHERE id = ?").run(id);
}

export function updateAccountLastUsed(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE launcher_accounts SET last_used = datetime('now') WHERE id = ?",
  ).run(id);
}
