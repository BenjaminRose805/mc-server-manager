import type { Server } from '@mc-server-manager/shared';
import { getDb } from '../services/database.js';
import { NotFoundError } from '../utils/errors.js';

// --- Row type matching the SQLite schema (snake_case) ---
interface ServerRow {
  id: string;
  name: string;
  type: string;
  mc_version: string;
  jar_path: string;
  directory: string;
  java_path: string;
  jvm_args: string;
  port: number;
  auto_start: number; // SQLite stores booleans as 0/1
  created_at: string;
  updated_at: string;
}

/**
 * Convert a snake_case DB row to camelCase Server interface.
 */
function rowToServer(row: ServerRow): Server {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Server['type'],
    mcVersion: row.mc_version,
    jarPath: row.jar_path,
    directory: row.directory,
    javaPath: row.java_path,
    jvmArgs: row.jvm_args,
    port: row.port,
    autoStart: row.auto_start === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Query functions ---

export interface CreateServerParams {
  name: string;
  type: string;
  mcVersion: string;
  jarPath: string;
  directory: string;
  javaPath?: string;
  jvmArgs?: string;
  port?: number;
  autoStart?: boolean;
}

export interface UpdateServerParams {
  name?: string;
  port?: number;
  jvmArgs?: string;
  javaPath?: string;
  autoStart?: boolean;
  jarPath?: string;
}

/**
 * Get all servers.
 */
export function getAllServers(): Server[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all() as ServerRow[];
  return rows.map(rowToServer);
}

/**
 * Get a server by ID. Throws NotFoundError if not found.
 */
export function getServerById(id: string): Server {
  const db = getDb();
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow | undefined;
  if (!row) {
    throw new NotFoundError('Server', id);
  }
  return rowToServer(row);
}

/**
 * Create a new server with a pre-generated ID.
 * The route layer generates the ID so it can create the directory first.
 * Returns the created server.
 */
export function createServerWithId(id: string, params: CreateServerParams): Server {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO servers (id, name, type, mc_version, jar_path, directory, java_path, jvm_args, port, auto_start)
    VALUES (@id, @name, @type, @mcVersion, @jarPath, @directory, @javaPath, @jvmArgs, @port, @autoStart)
  `);

  stmt.run({
    id,
    name: params.name,
    type: params.type,
    mcVersion: params.mcVersion,
    jarPath: params.jarPath,
    directory: params.directory,
    javaPath: params.javaPath ?? 'java',
    jvmArgs: params.jvmArgs ?? '-Xmx2G -Xms1G',
    port: params.port ?? 25565,
    autoStart: (params.autoStart ?? false) ? 1 : 0,
  });

  return getServerById(id);
}

/**
 * Update a server. Only updates fields that are provided.
 * Returns the updated server.
 */
export function updateServer(id: string, params: UpdateServerParams): Server {
  const db = getDb();

  // Verify server exists first
  getServerById(id);

  // Build dynamic SET clause from provided fields
  const setClauses: string[] = [];
  const values: Record<string, unknown> = { id };

  if (params.name !== undefined) {
    setClauses.push('name = @name');
    values.name = params.name;
  }
  if (params.port !== undefined) {
    setClauses.push('port = @port');
    values.port = params.port;
  }
  if (params.jvmArgs !== undefined) {
    setClauses.push('jvm_args = @jvmArgs');
    values.jvmArgs = params.jvmArgs;
  }
  if (params.javaPath !== undefined) {
    setClauses.push('java_path = @javaPath');
    values.javaPath = params.javaPath;
  }
  if (params.autoStart !== undefined) {
    setClauses.push('auto_start = @autoStart');
    values.autoStart = params.autoStart ? 1 : 0;
  }
  if (params.jarPath !== undefined) {
    setClauses.push('jar_path = @jarPath');
    values.jarPath = params.jarPath;
  }

  if (setClauses.length === 0) {
    // Nothing to update
    return getServerById(id);
  }

  // Always update the updated_at timestamp
  setClauses.push("updated_at = datetime('now')");

  const sql = `UPDATE servers SET ${setClauses.join(', ')} WHERE id = @id`;
  db.prepare(sql).run(values);

  return getServerById(id);
}

/**
 * Delete a server by ID. Returns true if deleted.
 * Throws NotFoundError if the server doesn't exist.
 */
export function deleteServer(id: string): void {
  const db = getDb();

  // Verify server exists first
  getServerById(id);

  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
}

/**
 * Check if a port is already used by another server.
 * Optionally exclude a server ID (for updates).
 */
export function isPortInUse(port: number, excludeId?: string): boolean {
  const db = getDb();
  if (excludeId) {
    const row = db.prepare(
      'SELECT id FROM servers WHERE port = ? AND id != ?'
    ).get(port, excludeId);
    return !!row;
  }
  const row = db.prepare('SELECT id FROM servers WHERE port = ?').get(port);
  return !!row;
}
