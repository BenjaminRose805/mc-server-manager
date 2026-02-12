import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import * as yauzl from "yauzl-promise";
import type {
  ModpackSearchResponse,
  ModpackSearchResult,
  ModpackVersion,
  ModSource,
  InstalledModpack,
  ParsedModpack,
  ModpackInstallProgress,
  ModSide,
  ModCategory,
  ModEnvironment,
  ModSortOption,
  ModTarget,
} from "@mc-server-manager/shared";
import { getServerById } from "../models/server.js";
import { config } from "../config.js";
import {
  createModpack,
  getModpacksByServerId,
  getModpackById,
  deleteModpack,
} from "../models/modpack.js";
import {
  createMod,
  deleteModsByModpackId,
  getModsByModpackId,
} from "../models/mod.js";
import * as modrinth from "./mod-sources/modrinth.js";
import * as curseforge from "./mod-sources/curseforge.js";
import { orchestrateSearch } from "./search-orchestrator.js";
import { parseMrpack, parseCurseForgeManifest } from "./modpack-parser.js";
import { inspectModJar } from "./mod-jar-inspector.js";
import { eventBus } from "./event-bus.js";
import { logger } from "../utils/logger.js";
import { ValidationError } from "../utils/errors.js";

// ── Progress emission ────────────────────────────────────────────────

function emitProgress(
  targetId: string,
  progress: ModpackInstallProgress,
): void {
  eventBus.emit("modpack:progress", targetId, progress);
}

// ── Category cache ───────────────────────────────────────────────────

let cachedModpackCategories: ModCategory[] | null = null;
let modpackCategoriesCachedAt = 0;
const MODPACK_CATEGORY_CACHE_TTL = 30 * 60 * 1000;

// ── Search ───────────────────────────────────────────────────────────

export async function searchModpacks(
  query: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categorySlugs?: string[],
  environment?: ModEnvironment,
  sources?: ModSource[],
  mcVersion?: string,
): Promise<ModpackSearchResponse> {
  let modrinthCategories: string[] | undefined;
  let curseforgeCategoryId: string | undefined;

  if (categorySlugs && categorySlugs.length > 0) {
    const allCategories = await getModpackCategories();
    const selected = allCategories.filter((c) =>
      categorySlugs.includes(c.slug),
    );

    modrinthCategories = selected
      .map((c) => c.modrinthId)
      .filter((id): id is string => id !== undefined);

    const cfCategory = selected.find((c) => c.curseforgeId !== undefined);
    curseforgeCategoryId = cfCategory?.curseforgeId;
  }

  return orchestrateSearch<ModpackSearchResult>({
    query,
    sort,
    sources,
    modrinthSearch: () =>
      modrinth.searchModpacks(
        query,
        offset,
        limit,
        sort,
        modrinthCategories,
        environment,
        mcVersion,
      ),
    curseforgeSearch: () =>
      curseforge.searchModpacks(
        query,
        offset,
        limit,
        sort,
        curseforgeCategoryId,
        environment,
        mcVersion,
      ),
  });
}

