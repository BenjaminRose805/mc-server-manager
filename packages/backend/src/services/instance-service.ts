import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  LauncherInstance,
  CreateInstanceRequest,
  UpdateInstanceRequest,
} from "@mc-server-manager/shared";
import { config } from "../config.js";
import * as instanceModel from "../models/instance.js";
import { logger } from "../utils/logger.js";

const INSTANCE_SUBDIRS = [
  "saves",
  "mods",
  "resourcepacks",
  "shaderpacks",
] as const;

function inferJavaVersion(mcVersion: string): number {
  const parts = mcVersion.split(".");
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);

  if (isNaN(major) || isNaN(minor)) return 21;

  if (major !== 1) return 21;

  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor >= 18 && minor <= 19) return 17;
  if (minor === 20) {
    const patch = parseInt(parts[2], 10);
    if (isNaN(patch) || patch <= 4) return 17;
    return 21;
  }
  return 21;
}

function getInstanceDir(instanceId: string): string {
  return path.join(config.dataDir, "launcher", "instances", instanceId);
}

export function listInstances(): LauncherInstance[] {
  return instanceModel.getAllInstances();
}

export function getInstanceById(id: string): LauncherInstance {
  return instanceModel.getInstanceById(id);
}

export function createInstance(
  request: CreateInstanceRequest,
): LauncherInstance {
  const id = nanoid();
  const javaVersion = inferJavaVersion(request.mcVersion);

  const instance = instanceModel.createInstance(id, {
    name: request.name,
    mcVersion: request.mcVersion,
    versionType: request.versionType ?? "release",
    loader: request.loader ?? null,
    loaderVersion: request.loaderVersion ?? null,
    javaVersion,
    ramMin: request.ramMin ?? 2,
    ramMax: request.ramMax ?? 4,
  });

  const instanceDir = getInstanceDir(id);
  for (const sub of INSTANCE_SUBDIRS) {
    fs.mkdirSync(path.join(instanceDir, sub), { recursive: true });
  }

  logger.info(
    { instanceId: id, name: request.name, mcVersion: request.mcVersion },
    "Created launcher instance",
  );

  return instance;
}

export function updateInstance(
  id: string,
  updates: UpdateInstanceRequest,
): LauncherInstance {
  return instanceModel.updateInstance(id, updates);
}

export function deleteInstance(id: string): void {
  instanceModel.getInstanceById(id);

  const instanceDir = getInstanceDir(id);
  fs.rmSync(instanceDir, { recursive: true, force: true });

  instanceModel.deleteInstance(id);

  logger.info({ instanceId: id }, "Deleted launcher instance");
}
