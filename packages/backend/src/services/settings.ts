import type { AppSettings } from "@mc-server-manager/shared";
import { getDb } from "./database.js";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// Settings service — persists app-level configuration in SQLite
// ---------------------------------------------------------------------------

const SETTING_KEYS = [
  "javaPath",
  "dataDir",
  "defaultJvmArgs",
  "maxConsoleLines",
  "curseforgeApiKey",
  "showOverridePreview",
] as const;

const DEFAULTS: AppSettings = {
  javaPath: "java",
  dataDir: config.dataDir,
  defaultJvmArgs: "-Xmx2G -Xms1G",
  maxConsoleLines: 1000,
  curseforgeApiKey: "",
  showOverridePreview: false,
};

/**
 * Get all settings, merged with defaults.
 */
export function getAllSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;

  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }

  const result: Record<string, string | number | boolean> = {};
  for (const key of SETTING_KEYS) {
    const defaultVal = DEFAULTS[key];
    if (key in stored) {
      if (typeof defaultVal === "number") {
        const parsed = parseInt(stored[key], 10);
        result[key] = isNaN(parsed) ? defaultVal : parsed;
      } else if (typeof defaultVal === "boolean") {
        result[key] = stored[key] === "true";
      } else {
        result[key] = stored[key];
      }
    } else {
      result[key] = defaultVal;
    }
  }

  return result as unknown as AppSettings;
}

/**
 * Update one or more settings. Only known keys are accepted.
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const validKeys = new Set<string>(SETTING_KEYS);

  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (validKeys.has(key) && value !== undefined) {
        upsert.run(key, String(value));
      }
    }
  });

  txn();
  return getAllSettings();
}
