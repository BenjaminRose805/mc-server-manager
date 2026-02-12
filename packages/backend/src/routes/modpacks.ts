import { Router } from "express";
import { z } from "zod";
import type { ModSource, ModpackExportData } from "@mc-server-manager/shared";
import {
  searchModpacks,
  getModpackCategories,
  getModpackVersions,
  parseModpack,
  installModpack,
  getInstalledModpacks,
  removeModpack,
} from "../services/modpack-manager.js";
import { checkModpackUpdate } from "../services/modpack-update-checker.js";
import { serverToModTarget } from "../services/mod-manager.js";
import { getModpackById } from "../models/modpack.js";
import { getModsByModpackId } from "../models/mod.js";
import { getServerById } from "../models/server.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const modpacksRouter = Router();

export const serverModpacksRouter = Router({ mergeParams: true });

const modSourceSchema = z.enum(["modrinth", "curseforge"]);
const modSortSchema = z.enum(["relevance", "downloads", "updated", "newest"]);
const modEnvironmentSchema = z.enum(["client", "server", "both"]);

const searchQuerySchema = z.object({
  q: z.string().optional(),
  mcVersion: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
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
});

const installModpackSchema = z.object({
  source: modSourceSchema,
  sourceId: z.string().min(1, "sourceId is required"),
  versionId: z.string().min(1, "versionId is required"),
  selectedEntries: z.array(z.number().int().min(0)).optional().default([]),
  applyOverrides: z.boolean().optional().default(true),
});

modpacksRouter.get("/search", async (req, res, next) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const {
      q,
      mcVersion,
      offset,
      limit,
      sort,
      categories,
      environment,
      sources,
    } = parsed.data;
    const results = await searchModpacks(
      q ?? "",
      offset,
      limit,
      sort,
      categories,
      environment,
      sources,
      mcVersion,
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
});

modpacksRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await getModpackCategories();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

modpacksRouter.get("/:source/:sourceId/versions", async (req, res, next) => {
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
    const versions = await getModpackVersions(source, req.params.sourceId);
    res.json({ versions });
  } catch (err) {
    next(err);
  }
});

modpacksRouter.post("/:source/:sourceId/parse", async (req, res, next) => {
  try {
    const sourceResult = modSourceSchema.safeParse(req.params.source);
    if (!sourceResult.success) {
      throw new AppError(
        `Invalid source: must be "modrinth" or "curseforge"`,
        400,
        "VALIDATION_ERROR",
      );
    }

    const bodySchema = z.object({
      versionId: z.string().min(1, "versionId is required"),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      const message = bodyResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const source = sourceResult.data as ModSource;
    const parsed = await parseModpack(
      source,
      req.params.sourceId,
      bodyResult.data.versionId,
    );
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

serverModpacksRouter.get("/:id/modpacks", async (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    const target = serverToModTarget(server);
    const modpacks = getInstalledModpacks(target);
    res.json({ modpacks });
  } catch (err) {
    next(err);
  }
});

serverModpacksRouter.post("/:id/modpacks", async (req, res, next) => {
  try {
    const parsed = installModpackSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { source, sourceId, versionId, selectedEntries, applyOverrides } =
      parsed.data;
    const server = getServerById(req.params.id);
    const target = serverToModTarget(server);
    const modpack = await installModpack(
      target,
      source,
      sourceId,
      versionId,
      selectedEntries,
      applyOverrides,
    );

    logger.info(
      { serverId: req.params.id, modpackName: modpack.name },
      "Modpack installed",
    );
    res.status(201).json(modpack);
  } catch (err) {
    next(err);
  }
});

serverModpacksRouter.delete(
  "/:id/modpacks/:modpackId",
  async (req, res, next) => {
    try {
      removeModpack(req.params.modpackId);
      logger.info(
        { serverId: req.params.id, modpackId: req.params.modpackId },
        "Modpack removed",
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

serverModpacksRouter.get(
  "/:id/modpacks/:modpackId/check-update",
  async (req, res, next) => {
    try {
      const updateInfo = await checkModpackUpdate(req.params.modpackId);
      res.json(updateInfo);
    } catch (err) {
      next(err);
    }
  },
);

serverModpacksRouter.post(
  "/:id/modpacks/:modpackId/update",
  async (req, res, next) => {
    try {
      const updateInfo = await checkModpackUpdate(req.params.modpackId);
      if (!updateInfo.updateAvailable) {
        throw new AppError("No update available", 400, "NO_UPDATE");
      }

      const modpack = getModpackById(req.params.modpackId);

      removeModpack(req.params.modpackId);

      const server = getServerById(req.params.id);
      const target = serverToModTarget(server);
      const updated = await installModpack(
        target,
        modpack.source,
        modpack.sourceId,
        updateInfo.latestVersionId,
        [],
        true,
      );

      logger.info(
        {
          serverId: req.params.id,
          modpackName: updated.name,
          oldVersion: updateInfo.currentVersionNumber,
          newVersion: updateInfo.latestVersionNumber,
        },
        "Modpack updated",
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

serverModpacksRouter.get(
  "/:id/modpacks/:modpackId/export",
  async (req, res, next) => {
    try {
      const modpack = getModpackById(req.params.modpackId);
      const mods = getModsByModpackId(req.params.modpackId);

      const exportData: ModpackExportData = {
        name: modpack.name,
        mcVersion: modpack.mcVersion,
        loaderType: modpack.loaderType,
        source: modpack.source,
        sourceId: modpack.sourceId,
        versionId: modpack.versionId,
        versionNumber: modpack.versionNumber,
        mods: mods.map((mod) => ({
          name: mod.name,
          source: mod.source,
          sourceId: mod.sourceId,
          versionId: mod.versionId,
          fileName: mod.fileName,
          side: mod.side,
          enabled: mod.enabled,
        })),
        exportedAt: new Date().toISOString(),
      };

      res.json(exportData);
    } catch (err) {
      next(err);
    }
  },
);
