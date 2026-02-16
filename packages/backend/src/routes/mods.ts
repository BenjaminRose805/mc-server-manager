import { Router } from "express";
import { z } from "zod";
import type {
  ModSource,
  ModLoader,
  ModSortOption,
  ModEnvironment,
} from "@mc-server-manager/shared";
import {
  searchMods,
  getModVersions,
  getCategories,
  installMod,
  uninstallMod,
  toggleMod,
  getInstalledMods,
  serverToModTarget,
} from "../services/mod-manager.js";
import { getServerById } from "../models/server.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

// Router for global mod routes: /api/mods/...
export const modsRouter = Router();

// Router for server-scoped mod routes: /api/servers/:id/mods/...
export const serverModsRouter = Router({ mergeParams: true });

// --- Zod Schemas ---

const modSourceSchema = z.enum(["modrinth", "curseforge"]);
const modLoaderSchema = z.enum(["forge", "fabric", "neoforge"]);

const installModSchema = z.object({
  source: modSourceSchema,
  sourceId: z.string().min(1, "sourceId is required"),
  versionId: z.string().min(1, "versionId is required"),
});

const modSortSchema = z.enum(["relevance", "downloads", "updated", "newest"]);
const modEnvironmentSchema = z.enum(["client", "server", "both"]);

const searchQuerySchema = z.object({
  q: z.string().optional(),
  loader: modLoaderSchema,
  mcVersion: z.string().min(1, "mcVersion is required"),
  sort: modSortSchema.optional(),
  categories: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  environment: modEnvironmentSchema.optional(),
  sources: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v
        .split(",")
        .filter(
          (s): s is "modrinth" | "curseforge" =>
            s === "modrinth" || s === "curseforge",
        ) as ModSource[];
    }),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const versionsQuerySchema = z.object({
  loader: modLoaderSchema,
  mcVersion: z.string().min(1, "mcVersion is required"),
});

// --- Server-scoped routes (mounted at /api/servers/:id/mods) ---

/**
 * GET /api/servers/:id/mods — List installed mods for a server
 */
serverModsRouter.get("/:id/mods", async (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    const target = serverToModTarget(server);
    const mods = await getInstalledMods(target);
    res.json({ mods });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/servers/:id/mods — Install a mod
 */
serverModsRouter.post("/:id/mods", async (req, res, next) => {
  try {
    const { source, sourceId, versionId } = validate(
      installModSchema,
      req.body,
    );
    const server = getServerById(req.params.id);
    const target = serverToModTarget(server);
    const mod = await installMod(target, source, sourceId, versionId);

    logger.info(
      { serverId: req.params.id, modName: mod.name },
      "Mod installed",
    );
    res.status(201).json(mod);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/servers/:id/mods/:modId — Uninstall a mod
 */
serverModsRouter.delete("/:id/mods/:modId", async (req, res, next) => {
  try {
    await uninstallMod(req.params.modId);
    logger.info(
      { serverId: req.params.id, modId: req.params.modId },
      "Mod uninstalled",
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/servers/:id/mods/:modId — Toggle enable/disable
 */
serverModsRouter.patch("/:id/mods/:modId", async (req, res, next) => {
  try {
    const mod = await toggleMod(req.params.modId);
    logger.info(
      {
        serverId: req.params.id,
        modId: req.params.modId,
        enabled: mod.enabled,
      },
      "Mod toggled",
    );
    res.json(mod);
  } catch (err) {
    next(err);
  }
});

// --- Global mod routes (mounted at /api/mods) ---

/**
 * GET /api/mods/search — Search for mods
 */
modsRouter.get("/search", async (req, res, next) => {
  try {
    const {
      q,
      loader,
      mcVersion,
      offset,
      limit,
      sort,
      categories,
      environment,
      sources,
    } = validate(searchQuerySchema, req.query);
    const results = await searchMods(
      q ?? "",
      loader as ModLoader,
      mcVersion,
      offset,
      limit,
      sort as ModSortOption | undefined,
      categories,
      environment as ModEnvironment | undefined,
      sources,
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
});

modsRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await getCategories();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/mods/:source/:sourceId/versions — Get versions for a mod
 */
modsRouter.get("/:source/:sourceId/versions", async (req, res, next) => {
  try {
    const sourceResult = modSourceSchema.safeParse(req.params.source);
    if (!sourceResult.success) {
      throw new AppError(
        `Invalid source: must be "modrinth" or "curseforge"`,
        400,
        "VALIDATION_ERROR",
      );
    }

    const source = sourceResult.data as ModSource;
    const { loader, mcVersion } = validate(versionsQuerySchema, req.query);
    const versions = await getModVersions(
      source,
      req.params.sourceId,
      loader as ModLoader,
      mcVersion,
    );
    res.json({ versions });
  } catch (err) {
    next(err);
  }
});
