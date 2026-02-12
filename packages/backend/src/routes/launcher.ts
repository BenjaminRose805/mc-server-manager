import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import * as instanceService from "../services/instance-service.js";
import * as accountModel from "../models/account.js";
import { VersionService } from "../services/version-service.js";
import { AssetService } from "../services/asset-service.js";
import { LibraryService } from "../services/library-service.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

export const launcherRouter = Router();

const versionService = new VersionService(config.dataDir);
const assetService = new AssetService(config.dataDir);
const libraryService = new LibraryService(config.dataDir);

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
  id: z.string(),
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
    const parsed = createInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const instance = instanceService.createInstance(parsed.data);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

launcherRouter.patch("/instances/:id", (req, res, next) => {
  try {
    const parsed = updateInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const instance = instanceService.updateInstance(req.params.id, parsed.data);
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

launcherRouter.post("/prepare/:id", async (req, res, next) => {
  try {
    const instance = instanceService.getInstanceById(req.params.id);

    const versionJson = await versionService.downloadVersionJson(
      instance.mcVersion,
    );
    const gameJarPath = await versionService.downloadGameJar(
      instance.mcVersion,
    );

    const classpath = await libraryService.downloadLibraries(versionJson);
    await assetService.downloadAssets(versionJson);

    const assetIndexObj = versionJson.assetIndex as { id: string } | undefined;
    const assetIndex =
      assetIndexObj?.id ?? (versionJson.assets as string) ?? "";
    const assetsDir = path.join(config.dataDir, "launcher", "assets");

    res.json({
      classpath,
      mainClass: versionJson.mainClass as string,
      assetIndex,
      assetsDir,
      versionId: instance.mcVersion,
      gameJarPath,
    });
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
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const account = accountModel.createAccount(parsed.data);
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
