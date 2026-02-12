-- Add instance_id column to mods table to support client-side mod tracking
-- Mods can now belong to either a server OR a launcher instance, but not both

-- Create new mods table with instance_id column
CREATE TABLE mods_new (
  id            TEXT PRIMARY KEY,
  server_id     TEXT REFERENCES servers(id) ON DELETE CASCADE,
  instance_id   TEXT REFERENCES launcher_instances(id) ON DELETE CASCADE,
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
  side          TEXT NOT NULL DEFAULT 'both',
  modpack_id    TEXT REFERENCES modpacks(id) ON DELETE SET NULL,
  installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((server_id IS NOT NULL AND instance_id IS NULL) OR (server_id IS NULL AND instance_id IS NOT NULL))
);

-- Copy all existing data from mods to mods_new (instance_id will be NULL for all existing rows)
INSERT INTO mods_new (
  id, server_id, instance_id, name, slug, source, source_id, version_id, file_name,
  enabled, mc_version, loader_type, description, icon_url, website_url, authors,
  side, modpack_id, installed_at, updated_at
)
SELECT
  id, server_id, NULL, name, slug, source, source_id, version_id, file_name,
  enabled, mc_version, loader_type, description, icon_url, website_url, authors,
  side, modpack_id, installed_at, updated_at
FROM mods;

-- Drop old mods table
DROP TABLE mods;

-- Rename mods_new to mods
ALTER TABLE mods_new RENAME TO mods;

-- Recreate indexes
CREATE INDEX idx_mods_server_id ON mods(server_id);
CREATE INDEX idx_mods_instance_id ON mods(instance_id);
CREATE UNIQUE INDEX idx_mods_server_file ON mods(server_id, file_name);
CREATE UNIQUE INDEX idx_mods_instance_file ON mods(instance_id, file_name);
