CREATE TABLE modpacks (
  id              TEXT PRIMARY KEY,
  server_id       TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  version_id      TEXT NOT NULL,
  version_number  TEXT NOT NULL DEFAULT '',
  mc_version      TEXT NOT NULL,
  loader_type     TEXT NOT NULL,
  icon_url        TEXT NOT NULL DEFAULT '',
  website_url     TEXT NOT NULL DEFAULT '',
  authors         TEXT NOT NULL DEFAULT '',
  mod_count       INTEGER NOT NULL DEFAULT 0,
  installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_modpacks_server_id ON modpacks(server_id);

ALTER TABLE mods ADD COLUMN modpack_id TEXT REFERENCES modpacks(id) ON DELETE SET NULL;
