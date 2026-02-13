import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let db: Database.Database;

/**
 * Initialize the SQLite database.
 * - Ensures the data directory exists
 * - Opens the database with WAL mode for better concurrent read performance
 * - Runs any pending migrations
 */
export function initDatabase(): Database.Database {
  // Ensure data directory exists
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);

  // Enable WAL mode for better performance with concurrent reads
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  logger.info({ dbPath: config.dbPath }, "Database connected");

  runMigrations(db);

  return db;
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info("Database connection closed");
  }
}

/**
 * Simple migration runner.
 * - Reads .sql files from the migrations/ directory
 * - Tracks applied migrations in a _migrations table
 * - Applies them in filename order (001_, 002_, etc.)
 */
function runMigrations(database: Database.Database): void {
  // Create the migrations tracking table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  let migrationsDir: string;
  if (process.env.MC_MIGRATIONS_DIR) {
    migrationsDir = process.env.MC_MIGRATIONS_DIR;
  } else {
    const thisFile = import.meta.url.startsWith("file:")
      ? fileURLToPath(import.meta.url)
      : import.meta.url;
    migrationsDir = path.resolve(
      path.dirname(thisFile),
      "..",
      "..",
      "migrations",
    );
  }

  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, "Migrations directory not found");
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // Alphabetical sort ensures 001_ comes before 002_, etc.

  // Get already-applied migrations
  const applied = new Set(
    database
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row: any) => row.name),
  );

  // Apply new migrations inside a transaction
  const applyMigration = database.transaction((name: string, sql: string) => {
    database.exec(sql);
    database.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  });

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    logger.info({ migration: file }, "Applying migration");

    try {
      applyMigration(file, sql);
      logger.info({ migration: file }, "Migration applied successfully");
    } catch (err) {
      logger.error({ migration: file, err }, "Migration failed");
      throw err;
    }
  }
}
