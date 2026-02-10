import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  getAllServers,
  getServerById,
  createServerWithId,
  updateServer,
  deleteServer,
  isPortInUse,
} from '../models/server.js';
import { createServerSchema, updateServerSchema, updatePropertiesSchema } from './validation.js';
import { AppError, ConflictError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { setupServerDirectory } from '../services/server-setup.js';
import { serverManager } from '../services/server-manager.js';
import {
  readServerProperties,
  writeServerProperties,
  PROPERTY_GROUPS,
} from '../services/properties.js';

export const serversRouter = Router();

/**
 * GET /api/servers — List all servers (enriched with runtime status)
 */
serversRouter.get('/', (_req, res) => {
  const servers = getAllServers();
  const enriched = servers.map((s) => serverManager.enrichWithStatus(s));
  res.json(enriched);
});

/**
 * GET /api/servers/:id — Get a single server (enriched with runtime status)
 */
serversRouter.get('/:id', (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    res.json(serverManager.enrichWithStatus(server));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers — Create a new server
 */
serversRouter.post('/', (req, res, next) => {
  try {
    // Validate request body
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }

    const body = parsed.data;

    // Check for port conflict
    if (isPortInUse(body.port)) {
      throw new ConflictError(`Port ${body.port} is already in use by another server`);
    }

    // Generate ID upfront so we can create the directory path
    const id = nanoid(12);
    const serverDir = path.join(config.serversDir, id);
    const jarPath = body.existingJarPath ?? path.join(serverDir, 'server.jar');

    // Create the server directory with eula.txt and server.properties
    setupServerDirectory(serverDir, body.port, body.name);

    const server = createServerWithId(id, {
      name: body.name,
      type: body.type,
      mcVersion: body.mcVersion,
      jarPath,
      directory: serverDir,
      javaPath: body.javaPath,
      jvmArgs: body.jvmArgs,
      port: body.port,
    });

    logger.info({ serverId: server.id, name: server.name }, 'Server created');
    res.status(201).json(server);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/servers/:id — Update a server
 */
serversRouter.patch('/:id', (req, res, next) => {
  try {
    const parsed = updateServerSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }

    const body = parsed.data;

    // Check for port conflict (exclude current server)
    if (body.port !== undefined && isPortInUse(body.port, req.params.id)) {
      throw new ConflictError(`Port ${body.port} is already in use by another server`);
    }

    const server = updateServer(req.params.id, body);
    logger.info({ serverId: server.id }, 'Server updated');
    res.json(server);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/servers/:id — Delete a server
 * Query param: ?deleteFiles=true to also remove the server directory
 */
serversRouter.delete('/:id', (req, res, next) => {
  try {
    const server = getServerById(req.params.id);

    // Prevent deleting a running server
    const status = serverManager.getStatus(server.id);
    if (status !== 'stopped' && status !== 'crashed') {
      throw new ConflictError(
        `Cannot delete server "${server.name}" while it is ${status}. Stop it first.`
      );
    }

    const deleteFiles = req.query.deleteFiles === 'true';

    deleteServer(req.params.id);

    if (deleteFiles && fs.existsSync(server.directory)) {
      fs.rmSync(server.directory, { recursive: true, force: true });
      logger.info({ serverId: server.id, directory: server.directory }, 'Server files deleted');
    }

    logger.info({ serverId: server.id }, 'Server deleted');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Server Lifecycle Routes
// ============================================================

/**
 * POST /api/servers/:id/start — Start the server
 */
serversRouter.post('/:id/start', async (req, res, next) => {
  try {
    const result = await serverManager.start(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers/:id/stop — Graceful stop
 */
serversRouter.post('/:id/stop', (req, res, next) => {
  try {
    const result = serverManager.stop(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers/:id/restart — Stop then start
 */
serversRouter.post('/:id/restart', async (req, res, next) => {
  try {
    const result = await serverManager.restart(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers/:id/kill — Force kill
 */
serversRouter.post('/:id/kill', (req, res, next) => {
  try {
    const result = serverManager.forceKill(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers/:id/command — Send a command to the server stdin
 */
serversRouter.post('/:id/command', (req, res, next) => {
  try {
    const { command } = req.body;
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new AppError('Request body must include a non-empty "command" string', 400, 'VALIDATION_ERROR');
    }
    serverManager.sendCommand(req.params.id, command.trim());
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/servers/:id/console — Get console history
 */
serversRouter.get('/:id/console', (req, res, next) => {
  try {
    // Verify the server exists
    getServerById(req.params.id);
    const lines = serverManager.getConsoleHistory(req.params.id);
    res.json({ serverId: req.params.id, lines });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Server Properties Routes
// ============================================================

/**
 * GET /api/servers/:id/properties — Read server.properties with metadata
 */
serversRouter.get('/:id/properties', (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    const properties = readServerProperties(server.directory);
    const status = serverManager.getStatus(server.id);
    const serverRunning = status === 'running' || status === 'starting' || status === 'stopping';

    res.json({
      properties,
      groups: PROPERTY_GROUPS,
      serverRunning,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/servers/:id/properties — Write server.properties
 */
serversRouter.put('/:id/properties', (req, res, next) => {
  try {
    const parsed = updatePropertiesSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }

    const server = getServerById(req.params.id);

    // Read existing properties and merge in the updates.
    // This preserves any properties not included in the request
    // (e.g., properties set by mods or unknown to our metadata).
    const existing = readServerProperties(server.directory);
    const merged = { ...existing, ...parsed.data.properties };

    writeServerProperties(server.directory, merged);

    const status = serverManager.getStatus(server.id);
    const serverRunning = status === 'running' || status === 'starting' || status === 'stopping';

    logger.info({ serverId: server.id }, 'Server properties updated');

    res.json({
      properties: merged,
      groups: PROPERTY_GROUPS,
      serverRunning,
    });
  } catch (err) {
    next(err);
  }
});
