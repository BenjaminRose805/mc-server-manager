import type {
  LauncherInstance,
  UpdateInstanceRequest,
  VersionType,
  LoaderType,
} from "@mc-server-manager/shared";
import { getDb } from "../services/database.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * Internal update params that extend the public API request with fields
 * that can only be set programmatically (e.g., by the mod loader service).
 */
export interface InternalInstanceUpdate extends UpdateInstanceRequest {
  loader?: LoaderType | null;
  loaderVersion?: string | null;
}

interface InstanceRow {
  id: string;
  name: string;
  mc_version: string;
  version_type: string;
  loader: string | null;
  loader_version: string | null;
  java_version: number;
  java_path: string | null;
  ram_min: number;
  ram_max: number;
  resolution_width: number | null;
  resolution_height: number | null;
  jvm_args: string | null;
  game_args: string | null;
  icon: string | null;
  last_played: string | null;
  total_playtime: number;
  created_at: string;
  updated_at: string;
}

function rowToInstance(row: InstanceRow): LauncherInstance {
  return {
    id: row.id,
    name: row.name,
    mcVersion: row.mc_version,
    versionType: row.version_type as VersionType,
    loader: row.loader as LoaderType | null,
    loaderVersion: row.loader_version,
    javaVersion: row.java_version,
    javaPath: row.java_path,
    ramMin: row.ram_min,
    ramMax: row.ram_max,
    resolutionWidth: row.resolution_width,
    resolutionHeight: row.resolution_height,
    jvmArgs: JSON.parse(row.jvm_args || "[]") as string[],
    gameArgs: JSON.parse(row.game_args || "[]") as string[],
    icon: row.icon,
    lastPlayed: row.last_played,
    totalPlaytime: row.total_playtime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateInstanceParams {
  name: string;
  mcVersion: string;
  versionType: VersionType;
  loader: LoaderType | null;
  loaderVersion: string | null;
  javaVersion: number;
  ramMin: number;
  ramMax: number;
}

export function getAllInstances(): LauncherInstance[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM launcher_instances ORDER BY last_played DESC NULLS LAST, created_at DESC",
    )
    .all() as InstanceRow[];
  return rows.map(rowToInstance);
}

export function getInstanceById(id: string): LauncherInstance {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM launcher_instances WHERE id = ?")
    .get(id) as InstanceRow | undefined;
  if (!row) {
    throw new NotFoundError("Instance", id);
  }
  return rowToInstance(row);
}

export function createInstance(
  id: string,
  params: CreateInstanceParams,
): LauncherInstance {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO launcher_instances (
      id, name, mc_version, version_type, loader, loader_version,
      java_version, ram_min, ram_max, jvm_args, game_args
    ) VALUES (
      @id, @name, @mcVersion, @versionType, @loader, @loaderVersion,
      @javaVersion, @ramMin, @ramMax, @jvmArgs, @gameArgs
    )
  `);

  stmt.run({
    id,
    name: params.name,
    mcVersion: params.mcVersion,
    versionType: params.versionType,
    loader: params.loader,
    loaderVersion: params.loaderVersion,
    javaVersion: params.javaVersion,
    ramMin: params.ramMin,
    ramMax: params.ramMax,
    jvmArgs: JSON.stringify([]),
    gameArgs: JSON.stringify([]),
  });

  return getInstanceById(id);
}

export function updateInstance(
  id: string,
  params: InternalInstanceUpdate,
): LauncherInstance {
  const db = getDb();

  getInstanceById(id);

  const setClauses: string[] = [];
  const values: Record<string, unknown> = { id };

  if (params.name !== undefined) {
    setClauses.push("name = @name");
    values.name = params.name;
  }
  if (params.ramMin !== undefined) {
    setClauses.push("ram_min = @ramMin");
    values.ramMin = params.ramMin;
  }
  if (params.ramMax !== undefined) {
    setClauses.push("ram_max = @ramMax");
    values.ramMax = params.ramMax;
  }
  if (params.resolutionWidth !== undefined) {
    setClauses.push("resolution_width = @resolutionWidth");
    values.resolutionWidth = params.resolutionWidth;
  }
  if (params.resolutionHeight !== undefined) {
    setClauses.push("resolution_height = @resolutionHeight");
    values.resolutionHeight = params.resolutionHeight;
  }
  if (params.jvmArgs !== undefined) {
    setClauses.push("jvm_args = @jvmArgs");
    values.jvmArgs = JSON.stringify(params.jvmArgs);
  }
  if (params.gameArgs !== undefined) {
    setClauses.push("game_args = @gameArgs");
    values.gameArgs = JSON.stringify(params.gameArgs);
  }
  if (params.icon !== undefined) {
    setClauses.push("icon = @icon");
    values.icon = params.icon;
  }
  if (params.javaPath !== undefined) {
    setClauses.push("java_path = @javaPath");
    values.javaPath = params.javaPath;
  }
  if (params.loader !== undefined) {
    setClauses.push("loader = @loader");
    values.loader = params.loader;
  }
  if (params.loaderVersion !== undefined) {
    setClauses.push("loader_version = @loaderVersion");
    values.loaderVersion = params.loaderVersion;
  }

  if (setClauses.length === 0) {
    return getInstanceById(id);
  }

  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE launcher_instances SET ${setClauses.join(", ")} WHERE id = @id`;
  db.prepare(sql).run(values);

  return getInstanceById(id);
}

export function deleteInstance(id: string): void {
  const db = getDb();

  getInstanceById(id);

  db.prepare("DELETE FROM launcher_instances WHERE id = ?").run(id);
}
