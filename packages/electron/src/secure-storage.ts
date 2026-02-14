/**
 * OS-level credential encryption via Electron's safeStorage API.
 * All exports require `app.whenReady()` to have resolved first.
 * @module secure-storage
 */

import { safeStorage, app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let storageFilePath: string | null = null;

function getStorageFilePath(): string {
  if (!storageFilePath) {
    storageFilePath = path.join(app.getPath("userData"), "secure-storage.json");
  }
  return storageFilePath;
}

interface SecureStorageFile {
  [key: string]: string;
}

function readStorageFile(): SecureStorageFile {
  try {
    const raw = readFileSync(getStorageFilePath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SecureStorageFile;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStorageFile(data: SecureStorageFile): void {
  const filePath = getStorageFilePath();
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Requires `app.whenReady()`. On Linux, needs a running secret store (GNOME Keyring, KWallet). */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function saveSecret(key: string, value: string): void {
  const data = readStorageFile();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value);
    data[key] = `enc:${encrypted.toString("base64")}`;
  } else {
    data[key] = `plain:${Buffer.from(value, "utf-8").toString("base64")}`;
  }

  writeStorageFile(data);
}

export function getSecret(key: string): string | null {
  const data = readStorageFile();
  const stored = data[key];

  if (stored === undefined) {
    return null;
  }

  try {
    if (stored.startsWith("enc:")) {
      const buffer = Buffer.from(stored.slice(4), "base64");
      return safeStorage.decryptString(buffer);
    }

    if (stored.startsWith("plain:")) {
      return Buffer.from(stored.slice(6), "base64").toString("utf-8");
    }

    // Legacy format (pre-prefix) — try encrypted decryption
    const buffer = Buffer.from(stored, "base64");
    return safeStorage.decryptString(buffer);
  } catch (err) {
    console.warn(
      `[secure-storage] Failed to decrypt key "${key}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Remove a secret from storage. No-op if key doesn't exist. Requires `app.whenReady()`. */
export function deleteSecret(key: string): void {
  const data = readStorageFile();

  if (!(key in data)) {
    return;
  }

  delete data[key];
  writeStorageFile(data);
}
