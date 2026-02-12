import { Router } from "express";
import { z } from "zod";
import {
  installMod,
  uninstallMod,
  toggleMod,
  getInstalledMods,
  instanceToModTarget,
} from "../services/mod-manager.js";
import { getInstanceById } from "../models/instance.js";
import {
  installClientLoader,
  removeClientLoader,
  detectClientLoader,
  getClientLoaderVersions,
} from "../services/mod-loader-service.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const instanceModsRouter = Router({ mergeParams: true });

// --- Zod Schemas ---

const modSourceSchema = z.enum(["modrinth", "curseforge"]);

const installModSchema = z.object({
  source: modSourceSchema,
  sourceId: z.string().min(1, "sourceId is required"),
  versionId: z.string().min(1, "versionId is required"),
});

const installLoaderSchema = z.object({
  loader: z.enum(["fabric"]),
  loaderVersion: z.string().optional(),
});

const loaderVersionsQuerySchema = z.object({
  loader: z.enum(["fabric"]),
  mcVersion: z.string().min(1, "mcVersion is required"),
});

// --- Mod CRUD routes (mounted at /api/launcher/instances/:id/mods) ---

/**
 * GET /instances/:id/mods — List installed mods for an instance
 */
instanceModsRouter.get("/instances/:id/mods", async (req, res, next) => {
  try {
    const instance = getInstanceById(req.params.id);
    const target = instanceToModTarget(instance);
    const mods = getInstalledMods(target);
    res.json({ mods });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /instances/:id/mods — Install a mod
 */
instanceModsRouter.post("/instances/:id/mods", async (req, res, next) => {
  try {
    const parsed = installModSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { source, sourceId, versionId } = parsed.data;
    const instance = getInstanceById(req.params.id);
    const target = instanceToModTarget(instance);
    const mod = await installMod(target, source, sourceId, versionId);

    logger.info(
      { instanceId: req.params.id, modName: mod.name },
      "Mod installed on instance",
    );
    res.status(201).json(mod);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /instances/:id/mods/:modId — Uninstall a mod
 */
instanceModsRouter.delete(
  "/instances/:id/mods/:modId",
  async (req, res, next) => {
    try {
      uninstallMod(req.params.modId);
      logger.info(
        { instanceId: req.params.id, modId: req.params.modId },
        "Mod uninstalled from instance",
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /instances/:id/mods/:modId — Toggle enable/disable
 */
instanceModsRouter.patch(
  "/instances/:id/mods/:modId",
  async (req, res, next) => {
    try {
      const mod = toggleMod(req.params.modId);
      logger.info(
        {
          instanceId: req.params.id,
          modId: req.params.modId,
          enabled: mod.enabled,
        },
        "Mod toggled on instance",
      );
      res.json(mod);
    } catch (err) {
      next(err);
    }
  },
);

// --- Loader routes ---

/**
 * GET /instances/:id/loader — Get current loader info
 */
instanceModsRouter.get("/instances/:id/loader", async (req, res, next) => {
  try {
    const result = await detectClientLoader(req.params.id);
    res.json({ loader: result.loader, version: result.version });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /instances/:id/loader — Install mod loader
 */
instanceModsRouter.post("/instances/:id/loader", async (req, res, next) => {
  try {
    const parsed = installLoaderSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { loader, loaderVersion } = parsed.data;
    await installClientLoader(req.params.id, loader, loaderVersion);

    logger.info(
      { instanceId: req.params.id, loader, loaderVersion },
      "Client loader installed",
    );
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /instances/:id/loader — Remove mod loader
 */
instanceModsRouter.delete("/instances/:id/loader", async (req, res, next) => {
  try {
    await removeClientLoader(req.params.id);
    logger.info({ instanceId: req.params.id }, "Client loader removed");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /instances/:id/loader/versions — Get available loader versions
 */
instanceModsRouter.get(
  "/instances/:id/loader/versions",
  async (req, res, next) => {
    try {
      const parsed = loaderVersionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new AppError(message, 400, "VALIDATION_ERROR");
      }

      const { loader, mcVersion } = parsed.data;
      const versions = await getClientLoaderVersions(loader, mcVersion);
      res.json({ versions });
    } catch (err) {
      next(err);
    }
  },
);
