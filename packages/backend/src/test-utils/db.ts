import type Database from "better-sqlite3";
import { initDatabase, closeDatabase, getDb } from "../services/database.js";

export function setupTestDb(): Database.Database {
  return initDatabase();
}

export function teardownTestDb() {
  closeDatabase();
}

export { getDb };
