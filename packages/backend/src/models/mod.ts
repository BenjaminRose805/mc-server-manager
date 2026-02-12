import type {
  InstalledMod,
  ModLoader,
  ModSide,
  ModSource,
} from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";
import { NotFoundError } from "../utils/errors.js";

interface ModRow {
  id: string;
  server_id: string | null;
  instance_id: string | null;
  name: string;
  slug: string;
  source: string;
  source_id: string;
  version_id: string;
  file_name: string;
  enabled: number;
  side: string;
  modpack_id: string | null;
  mc_version: string;
  loader_type: string;
  description: string;
  icon_url: string;
  website_url: string;
  authors: string;
  installed_at: string;
  updated_at: string;
}

function rowToMod(row: ModRow): InstalledMod {
  return {
    id: row.id,
    serverId: row.server_id,
    instanceId: row.instance_id,
    name: row.name,
    slug: row.slug,
    source: row.source as ModSource,
    sourceId: row.source_id,
    versionId: row.version_id,
    fileName: row.file_name,
    enabled: row.enabled === 1,
    side: (row.side as ModSide) ?? "both",
    modpackId: row.modpack_id,
    mcVersion: row.mc_version,
    loaderType: row.loader_type as ModLoader,
    description: row.description,
    iconUrl: row.icon_url,
    websiteUrl: row.website_url,
    authors: row.authors,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateModParams {
  serverId: string | null;
  instanceId?: string | null;
  name: string;
  slug: string;
  source: ModSource;
  sourceId: string;
  versionId: string;
  fileName: string;
  enabled?: boolean;
  side?: ModSide;
  modpackId?: string | null;
  mcVersion: string;
  loaderType: ModLoader;
  description?: string;
  iconUrl?: string;
  websiteUrl?: string;
  authors?: string;
}

export interface UpdateModParams {
  versionId?: string;
  fileName?: string;
  enabled?: boolean;
  side?: ModSide;
  modpackId?: string | null;
  mcVersion?: string;
  description?: string;
  iconUrl?: string;
  websiteUrl?: string;
  authors?: string;
}

/**
 * Get all mods for a server.
 */
export function getModsByServerId(serverId: string): InstalledMod[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM mods WHERE server_id = ? ORDER BY name ASC")
    .all(serverId) as ModRow[];
  return rows.map(rowToMod);
}

/**
 * Get a mod by ID. Throws NotFoundError if not found.
 */
export function getModById(id: string): InstalledMod {
  const db = getDb();
  const row = db.prepare("SELECT * FROM mods WHERE id = ?").get(id) as
    | ModRow
    | undefined;
  if (!row) {
    throw new NotFoundError("Mod", id);
  }
  return rowToMod(row);
}

/**
 * Create a new mod record with a pre-generated ID.
 */
export function createMod(id: string, params: CreateModParams): InstalledMod {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO mods (id, server_id, instance_id, name, slug, source, source_id, version_id, file_name, enabled, side, modpack_id, mc_version, loader_type, description, icon_url, website_url, authors)
    VALUES (@id, @serverId, @instanceId, @name, @slug, @source, @sourceId, @versionId, @fileName, @enabled, @side, @modpackId, @mcVersion, @loaderType, @description, @iconUrl, @websiteUrl, @authors)
  `);

  stmt.run({
    id,
    serverId: params.serverId ?? null,
    instanceId: params.instanceId ?? null,
    name: params.name,
    slug: params.slug,
    source: params.source,
    sourceId: params.sourceId,
    versionId: params.versionId,
    fileName: params.fileName,
    enabled: (params.enabled ?? true) ? 1 : 0,
    side: params.side ?? "both",
    modpackId: params.modpackId ?? null,
    mcVersion: params.mcVersion,
    loaderType: params.loaderType,
    description: params.description ?? "",
    iconUrl: params.iconUrl ?? "",
    websiteUrl: params.websiteUrl ?? "",
    authors: params.authors ?? "",
  });

  return getModById(id);
}

/**
 * Update a mod. Only updates fields that are provided.
 */
export function updateMod(id: string, params: UpdateModParams): InstalledMod {
  const db = getDb();

  getModById(id);

  const setClauses: string[] = [];
  const values: Record<string, unknown> = { id };

  if (params.versionId !== undefined) {
    setClauses.push("version_id = @versionId");
    values.versionId = params.versionId;
  }
  if (params.fileName !== undefined) {
    setClauses.push("file_name = @fileName");
    values.fileName = params.fileName;
  }
  if (params.enabled !== undefined) {
    setClauses.push("enabled = @enabled");
    values.enabled = params.enabled ? 1 : 0;
  }
  if (params.mcVersion !== undefined) {
    setClauses.push("mc_version = @mcVersion");
    values.mcVersion = params.mcVersion;
  }
  if (params.description !== undefined) {
    setClauses.push("description = @description");
    values.description = params.description;
  }
  if (params.iconUrl !== undefined) {
    setClauses.push("icon_url = @iconUrl");
    values.iconUrl = params.iconUrl;
  }
  if (params.websiteUrl !== undefined) {
    setClauses.push("website_url = @websiteUrl");
    values.websiteUrl = params.websiteUrl;
  }
  if (params.authors !== undefined) {
    setClauses.push("authors = @authors");
    values.authors = params.authors;
  }
  if (params.side !== undefined) {
    setClauses.push("side = @side");
    values.side = params.side;
  }
  if (params.modpackId !== undefined) {
    setClauses.push("modpack_id = @modpackId");
    values.modpackId = params.modpackId;
  }

  if (setClauses.length === 0) {
    return getModById(id);
  }

  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE mods SET ${setClauses.join(", ")} WHERE id = @id`;
  db.prepare(sql).run(values);

  return getModById(id);
}

/**
 * Delete a mod by ID. Throws NotFoundError if the mod doesn't exist.
 */
export function deleteMod(id: string): void {
  const db = getDb();
  getModById(id);
  db.prepare("DELETE FROM mods WHERE id = ?").run(id);
}

/**
 * Delete all mods for a server.
 */
export function deleteModsByServerId(serverId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM mods WHERE server_id = ?").run(serverId);
}

/**
 * Get all mods for an instance.
 */
export function getModsByInstanceId(instanceId: string): InstalledMod[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM mods WHERE instance_id = ? ORDER BY name ASC")
    .all(instanceId) as ModRow[];
  return rows.map(rowToMod);
}

/**
 * Delete all mods for an instance.
 */
export function deleteModsByInstanceId(instanceId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM mods WHERE instance_id = ?").run(instanceId);
}

/**
 * Get all mods linked to a modpack.
 */
export function getModsByModpackId(modpackId: string): InstalledMod[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM mods WHERE modpack_id = ? ORDER BY name ASC")
    .all(modpackId) as ModRow[];
  return rows.map(rowToMod);
}

/**
 * Delete all mods linked to a modpack.
 */
export function deleteModsByModpackId(modpackId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM mods WHERE modpack_id = ?").run(modpackId);
}

/**
 * Check if a mod with the given source/sourceId already exists on a server or instance.
 */
export function findModBySourceId(
  targetId: string,
  targetType: "server" | "instance",
  source: ModSource,
  sourceId: string,
): InstalledMod | null {
  const db = getDb();
  const column = targetType === "server" ? "server_id" : "instance_id";
  const row = db
    .prepare(
      `SELECT * FROM mods WHERE ${column} = ? AND source = ? AND source_id = ?`,
    )
    .get(targetId, source, sourceId) as ModRow | undefined;
  return row ? rowToMod(row) : null;
}
