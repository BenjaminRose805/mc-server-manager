import fs from "node:fs";
import path from "node:path";
import type { LoaderType } from "@mc-server-manager/shared";
import { config } from "../config.js";
import * as instanceModel from "../models/instance.js";
import { AppError, NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface FabricLoaderEntry {
  separator: string;
  build: number;
  maven: string;
  version: string;
  stable: boolean;
}

interface FabricLoaderResponse {
  loader: FabricLoaderEntry;
}

interface FabricProfileLibrary {
  name: string;
  url: string;
}

interface FabricProfile {
  id: string;
  inheritsFrom: string;
  type: string;
  mainClass: string;
  arguments: { game: string[]; jvm?: string[] };
  libraries: FabricProfileLibrary[];
}

function mavenToPath(coordinates: string): string {
  const parts = coordinates.split(":");
  const group = parts[0].replace(/\./g, "/");
  const artifact = parts[1];
  const version = parts[2];
  return `${group}/${artifact}/${version}/${artifact}-${version}.jar`;
}

export async function getClientLoaderVersions(
  loader: string,
  mcVersion: string,
): Promise<Array<{ version: string; stable: boolean }>> {
  if (loader !== "fabric") {
    throw new AppError(
      `Unsupported client loader: ${loader}. Only 'fabric' is currently supported.`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new AppError(
      `Failed to fetch Fabric loader versions for MC ${mcVersion}: ${response.status} ${response.statusText}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const data = (await response.json()) as FabricLoaderResponse[];

  return data.map((entry) => ({
    version: entry.loader.version,
    stable: entry.loader.stable,
  }));
}

export async function installClientLoader(
  instanceId: string,
  loader: string,
  loaderVersion?: string,
): Promise<void> {
  if (loader !== "fabric") {
    throw new AppError(
      `Unsupported client loader: ${loader}. Only 'fabric' is currently supported.`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const instance = instanceModel.getInstanceById(instanceId);
  const mcVersion = instance.mcVersion;

  const versions = await getClientLoaderVersions(loader, mcVersion);
  if (versions.length === 0) {
    throw new NotFoundError("Fabric loader versions", mcVersion);
  }

  let selectedVersion: string;
  if (loaderVersion) {
    const found = versions.find((v) => v.version === loaderVersion);
    if (!found) {
      throw new NotFoundError("Fabric loader version", loaderVersion);
    }
    selectedVersion = loaderVersion;
  } else {
    const stable = versions.find((v) => v.stable);
    selectedVersion = stable ? stable.version : versions[0].version;
  }

  logger.info(
    { instanceId, loader, mcVersion, loaderVersion: selectedVersion },
    "Installing client loader",
  );

  const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(selectedVersion)}/profile/json`;
  const profileResponse = await fetch(profileUrl);

  if (!profileResponse.ok) {
    throw new AppError(
      `Failed to fetch Fabric profile for MC ${mcVersion} loader ${selectedVersion}: ${profileResponse.status} ${profileResponse.statusText}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const profile = (await profileResponse.json()) as FabricProfile;
  const profileId = profile.id;

  const versionsDir = path.join(
    config.dataDir,
    "launcher",
    "versions",
    profileId,
  );
  fs.mkdirSync(versionsDir, { recursive: true });

  const profilePath = path.join(versionsDir, `${profileId}.json`);
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");

  logger.info({ profileId, profilePath }, "Saved Fabric profile JSON");

  const librariesBase = path.join(config.dataDir, "launcher", "libraries");

  for (const lib of profile.libraries) {
    const relativePath = mavenToPath(lib.name);
    const libPath = path.join(librariesBase, relativePath);

    if (fs.existsSync(libPath)) {
      logger.debug({ library: lib.name }, "Library already exists, skipping");
      continue;
    }

    const libUrl = lib.url + relativePath;

    logger.info({ library: lib.name, url: libUrl }, "Downloading library");

    const libResponse = await fetch(libUrl);
    if (!libResponse.ok) {
      throw new AppError(
        `Failed to download library ${lib.name}: ${libResponse.status} ${libResponse.statusText}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    const libDir = path.dirname(libPath);
    fs.mkdirSync(libDir, { recursive: true });

    const buffer = Buffer.from(await libResponse.arrayBuffer());
    fs.writeFileSync(libPath, buffer);
  }

  instanceModel.updateInstance(instanceId, {
    loader: loader as LoaderType,
    loaderVersion: selectedVersion,
  });

  logger.info(
    { instanceId, loader, loaderVersion: selectedVersion, profileId },
    "Client loader installed successfully",
  );
}

export async function removeClientLoader(instanceId: string): Promise<void> {
  const instance = instanceModel.getInstanceById(instanceId);

  logger.info(
    {
      instanceId,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
    },
    "Removing client loader",
  );

  instanceModel.updateInstance(instanceId, {
    loader: null,
    loaderVersion: null,
  });

  logger.info({ instanceId }, "Client loader removed");
}

export async function detectClientLoader(
  instanceId: string,
): Promise<{ loader: string | null; version: string | null }> {
  const instance = instanceModel.getInstanceById(instanceId);

  return {
    loader: instance.loader,
    version: instance.loaderVersion,
  };
}
