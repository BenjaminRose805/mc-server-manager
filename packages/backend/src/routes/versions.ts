import { Router } from "express";
import { z } from "zod";
import { getProvider, hasProvider } from "../providers/registry.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { validate } from "../utils/validation.js";

const serverTypeSchema = z.enum([
  "vanilla",
  "paper",
  "fabric",
  "forge",
  "neoforge",
]);

export const versionsRouter = Router();

/**
 * GET /api/versions/:type — List available Minecraft versions for a server type
 * Query params:
 *   ?snapshots=true — include snapshot versions (default: false)
 */
versionsRouter.get("/:type", async (req, res, next) => {
  try {
    const serverType = validate(serverTypeSchema, req.params.type);

    if (!hasProvider(serverType)) {
      throw new AppError(
        `Server type '${serverType}' is not supported`,
        400,
        "UNSUPPORTED_SERVER_TYPE",
      );
    }

    const provider = getProvider(serverType);
    const includeSnapshots = req.query.snapshots === "true";
    const versions = await provider.getVersions(includeSnapshots);

    res.json(versions);
  } catch (err) {
    logger.error({ err, type: req.params.type }, "Failed to fetch versions");
    next(err);
  }
});

/**
 * GET /api/versions/:type/:mcVersion — Get detailed version info for a specific MC version
 * Returns type-specific info: builds (Paper), loader versions (Fabric), forge versions (Forge)
 */
versionsRouter.get("/:type/:mcVersion", async (req, res, next) => {
  try {
    const serverType = validate(serverTypeSchema, req.params.type);
    const mcVersion = req.params.mcVersion;

    if (!hasProvider(serverType)) {
      throw new AppError(
        `Server type '${serverType}' is not supported`,
        400,
        "UNSUPPORTED_SERVER_TYPE",
      );
    }

    const provider = getProvider(serverType);

    if (!provider.getVersionInfo) {
      throw new AppError(
        `Version info not available for server type '${serverType}'`,
        400,
        "NO_VERSION_INFO",
      );
    }

    const versionInfo = await provider.getVersionInfo(mcVersion);
    res.json(versionInfo);
  } catch (err) {
    logger.error(
      { err, type: req.params.type, mcVersion: req.params.mcVersion },
      "Failed to fetch version info",
    );
    next(err);
  }
});
