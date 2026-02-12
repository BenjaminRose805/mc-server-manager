CREATE TABLE launcher_instances (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  mc_version        TEXT NOT NULL,
  version_type      TEXT NOT NULL DEFAULT 'release',
  loader            TEXT,
  loader_version    TEXT,
  java_version      INTEGER NOT NULL,
  java_path         TEXT,
  ram_min           INTEGER NOT NULL DEFAULT 2,
  ram_max           INTEGER NOT NULL DEFAULT 4,
  resolution_width  INTEGER,
  resolution_height INTEGER,
  jvm_args          TEXT,
  game_args         TEXT,
  icon              TEXT,
  last_played       TEXT,
  total_playtime    INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_launcher_instances_last_played ON launcher_instances(last_played DESC);