export async function getModpackCategories(): Promise<ModCategory[]> {
  const now = Date.now();
  if (
    cachedModpackCategories &&
    now - modpackCategoriesCachedAt < MODPACK_CATEGORY_CACHE_TTL
  ) {
    return cachedModpackCategories;
  }

  const [modrinthCats, curseforgeCats] = await Promise.all([
    modrinth.getModpackCategories(),
    curseforge.isConfigured()
      ? curseforge.getModpackCategories()
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

  cachedModpackCategories = Array.from(mergeMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  modpackCategoriesCachedAt = now;

  return cachedModpackCategories;
}

// ── Versions ─────────────────────────────────────────────────────────

export async function getModpackVersions(
  source: ModSource,
  sourceId: string,
): Promise<ModpackVersion[]> {
  switch (source) {
    case "modrinth":
      return modrinth.getModpackVersions(sourceId);
    case "curseforge":
      return curseforge.getModpackVersions(sourceId);
    default:
      return [];
  }
}

// ── Parse ────────────────────────────────────────────────────────────

export async function parseModpack(
  source: ModSource,
  sourceId: string,
  versionId: string,
): Promise<ParsedModpack> {
  const versions = await getModpackVersions(source, sourceId);
  const version = versions.find((v) => v.versionId === versionId);

  if (!version) {
    throw new ValidationError("Modpack version not found");
  }

  const tempPath = path.join(os.tmpdir(), `modpack-${nanoid(8)}`);

  try {
    const res = await fetch(version.fileUrl);
    if (!res.ok || !res.body) {
      throw new ValidationError(
        `Failed to download modpack: ${res.status} ${res.statusText}`,
      );
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    const fileStream = createWriteStream(tempPath);
    await pipeline(nodeStream, fileStream);

    switch (source) {
      case "modrinth":
        return await parseMrpack(tempPath);
      case "curseforge":
        return await parseCurseForgeManifest(tempPath);
      default:
        throw new ValidationError(`Unsupported modpack source: ${source}`);
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      logger.warn({ err, tempPath }, "Failed to clean up temp modpack file");
    }
  }
}

// ── Install ──────────────────────────────────────────────────────────

export async function installModpack(
  target: ModTarget,
  source: ModSource,
  sourceId: string,
  versionId: string,
  selectedEntries: number[],
  applyOverrides: boolean,
): Promise<InstalledModpack> {
  const jobId = nanoid(12);

  emitProgress(target.id, {
    jobId,
    status: "parsing",
    totalMods: 0,
    installedMods: 0,
    currentMod: "",
  });

  try {
    const parsed = await parseModpack(source, sourceId, versionId);

    const filteredEntries =
      selectedEntries.length > 0
        ? parsed.entries.filter((_, idx) => selectedEntries.includes(idx))
        : parsed.entries.filter((entry) => entry.side !== "client");

    const totalMods = filteredEntries.length;

    emitProgress(target.id, {
      jobId,
      status: "downloading",
      totalMods,
      installedMods: 0,
      currentMod: "",
    });

    const modpackRecord = createModpack(nanoid(12), {
      serverId: target.type === "server" ? target.id : null,
      source,
      sourceId,
      versionId,
      versionNumber: parsed.versionId,
      name: parsed.name,
      mcVersion: parsed.mcVersion,
      loaderType: parsed.loader,
      modCount: totalMods,
    });

    fs.mkdirSync(target.modsDir, { recursive: true });

    const curseforgeEntries = filteredEntries.filter(
      (entry) =>
        !entry.downloadUrl &&
        entry.curseforgeProjectId !== undefined &&
        entry.curseforgeFileId !== undefined,
    );

    const curseforgeUrlMap = new Map<number, string>();
    if (curseforgeEntries.length > 0) {
      const fileIds = curseforgeEntries.map((entry) => ({
        modId: entry.curseforgeProjectId!,
        fileId: entry.curseforgeFileId!,
      }));

      const resolvedFiles = await curseforge.getFilesByIds(fileIds);
      for (const file of resolvedFiles) {
        if (file.downloadUrl) {
          curseforgeUrlMap.set(file.id, file.downloadUrl);
        }
      }
    }

    let installedMods = 0;

    for (const entry of filteredEntries) {
      const modName = entry.name ?? entry.path;
      emitProgress(target.id, {
        jobId,
        status: "downloading",
        totalMods,
        installedMods,
        currentMod: modName,
      });

      let downloadUrl = entry.downloadUrl;
      if (!downloadUrl && entry.curseforgeFileId !== undefined) {
        downloadUrl = curseforgeUrlMap.get(entry.curseforgeFileId) ?? "";
      }

      if (!downloadUrl) {
        logger.warn(
          { entry: entry.path, source },
          "Skipping modpack entry with no download URL",
        );
        installedMods++;
        continue;
      }

      const fileName = path.basename(entry.path);
      const filePath = path.join(target.modsDir, fileName);
      const tempPath = filePath + ".tmp";

      try {
        const res = await fetch(downloadUrl);
        if (!res.ok || !res.body) {
          logger.warn(
            { url: downloadUrl, status: res.status, fileName },
            "Failed to download modpack entry",
          );
          installedMods++;
          continue;
        }

        const nodeStream = Readable.fromWeb(
          res.body as import("stream/web").ReadableStream,
        );
        const fileStream = createWriteStream(tempPath);
        await pipeline(nodeStream, fileStream);

        fs.renameSync(tempPath, filePath);
      } catch (err) {
        logger.warn(
          { err, fileName, downloadUrl },
          "Error downloading modpack entry",
        );
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          /* empty */
        }
        installedMods++;
        continue;
      }

      let side: ModSide = entry.side;
      if (side === "unknown") {
        try {
          const inspection = await inspectModJar(filePath);
          side = inspection.side;
          logger.debug(
            { fileName, side, source: inspection.source },
            "Side detected from JAR inspection for modpack entry",
          );
        } catch (err) {
          logger.warn(
            { err, fileName },
            "JAR inspection failed for modpack entry, defaulting to both",
          );
          side = "both";
        }
      }

      createMod(nanoid(12), {
        serverId: target.type === "server" ? target.id : null,
        instanceId: target.type === "instance" ? target.id : null,
        name: entry.name ?? path.basename(entry.path, ".jar"),
        slug: entry.slug ?? "",
        source,
        sourceId: entry.curseforgeProjectId
          ? String(entry.curseforgeProjectId)
          : sourceId,
        versionId: entry.curseforgeFileId
          ? String(entry.curseforgeFileId)
          : versionId,
        fileName: path.basename(entry.path),
        enabled: true,
        side,
        modpackId: modpackRecord.id,
        mcVersion: parsed.mcVersion,
        loaderType: parsed.loader,
      });

      installedMods++;
    }

    if (applyOverrides && parsed.overrideFileCount > 0) {
      emitProgress(target.id, {
        jobId,
        status: "applying_overrides",
        totalMods,
        installedMods,
        currentMod: "",
      });

      const baseDir = path.dirname(target.modsDir);
      await applyModpackOverrides(source, sourceId, versionId, baseDir);
    }

    emitProgress(target.id, {
      jobId,
      status: "completed",
      totalMods,
      installedMods: totalMods,
      currentMod: "",
    });

    return modpackRecord;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitProgress(target.id, {
      jobId,
      status: "failed",
      totalMods: 0,
      installedMods: 0,
      currentMod: "",
      error: message,
    });
    logger.error(
      {
        err,
        targetId: target.id,
        targetType: target.type,
        source,
        sourceId,
        versionId,
      },
      "Modpack installation failed",
    );
    throw err;
  }
}

// ── Override handling ─────────────────────────────────────────────────

async function applyModpackOverrides(
  source: ModSource,
  sourceId: string,
  versionId: string,
  serverDirectory: string,
): Promise<void> {
  const versions = await getModpackVersions(source, sourceId);
  const version = versions.find((v) => v.versionId === versionId);
  if (!version) return;

  const tempPath = path.join(os.tmpdir(), `modpack-overrides-${nanoid(8)}`);

  try {
    const res = await fetch(version.fileUrl);
    if (!res.ok || !res.body) {
      logger.warn(
        { status: res.status },
        "Failed to download modpack for override extraction",
      );
      return;
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    const fileStream = createWriteStream(tempPath);
    await pipeline(nodeStream, fileStream);

    let zipFile: yauzl.ZipFile | undefined;
    try {
      zipFile = await yauzl.open(tempPath);

      const serverOverrideEntries: yauzl.Entry[] = [];
      const overrideEntries: yauzl.Entry[] = [];

      for await (const entry of zipFile) {
        if (
          entry.filename.startsWith("server-overrides/") &&
          !entry.filename.endsWith("/")
        ) {
          serverOverrideEntries.push(entry);
        } else if (
          entry.filename.startsWith("overrides/") &&
          !entry.filename.endsWith("/")
        ) {
          overrideEntries.push(entry);
        }
      }

      for (const entry of overrideEntries) {
        const relativePath = entry.filename.slice("overrides/".length);
        await extractOverrideEntry(entry, serverDirectory, relativePath);
      }

      for (const entry of serverOverrideEntries) {
        const relativePath = entry.filename.slice("server-overrides/".length);
        await extractOverrideEntry(entry, serverDirectory, relativePath);
      }

      logger.info(
        {
          overrides: overrideEntries.length,
          serverOverrides: serverOverrideEntries.length,
        },
        "Applied modpack overrides",
      );
    } finally {
      if (zipFile) {
        await zipFile.close();
      }
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      logger.warn({ err, tempPath }, "Failed to clean up temp override file");
    }
  }
}

async function extractOverrideEntry(
  entry: yauzl.Entry,
  serverDirectory: string,
  relativePath: string,
): Promise<void> {
  const targetPath = path.join(serverDirectory, relativePath);
  const targetDir = path.dirname(targetPath);
  fs.mkdirSync(targetDir, { recursive: true });

  const readStream = await entry.openReadStream();
  const writeStream = createWriteStream(targetPath);
  await pipeline(readStream, writeStream);
}

// ── Query ────────────────────────────────────────────────────────────

export function getInstalledModpacks(target: ModTarget): InstalledModpack[] {
  return getModpacksByServerId(target.id);
}

// ── Remove ───────────────────────────────────────────────────────────

export function removeModpack(modpackId: string): void {
  const modpack = getModpackById(modpackId);
  const mods = getModsByModpackId(modpackId);

  let modsDir: string;
  if (modpack.serverId) {
    const server = getServerById(modpack.serverId);
    modsDir = path.join(server.directory, "mods");
  } else if (mods.length > 0 && mods[0].instanceId) {
    modsDir = path.join(
      config.dataDir,
      "launcher",
      "instances",
      mods[0].instanceId,
      "mods",
    );
  } else {
    deleteModsByModpackId(modpackId);
    deleteModpack(modpackId);
    return;
  }

  for (const mod of mods) {
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
      logger.warn(
        { err, path: enabledPath },
        "Failed to delete modpack mod JAR",
      );
    }
    try {
      if (fs.existsSync(disabledPath)) fs.unlinkSync(disabledPath);
    } catch (err) {
      logger.warn(
        { err, path: disabledPath },
        "Failed to delete disabled modpack mod JAR",
      );
    }
  }

  deleteModsByModpackId(modpackId);
  deleteModpack(modpackId);
}
