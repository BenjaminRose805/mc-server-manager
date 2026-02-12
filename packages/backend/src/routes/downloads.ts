import { Router } from "express";
import { z } from "zod";
import type { DownloadRequest } from "@mc-server-manager/shared";
import {
  startDownload,
  getDownloadJob,
  cancelDownload,
} from "../services/download.js";
import { getServerById } from "../models/server.js";
import { AppError, NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const downloadsRouter = Router();

/**
 * Zod schema for download requests.
 * Uses a discriminated union on serverType to validate type-specific fields.
 */
const downloadRequestSchema = z.discriminatedUnion("serverType", [
  z.object({
    serverId: z.string().min(1, "serverId is required"),
    mcVersion: z.string().min(1, "mcVersion is required"),
    serverType: z.literal("vanilla"),
  }),
  z.object({
    serverId: z.string().min(1, "serverId is required"),
    mcVersion: z.string().min(1, "mcVersion is required"),
    serverType: z.literal("paper"),
    build: z.number().int().positive().optional(),
  }),
  z.object({
    serverId: z.string().min(1, "serverId is required"),
    mcVersion: z.string().min(1, "mcVersion is required"),
    serverType: z.literal("fabric"),
    loaderVersion: z.string().optional(),
    installerVersion: z.string().optional(),
  }),
  z.object({
    serverId: z.string().min(1, "serverId is required"),
    mcVersion: z.string().min(1, "mcVersion is required"),
    serverType: z.literal("forge"),
    forgeVersion: z.string().min(1, "forgeVersion is required"),
  }),
  z.object({
    serverId: z.string().min(1, "serverId is required"),
    mcVersion: z.string().min(1, "mcVersion is required"),
    serverType: z.literal("neoforge"),
    neoforgeVersion: z.string().min(1, "neoforgeVersion is required"),
  }),
]);

/**
 * POST /api/downloads — Start downloading a server JAR
 * Body: DownloadRequest discriminated union
 *
 * The server must already exist in the database (created via POST /api/servers).
 * The JAR will be downloaded into the server's directory.
 */
downloadsRouter.post("/", (req, res, next) => {
  try {
    const parsed = downloadRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const request = parsed.data as DownloadRequest;

    // Verify the server exists and get its directory
    const server = getServerById(request.serverId);

    const job = startDownload(request, server.directory);

    logger.info(
      {
        jobId: job.id,
        serverId: request.serverId,
        mcVersion: request.mcVersion,
        serverType: request.serverType,
      },
      "Download job started",
    );

    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/downloads/:jobId — Get download progress
 */
downloadsRouter.get("/:jobId", (req, res, next) => {
  try {
    const job = getDownloadJob(req.params.jobId);
    if (!job) {
      throw new NotFoundError("Download job", req.params.jobId);
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/downloads/:jobId — Cancel an in-progress download
 */
downloadsRouter.delete("/:jobId", (req, res, next) => {
  try {
    const job = getDownloadJob(req.params.jobId);
    if (!job) {
      throw new NotFoundError("Download job", req.params.jobId);
    }

    const cancelled = cancelDownload(req.params.jobId);
    if (!cancelled) {
      throw new AppError(
        "Download is not in progress or already completed",
        409,
        "NOT_CANCELLABLE",
      );
    }

    logger.info({ jobId: req.params.jobId }, "Download cancelled by user");
    res.json({ message: "Download cancelled", jobId: req.params.jobId });
  } catch (err) {
    next(err);
  }
});
