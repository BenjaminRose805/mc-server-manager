-- Mod tracking: one row per installed mod JAR on a server
CREATE TABLE mods (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'local',
  source_id     TEXT NOT NULL DEFAULT '',
  version_id    TEXT NOT NULL DEFAULT '',
  file_name     TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  mc_version    TEXT NOT NULL DEFAULT '',
  loader_type   TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  icon_url      TEXT NOT NULL DEFAULT '',
  website_url   TEXT NOT NULL DEFAULT '',
  authors       TEXT NOT NULL DEFAULT '',
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_mods_server_id ON mods(server_id);
CREATE UNIQUE INDEX idx_mods_server_file ON mods(server_id, file_name);
