import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import type {
  InstalledMod,
  ModCategory,
  ModCompatibilityWarning,
  ModEnvironment,
  ModLoader,
  ModSearchResponse,
  ModSearchResult,
  ModSide,
  ModSortOption,
  ModSource,
  ModTarget,
  ModVersion,
  ServerType,
} from "@mc-server-manager/shared";
import { isModCapable } from "@mc-server-manager/shared";
import { getServerById } from "../models/server.js";
import {
  getModsByServerId,
  getModsByInstanceId,
  getModById,
  createMod,
  updateMod,
  deleteMod,
} from "../models/mod.js";
import { config } from "../config.js";
import * as modrinth from "./mod-sources/modrinth.js";
import * as curseforge from "./mod-sources/curseforge.js";
import { orchestrateSearch } from "./search-orchestrator.js";
import { inspectModJar } from "./mod-jar-inspector.js";
import { logger } from "../utils/logger.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

// ── Target helpers ────────────────────────────────────────────────────

export function serverToModTarget(server: {
  id: string;
  directory: string;
  mcVersion: string;
  type: string;
}): ModTarget {
  return {
    type: "server",
    id: server.id,
    modsDir: path.join(server.directory, "mods"),
    mcVersion: server.mcVersion,
    loader: isModCapable(server.type as ServerType)
      ? (server.type as ModLoader)
      : null,
    loaderVersion: null,
  };
}

export function instanceToModTarget(instance: {
  id: string;
  mcVersion: string;
  loader: string | null;
  loaderVersion: string | null;
}): ModTarget {
  return {
    type: "instance",
    id: instance.id,
    modsDir: path.join(
      config.dataDir,
      "launcher",
      "instances",
      instance.id,
      "mods",
    ),
    mcVersion: instance.mcVersion,
    loader: instance.loader as ModLoader | null,
    loaderVersion: instance.loaderVersion,
  };
}

function getModsDir(mod: InstalledMod): string {
  if (mod.serverId) {
    const server = getServerById(mod.serverId);
    return path.join(server.directory, "mods");
  }
  return path.join(
    config.dataDir,
    "launcher",
    "instances",
    mod.instanceId!,
    "mods",
  );
}

// ── Category cache ────────────────────────────────────────────────────

let cachedCategories: ModCategory[] | null = null;
let categoriesCachedAt = 0;
const CATEGORY_CACHE_TTL = 30 * 60 * 1000;

function deriveModSide(clientSide?: string, serverSide?: string): ModSide {
  if (!clientSide || !serverSide) return "unknown";
  const clientRequired = clientSide === "required" || clientSide === "optional";
  const serverRequired = serverSide === "required" || serverSide === "optional";
  if (clientRequired && !serverRequired) return "client";
  if (!clientRequired && serverRequired) return "server";
  if (clientRequired && serverRequired) return "both";
  return "unknown";
}

export async function searchMods(
  query: string,
  loader: ModLoader,
  mcVersion: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categorySlugs?: string[],
  environment?: ModEnvironment,
  sources?: ModSource[],
): Promise<ModSearchResponse> {
  let modrinthCategories: string[] | undefined;
  let curseforgeCategoryId: string | undefined;

  if (categorySlugs && categorySlugs.length > 0) {
    const allCategories = await getCategories();
    const selected = allCategories.filter((c) =>
      categorySlugs.includes(c.slug),
    );

    modrinthCategories = selected
      .map((c) => c.modrinthId)
      .filter((id): id is string => id !== undefined);

    const cfCategory = selected.find((c) => c.curseforgeId !== undefined);
    curseforgeCategoryId = cfCategory?.curseforgeId;
  }

  return orchestrateSearch<ModSearchResult>({
    query,
    sort,
    sources,
    modrinthSearch: () =>
      modrinth.searchMods(
        query,
        loader,
        mcVersion,
        offset,
        limit,
        sort,
        modrinthCategories,
        environment,
      ),
    curseforgeSearch: () =>
      curseforge.searchMods(
        query,
        loader,
        mcVersion,
        offset,
        limit,
        sort,
        curseforgeCategoryId,
        environment,
      ),
  });
}

