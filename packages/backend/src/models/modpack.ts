import type {
  InstalledModpack,
  ModLoader,
  ModSource,
} from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";
import { NotFoundError } from "../utils/errors.js";

interface ModpackRow {
  id: string;
  server_id: string;
  source: string;
  source_id: string;
  version_id: string;
  version_number: string;
  name: string;
  mc_version: string;
  loader_type: string;
  icon_url: string;
  website_url: string;
  authors: string;
  mod_count: number;
  installed_at: string;
  updated_at: string;
}

function rowToModpack(row: ModpackRow): InstalledModpack {
  return {
    id: row.id,
    serverId: row.server_id,
    source: row.source as ModSource,
    sourceId: row.source_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    name: row.name,
    mcVersion: row.mc_version,
    loaderType: row.loader_type as ModLoader,
    iconUrl: row.icon_url,
    websiteUrl: row.website_url,
    authors: row.authors,
    modCount: row.mod_count,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateModpackParams {
  serverId: string | null;
  source: ModSource;
  sourceId: string;
  versionId: string;
  versionNumber: string;
  name: string;
  mcVersion: string;
  loaderType: ModLoader;
  iconUrl?: string;
  websiteUrl?: string;
  authors?: string;
  modCount?: number;
}

export interface UpdateModpackParams {
  versionId?: string;
  versionNumber?: string;
  modCount?: number;
}

/**
 * Get all modpacks for a server.
 */
export function getModpacksByServerId(serverId: string): InstalledModpack[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM modpacks WHERE server_id = ? ORDER BY name ASC")
    .all(serverId) as ModpackRow[];
  return rows.map(rowToModpack);
}

/**
 * Get a modpack by ID. Throws NotFoundError if not found.
 */
export function getModpackById(id: string): InstalledModpack {
  const db = getDb();
  const row = db.prepare("SELECT * FROM modpacks WHERE id = ?").get(id) as
    | ModpackRow
    | undefined;
  if (!row) {
    throw new NotFoundError("Modpack", id);
  }
  return rowToModpack(row);
}

/**
 * Get a modpack by source ID. Returns null if not found.
 */
export function getModpackBySourceId(
  serverId: string,
  source: ModSource,
  sourceId: string,
): InstalledModpack | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM modpacks WHERE server_id = ? AND source = ? AND source_id = ?",
    )
    .get(serverId, source, sourceId) as ModpackRow | undefined;
  return row ? rowToModpack(row) : null;
}

/**
 * Create a new modpack record with a pre-generated ID.
 */
export function createModpack(
  id: string,
  params: CreateModpackParams,
): InstalledModpack {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO modpacks (id, server_id, source, source_id, version_id, version_number, name, mc_version, loader_type, icon_url, website_url, authors, mod_count)
    VALUES (@id, @serverId, @source, @sourceId, @versionId, @versionNumber, @name, @mcVersion, @loaderType, @iconUrl, @websiteUrl, @authors, @modCount)
  `);

  stmt.run({
    id,
    serverId: params.serverId,
    source: params.source,
    sourceId: params.sourceId,
    versionId: params.versionId,
    versionNumber: params.versionNumber,
    name: params.name,
    mcVersion: params.mcVersion,
    loaderType: params.loaderType,
    iconUrl: params.iconUrl ?? "",
    websiteUrl: params.websiteUrl ?? "",
    authors: params.authors ?? "",
    modCount: params.modCount ?? 0,
  });

  return getModpackById(id);
}

/**
 * Update a modpack. Only updates fields that are provided.
 */
export function updateModpack(
  id: string,
  params: UpdateModpackParams,
): InstalledModpack {
  const db = getDb();

  getModpackById(id);

  const setClauses: string[] = [];
  const values: Record<string, unknown> = { id };

  if (params.versionId !== undefined) {
    setClauses.push("version_id = @versionId");
    values.versionId = params.versionId;
  }
  if (params.versionNumber !== undefined) {
    setClauses.push("version_number = @versionNumber");
    values.versionNumber = params.versionNumber;
  }
  if (params.modCount !== undefined) {
    setClauses.push("mod_count = @modCount");
    values.modCount = params.modCount;
  }

  if (setClauses.length === 0) {
    return getModpackById(id);
  }

  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE modpacks SET ${setClauses.join(", ")} WHERE id = @id`;
  db.prepare(sql).run(values);

  return getModpackById(id);
}

/**
 * Delete a modpack by ID. Throws NotFoundError if the modpack doesn't exist.
 */
export function deleteModpack(id: string): void {
  const db = getDb();
  getModpackById(id);
  db.prepare("DELETE FROM modpacks WHERE id = ?").run(id);
}

/**
 * Delete all modpacks for a server.
 */
export function deleteModpacksByServerId(serverId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM modpacks WHERE server_id = ?").run(serverId);
}
