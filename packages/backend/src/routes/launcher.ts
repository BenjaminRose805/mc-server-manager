import { Router } from "express";
import { z } from "zod";
import * as instanceService from "../services/instance-service.js";
import * as accountModel from "../models/account.js";
import { detectAllJavaInstallations, downloadJava } from "../services/java.js";
import { VersionService } from "../services/version-service.js";
import {
  startPrepare,
  getPrepareJob,
  cancelPrepare,
} from "../services/prepare-service.js";
import { config } from "../config.js";
import { AppError, NotFoundError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export const launcherRouter = Router();

const versionService = new VersionService(config.dataDir);

const createInstanceSchema = z.object({
  name: z.string().min(1).max(100),
  mcVersion: z.string(),
  versionType: z
    .enum(["release", "snapshot", "old_beta", "old_alpha"])
    .optional(),
  loader: z.enum(["fabric", "forge", "neoforge", "quilt"]).optional(),
  loaderVersion: z.string().optional(),
  ramMin: z.number().int().min(1).max(64).optional(),
  ramMax: z.number().int().min(1).max(64).optional(),
});

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ramMin: z.number().int().min(1).max(64).optional(),
  ramMax: z.number().int().min(1).max(64).optional(),
  resolutionWidth: z.number().int().positive().nullable().optional(),
  resolutionHeight: z.number().int().positive().nullable().optional(),
  jvmArgs: z.array(z.string()).optional(),
  gameArgs: z.array(z.string()).optional(),
  icon: z.string().nullable().optional(),
  javaPath: z.string().nullable().optional(),
});

const createAccountSchema = z.object({
  uuid: z.string(),
  username: z.string(),
  accountType: z.string().default("msa"),
});

launcherRouter.get("/instances", (_req, res, next) => {
  try {
    const instances = instanceService.listInstances();
    res.json(instances);
  } catch (err) {
    next(err);
  }
});

launcherRouter.get("/instances/:id", (req, res, next) => {
  try {
    const instance = instanceService.getInstanceById(req.params.id);
    res.json(instance);
  } catch (err) {
    next(err);
  }
});

launcherRouter.post("/instances", (req, res, next) => {
  try {
    const body = validate(createInstanceSchema, req.body);

    const instance = instanceService.createInstance(body);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

launcherRouter.patch("/instances/:id", (req, res, next) => {
  try {
    const body = validate(updateInstanceSchema, req.body);

    const instance = instanceService.updateInstance(req.params.id, body);
    res.json(instance);
  } catch (err) {
    next(err);
  }
});

launcherRouter.delete("/instances/:id", (req, res, next) => {
  try {
    instanceService.deleteInstance(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

launcherRouter.get("/versions", async (req, res, next) => {
  try {
    const type = req.query.type as
      | "release"
      | "snapshot"
      | "old_beta"
      | "old_alpha"
      | undefined;
    const versions = await versionService.getVersions(type);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

launcherRouter.post("/prepare/:id", (req, res, next) => {
  try {
    const instance = instanceService.getInstanceById(req.params.id);
    const job = startPrepare(instance.id, instance.mcVersion);

    logger.info(
      { jobId: job.id, instanceId: instance.id, mcVersion: instance.mcVersion },
      "Prepare job started",
    );

    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
});

launcherRouter.get("/prepare/jobs/:jobId", (req, res, next) => {
  try {
    const job = getPrepareJob(req.params.jobId);
    if (!job) {
      throw new NotFoundError("Prepare job", req.params.jobId);
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

launcherRouter.delete("/prepare/jobs/:jobId", (req, res, next) => {
  try {
    const job = getPrepareJob(req.params.jobId);
    if (!job) {
      throw new NotFoundError("Prepare job", req.params.jobId);
    }

    const cancelled = cancelPrepare(req.params.jobId);
    if (!cancelled) {
      throw new AppError(
        "Prepare job is not in progress or already completed",
        409,
        "NOT_CANCELLABLE",
      );
    }

    logger.info({ jobId: req.params.jobId }, "Prepare job cancelled by user");
    res.json({ message: "Prepare cancelled", jobId: req.params.jobId });
  } catch (err) {
    next(err);
  }
});

launcherRouter.get("/accounts", (_req, res, next) => {
  try {
    const accounts = accountModel.getAllAccounts();
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

launcherRouter.post("/accounts", (req, res, next) => {
  try {
    const body = validate(createAccountSchema, req.body);

    const account = accountModel.createAccount(body);
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

launcherRouter.delete("/accounts/:id", (req, res, next) => {
  try {
    accountModel.deleteAccount(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const downloadJavaSchema = z.object({
  version: z.number().int().min(8).max(99),
});

launcherRouter.get("/java", async (_req, res, next) => {
  try {
    const installations = await detectAllJavaInstallations(config.dataDir);
    res.json(installations);
  } catch (err) {
    next(err);
  }
});

launcherRouter.post("/java/download", async (req, res, next) => {
  try {
    const body = validate(downloadJavaSchema, req.body);

    const installation = await downloadJava(body.version, config.dataDir);
    res.json(installation);
  } catch (err) {
    next(err);
  }
});