export async function getModVersions(
  source: ModSource,
  sourceId: string,
  loader: ModLoader,
  mcVersion: string,
): Promise<ModVersion[]> {
  switch (source) {
    case "modrinth":
      return modrinth.getModVersions(sourceId, loader, mcVersion);
    case "curseforge":
      return curseforge.getModVersions(sourceId, loader, mcVersion);
    default:
      return [];
  }
}

export async function installMod(
  target: ModTarget,
  source: ModSource,
  sourceId: string,
  versionId: string,
): Promise<InstalledMod> {
  const loaderType = target.loader!;

  const versions = await getModVersions(
    source,
    sourceId,
    loaderType,
    target.mcVersion,
  );
  const modVersion = versions.find((v) => v.versionId === versionId);
  if (!modVersion) {
    throw new NotFoundError("ModVersion", versionId);
  }

  const warnings = checkCompatibility(
    modVersion,
    loaderType as ServerType,
    target.mcVersion,
  );
  const errors = warnings.filter((w) => w.severity === "error");
  if (errors.length > 0) {
    throw new ValidationError(
      `Mod is incompatible: ${errors.map((e) => e.message).join("; ")}`,
    );
  }

  if (!modVersion.downloadUrl) {
    throw new ValidationError("Mod version has no download URL available");
  }

  fs.mkdirSync(target.modsDir, { recursive: true });

  const fileName = modVersion.fileName || `${sourceId}-${versionId}.jar`;
  const filePath = path.join(target.modsDir, fileName);
  const tempPath = filePath + ".tmp";

  const res = await fetch(modVersion.downloadUrl);
  if (!res.ok || !res.body) {
    throw new ValidationError(
      `Failed to download mod: ${res.status} ${res.statusText}`,
    );
  }

  const nodeStream = Readable.fromWeb(
    res.body as import("stream/web").ReadableStream,
  );
  const fileStream = createWriteStream(tempPath);
  await pipeline(nodeStream, fileStream);

  fs.renameSync(tempPath, filePath);

  logger.info(
    {
      targetId: target.id,
      targetType: target.type,
      source,
      sourceId,
      versionId,
      fileName,
    },
    "Mod JAR downloaded",
  );

  let side: ModSide = "unknown";
  let modName = modVersion.name;
  let modDescription = "";
  let modAuthors = "";
  let modIconUrl = "";
  let modWebsiteUrl = "";
  let modSlug = sourceId;

  if (source === "modrinth") {
    try {
      const details = await modrinth.getProjectDetails(sourceId);
      modName = details.name;
      modDescription = details.description;
      modAuthors = details.author;
      modIconUrl = details.iconUrl;
      modSlug = details.slug;
      modWebsiteUrl = `https://modrinth.com/mod/${details.slug}`;
      side = deriveModSide(details.clientSide, details.serverSide);
    } catch (err) {
      logger.warn(
        { err, sourceId },
        "Failed to fetch project details for installed mod",
      );
    }
  }

  if (side === "unknown") {
    try {
      const inspection = await inspectModJar(filePath);
      side = inspection.side;
      logger.debug(
        { fileName, side, source: inspection.source },
        "Side detected from JAR inspection",
      );
    } catch (err) {
      logger.warn(
        { err, fileName },
        "JAR inspection failed, defaulting to both",
      );
      side = "both";
    }
  }

  const modId = nanoid(12);
  const installed = createMod(modId, {
    serverId: target.type === "server" ? target.id : null,
    instanceId: target.type === "instance" ? target.id : null,
    name: modName,
    slug: modSlug,
    source,
    sourceId,
    versionId,
    fileName,
    enabled: true,
    side,
    mcVersion: target.mcVersion,
    loaderType,
    description: modDescription,
    iconUrl: modIconUrl,
    websiteUrl: modWebsiteUrl,
    authors: modAuthors,
  });

  return installed;
}

