import { Router } from 'express';
import os from 'node:os';
import type { SystemInfo } from '@mc-server-manager/shared';
import { detectJava, validateJavaPath } from '../services/java.js';
import { getAllSettings, updateSettings } from '../services/settings.js';
import { logger } from '../utils/logger.js';

export const systemRouter = Router();

/**
 * GET /api/system/info — System resource information
 */
systemRouter.get('/info', (_req, res) => {
  const info: SystemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    cpus: os.cpus().length,
  };
  res.json(info);
});

/**
 * GET /api/system/java — Detect Java installation
 * Query params:
 *   ?path=/custom/java — validate a specific java binary path
 */
systemRouter.get('/java', async (req, res, next) => {
  try {
    const customPath = req.query.path as string | undefined;

    if (customPath) {
      const info = await validateJavaPath(customPath);
      res.json(info);
    } else {
      const info = await detectJava();
      res.json(info);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to detect Java');
    next(err);
  }
});

/**
 * GET /api/system/settings — Get all app settings
 */
systemRouter.get('/settings', (_req, res) => {
  res.json(getAllSettings());
});

/**
 * PATCH /api/system/settings — Update app settings
 */
systemRouter.patch('/settings', (req, res, next) => {
  try {
    const updated = updateSettings(req.body);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, 'Failed to update settings');
    next(err);
  }
});
