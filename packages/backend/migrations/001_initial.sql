-- Initial schema: servers table
-- The core entity. One row per managed Minecraft server.
CREATE TABLE servers (
  id            TEXT PRIMARY KEY,                          -- nanoid
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'vanilla',           -- vanilla | paper | fabric | forge
  mc_version    TEXT NOT NULL,                             -- e.g. "1.21.4"
  jar_path      TEXT NOT NULL,                             -- Absolute path to server JAR
  directory     TEXT NOT NULL UNIQUE,                      -- Absolute path to server directory
  java_path     TEXT NOT NULL DEFAULT 'java',              -- Path to java binary
  jvm_args      TEXT NOT NULL DEFAULT '-Xmx2G -Xms1G',
  port          INTEGER NOT NULL DEFAULT 25565,
  auto_start    INTEGER NOT NULL DEFAULT 0,               -- boolean (0 = false, 1 = true)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
