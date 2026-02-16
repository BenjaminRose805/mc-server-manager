import { Router } from "express";
import os from "node:os";
import { z } from "zod";
import type { SystemInfo } from "@mc-server-manager/shared";
import { detectJava, validateJavaPath } from "../services/java.js";
import { getAllSettings, updateSettings } from "../services/settings.js";
import { logger } from "../utils/logger.js";
import { validate } from "../utils/validation.js";

export const systemRouter = Router();

/**
 * GET /api/system/info — System resource information
 */
systemRouter.get("/info", (_req, res) => {
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
systemRouter.get("/java", async (req, res, next) => {
  try {
    const querySchema = z.object({ path: z.string().optional() });
    const { path: customPath } = validate(querySchema, req.query);

    if (customPath) {
      const info = await validateJavaPath(customPath);
      res.json(info);
    } else {
      const info = await detectJava();
      res.json(info);
    }
  } catch (err) {
    logger.error({ err }, "Failed to detect Java");
    next(err);
  }
});

/**
 * GET /api/system/settings — Get all app settings
 */
systemRouter.get("/settings", (_req, res) => {
  res.json(getAllSettings());
});

/**
 * PATCH /api/system/settings — Update app settings
 */
systemRouter.patch("/settings", (req, res, next) => {
  try {
    const settingsUpdateSchema = z.object({
      javaPath: z.string().optional(),
      dataDir: z.string().optional(),
      defaultJvmArgs: z.string().optional(),
      maxConsoleLines: z.number().optional(),
      curseforgeApiKey: z.string().optional(),
      showOverridePreview: z.boolean().optional(),
    });
    const body = validate(settingsUpdateSchema, req.body);
    const updated = updateSettings(body);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update settings");
    next(err);
  }
});