export function uninstallMod(modId: string): void {
  const mod = getModById(modId);
  const modsDir = getModsDir(mod);
  const jarPath = path.join(modsDir, mod.fileName);
  const disabledPath = jarPath.endsWith(".disabled")
    ? jarPath
    : jarPath + ".disabled";
  const enabledPath = jarPath.endsWith(".disabled")
    ? jarPath.slice(0, -".disabled".length)
    : jarPath;

  try {
    if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
  } catch (err) {
    logger.warn({ err, path: enabledPath }, "Failed to delete mod JAR");
  }
  try {
    if (fs.existsSync(disabledPath)) fs.unlinkSync(disabledPath);
  } catch (err) {
    logger.warn(
      { err, path: disabledPath },
      "Failed to delete disabled mod JAR",
    );
  }

  deleteMod(modId);
}

export function toggleMod(modId: string): InstalledMod {
  const mod = getModById(modId);
  const modsDir = getModsDir(mod);

  if (mod.enabled) {
    const currentPath = path.join(modsDir, mod.fileName);
    const newFileName = mod.fileName.endsWith(".disabled")
      ? mod.fileName
      : mod.fileName + ".disabled";
    const newPath = path.join(modsDir, newFileName);

    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, newPath);
    }

    return updateMod(modId, { enabled: false, fileName: newFileName });
  } else {
    const currentPath = path.join(modsDir, mod.fileName);
    const newFileName = mod.fileName.endsWith(".disabled")
      ? mod.fileName.slice(0, -".disabled".length)
      : mod.fileName;
    const newPath = path.join(modsDir, newFileName);

    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, newPath);
    }

    return updateMod(modId, { enabled: true, fileName: newFileName });
  }
}

export function getInstalledMods(target: ModTarget): InstalledMod[] {
  return target.type === "server"
    ? getModsByServerId(target.id)
    : getModsByInstanceId(target.id);
}

export async function getCategories(): Promise<ModCategory[]> {
  const now = Date.now();
  if (cachedCategories && now - categoriesCachedAt < CATEGORY_CACHE_TTL) {
    return cachedCategories;
  }

  const [modrinthCats, curseforgeCats] = await Promise.all([
    modrinth.getCategories(),
    curseforge.isConfigured()
      ? curseforge.getCategories()
      : Promise.resolve([]),
  ]);

  const mergeMap = new Map<string, ModCategory>();

  for (const cat of modrinthCats) {
    const key = cat.name.toLowerCase();
    mergeMap.set(key, { ...cat });
  }

  for (const cat of curseforgeCats) {
    const key = cat.name.toLowerCase();
    const existing = mergeMap.get(key);
    if (existing) {
      existing.curseforgeId = cat.curseforgeId;
    } else {
      mergeMap.set(key, { ...cat });
    }
  }

  cachedCategories = Array.from(mergeMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  categoriesCachedAt = now;

  return cachedCategories;
}

export function checkCompatibility(
  modVersion: ModVersion,
  serverType: ServerType,
  serverMcVersion: string,
): ModCompatibilityWarning[] {
  const warnings: ModCompatibilityWarning[] = [];

  if (
    modVersion.mcVersions.length > 0 &&
    !modVersion.mcVersions.includes(serverMcVersion)
  ) {
    warnings.push({
      type: "mc_version",
      severity: "error",
      message: `Mod supports MC ${modVersion.mcVersions.join(", ")} but server runs ${serverMcVersion}`,
    });
  }

  if (isModCapable(serverType) && modVersion.loaders.length > 0) {
    const serverLoader: ModLoader = serverType;
    if (!modVersion.loaders.includes(serverLoader)) {
      warnings.push({
        type: "loader",
        severity: "error",
        message: `Mod supports ${modVersion.loaders.join(", ")} but server uses ${serverLoader}`,
      });
    }
  }

  return warnings;
}
