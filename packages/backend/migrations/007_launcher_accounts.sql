CREATE TABLE launcher_accounts (
  id            TEXT PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  account_type  TEXT NOT NULL DEFAULT 'msa',
  last_used     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
