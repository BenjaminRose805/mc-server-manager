import type {
  ModLoader,
  ModSearchResult,
  ModSearchResponse,
  ModVersion,
  ModDependency,
  ModpackSearchResult,
  ModpackSearchResponse,
  ModpackVersion,
  ModSortOption,
  ModEnvironment,
  ModCategory,
} from "@mc-server-manager/shared";
import { getAllSettings } from "../settings.js";
import { logger } from "../../utils/logger.js";
import { TTLCache } from "../../utils/cache.js";
import { AppError, ValidationError } from "../../utils/errors.js";

const BASE_URL = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID = 432;
const MODS_CLASS_ID = 6;
const MODPACKS_CLASS_ID = 4471;

const LOADER_TYPE_MAP: Record<ModLoader, number> = {
  forge: 1,
  fabric: 4,
  neoforge: 6,
};

const CF_SORT_FIELD_MAP: Record<ModSortOption, string> = {
  relevance: "1",
  downloads: "6",
  updated: "3",
  newest: "4",
};

const categoriesCache = new TTLCache<ModCategory[]>(30 * 60 * 1000);
const modpackCategoriesCache = new TTLCache<ModCategory[]>(30 * 60 * 1000);

interface CurseForgeAuthor {
  id: number;
  name: string;
}

interface CurseForgeCategory {
  id: number;
  name: string;
  slug: string;
}

interface CurseForgeLogo {
  thumbnailUrl: string;
}

interface CurseForgeLinks {
  websiteUrl: string;
}

interface CurseForgeMod {
  id: number;
  slug: string;
  name: string;
  summary: string;
  authors: CurseForgeAuthor[];
  logo: CurseForgeLogo | null;
  downloadCount: number;
  dateModified: string;
  categories: CurseForgeCategory[];
  latestFilesIndexes: CurseForgeFileIndex[];
  links: CurseForgeLinks;
}

interface CurseForgeFileIndex {
  gameVersion: string;
  modLoader: number;
}

interface CurseForgeSearchResponse {
  data: CurseForgeMod[];
  pagination: {
    index: number;
    pageSize: number;
    resultCount: number;
    totalCount: number;
  };
}

interface CurseForgeFileDependency {
  modId: number;
  relationType: number;
}

interface CurseForgeFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  sortableGameVersions: CurseForgeSortableGameVersion[];
  dependencies: CurseForgeFileDependency[];
  releaseType: number;
  fileDate: string;
  serverPackFileId: number | null;
  isServerPack: boolean | null;
}

interface CurseForgeSortableGameVersion {
  gameVersion: string;
  gameVersionName: string;
  gameVersionTypeId: number;
}

interface CurseForgeFilesResponse {
  data: CurseForgeFile[];
}

interface CurseForgeCategoryItem {
  id: number;
  name: string;
  slug: string;
  url: string;
  iconUrl: string;
  classId: number;
  parentCategoryId: number;
}

interface CurseForgeCategoriesResponse {
  data: CurseForgeCategoryItem[];
}

function getApiKey(): string {
  const settings = getAllSettings();
  return settings.curseforgeApiKey;
}

/**
 * Returns true if a CurseForge API key is configured.
 */
export function isConfigured(): boolean {
  return getApiKey().length > 0;
}

async function curseforgeFetch<T>(path: string): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ValidationError("CurseForge API key not configured");
  }

  const url = `${BASE_URL}${path}`;
  logger.debug({ url }, "CurseForge API request");

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(
      `CurseForge API error ${res.status}: ${res.statusText} - ${body}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  return (await res.json()) as T;
}

async function curseforgePost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ValidationError("CurseForge API key not configured");
  }

  const url = `${BASE_URL}${path}`;
  logger.debug({ url }, "CurseForge API POST request");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError(
      `CurseForge API error ${res.status}: ${res.statusText} - ${text}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  return (await res.json()) as T;
}

function extractMcVersions(mod: CurseForgeMod): string[] {
  const versions = new Set<string>();
  for (const idx of mod.latestFilesIndexes) {
    if (idx.gameVersion) {
      versions.add(idx.gameVersion);
    }
  }
  return Array.from(versions);
}

function extractLoaders(mod: CurseForgeMod): ModLoader[] {
  const loaders = new Set<ModLoader>();
  for (const idx of mod.latestFilesIndexes) {
    for (const [loader, typeId] of Object.entries(LOADER_TYPE_MAP)) {
      if (idx.modLoader === typeId) {
        loaders.add(loader as ModLoader);
      }
    }
  }
  return Array.from(loaders);
}

function mapMod(mod: CurseForgeMod): ModSearchResult {
  return {
    source: "curseforge",
    sourceId: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    description: mod.summary,
    author: mod.authors.map((a) => a.name).join(", "),
    iconUrl: mod.logo?.thumbnailUrl ?? "",
    downloads: mod.downloadCount,
    lastUpdated: mod.dateModified,
    categories: mod.categories.map((c) => c.name),
    mcVersions: extractMcVersions(mod),
    loaders: extractLoaders(mod),
  };
}

function mapModpack(mod: CurseForgeMod): ModpackSearchResult {
  return {
    source: "curseforge",
    sourceId: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    description: mod.summary,
    author: mod.authors.map((a) => a.name).join(", "),
    iconUrl: mod.logo?.thumbnailUrl ?? "",
    downloads: mod.downloadCount,
    lastUpdated: mod.dateModified,
    categories: mod.categories.map((c) => c.name),
    mcVersions: extractMcVersions(mod),
    loaders: extractLoaders(mod),
  };
}

function mapDependencyType(relationType: number): ModDependency["type"] {
  switch (relationType) {
    case 3:
      return "required";
    case 2:
      return "optional";
    case 5:
      return "incompatible";
    default:
      return "optional";
  }
}

function extractFileLoaders(file: CurseForgeFile): ModLoader[] {
  const loaders: ModLoader[] = [];
  for (const gv of file.gameVersions) {
    const lower = gv.toLowerCase();
    if (lower === "forge" || lower === "fabric" || lower === "neoforge") {
      loaders.push(lower as ModLoader);
    }
  }
  return loaders;
}

function extractFileMcVersions(file: CurseForgeFile): string[] {
  const mcVersionPattern = /^\d+\.\d+(\.\d+)?$/;
  return file.gameVersions.filter((v) => mcVersionPattern.test(v));
}

function mapFile(file: CurseForgeFile): ModVersion {
  if (!file.downloadUrl) {
    logger.warn(
      { modId: file.modId, fileId: file.id, fileName: file.fileName },
      "CurseForge file has restricted download URL",
    );
  }

  let releaseType: ModVersion["releaseType"];
  switch (file.releaseType) {
    case 1:
      releaseType = "release";
      break;
    case 2:
      releaseType = "beta";
      break;
    default:
      releaseType = "alpha";
      break;
  }

  return {
    versionId: String(file.id),
    source: "curseforge",
    sourceId: String(file.modId),
    name: file.displayName,
    versionNumber: file.displayName,
    mcVersions: extractFileMcVersions(file),
    loaders: extractFileLoaders(file),
    fileName: file.fileName,
    fileSize: file.fileLength,
    downloadUrl: file.downloadUrl ?? "",
    dependencies: file.dependencies.map((dep) => ({
      projectId: String(dep.modId),
      type: mapDependencyType(dep.relationType),
    })),
    releaseType,
    datePublished: file.fileDate,
  };
}

function mapModpackFile(file: CurseForgeFile): ModpackVersion {
  let releaseType: ModpackVersion["releaseType"];
  switch (file.releaseType) {
    case 1:
      releaseType = "release";
      break;
    case 2:
      releaseType = "beta";
      break;
    default:
      releaseType = "alpha";
      break;
  }

  return {
    versionId: String(file.id),
    source: "curseforge",
    sourceId: String(file.modId),
    name: file.displayName,
    versionNumber: file.displayName,
    mcVersions: extractFileMcVersions(file),
    loaders: extractFileLoaders(file),
    fileUrl: file.downloadUrl ?? "",
    fileSize: file.fileLength,
    releaseType,
    datePublished: file.fileDate,
    serverPackFileId: file.serverPackFileId
      ? String(file.serverPackFileId)
      : undefined,
  };
}

/**
 * Search for mods on CurseForge.
 */
export async function searchMods(
  query: string,
  loader: ModLoader,
  mcVersion: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categoryId?: string,
  _environment?: ModEnvironment,
): Promise<ModSearchResponse> {
  if (!isConfigured()) {
    return { results: [], totalHits: 0 };
  }

  try {
    const resolvedSort = sort ?? (query ? "relevance" : "downloads");

    const params = new URLSearchParams({
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(MODS_CLASS_ID),
      modLoaderType: String(LOADER_TYPE_MAP[loader]),
      gameVersion: mcVersion,
      index: String(offset),
      pageSize: String(limit),
      sortField: CF_SORT_FIELD_MAP[resolvedSort],
      sortOrder: "desc",
    });

    if (query) {
      params.set("searchFilter", query);
    }

    if (categoryId) {
      params.set("categoryId", categoryId);
    }

    const data = await curseforgeFetch<CurseForgeSearchResponse>(
      `/mods/search?${params.toString()}`,
    );

    return {
      results: data.data.map(mapMod),
      totalHits: data.pagination.totalCount,
    };
  } catch (err) {
    logger.error({ err, query, loader, mcVersion }, "CurseForge search failed");
    return { results: [], totalHits: 0 };
  }
}

/**
 * Search for modpacks on CurseForge.
 */
export async function searchModpacks(
  query: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categoryId?: string,
  _environment?: ModEnvironment,
  mcVersion?: string,
): Promise<ModpackSearchResponse> {
  if (!isConfigured()) {
    return { results: [], totalHits: 0 };
  }

  try {
    const resolvedSort = sort ?? (query ? "relevance" : "downloads");

    const params = new URLSearchParams({
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(MODPACKS_CLASS_ID),
      index: String(offset),
      pageSize: String(limit),
      sortField: CF_SORT_FIELD_MAP[resolvedSort],
      sortOrder: "desc",
    });

    if (query) {
      params.set("searchFilter", query);
    }

    if (categoryId) {
      params.set("categoryId", categoryId);
    }

    if (mcVersion) {
      params.set("gameVersion", mcVersion);
    }

    const data = await curseforgeFetch<CurseForgeSearchResponse>(
      `/mods/search?${params.toString()}`,
    );

    return {
      results: data.data.map(mapModpack),
      totalHits: data.pagination.totalCount,
    };
  } catch (err) {
    logger.error({ err, query }, "CurseForge modpack search failed");
    return { results: [], totalHits: 0 };
  }
}

/**
 * Get available versions for a CurseForge mod filtered by loader and MC version.
 */
export async function getModVersions(
  modId: string,
  loader: ModLoader,
  mcVersion: string,
): Promise<ModVersion[]> {
  if (!isConfigured()) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      modLoaderType: String(LOADER_TYPE_MAP[loader]),
      gameVersion: mcVersion,
    });

    const data = await curseforgeFetch<CurseForgeFilesResponse>(
      `/mods/${encodeURIComponent(modId)}/files?${params.toString()}`,
    );

    return data.data.map(mapFile);
  } catch (err) {
    logger.error(
      { err, modId, loader, mcVersion },
      "Failed to fetch CurseForge mod versions",
    );
    return [];
  }
}

/**
 * Get available versions for a CurseForge modpack without filtering.
 */
export async function getModpackVersions(
  modId: string,
): Promise<ModpackVersion[]> {
  if (!isConfigured()) {
    return [];
  }

  try {
    const data = await curseforgeFetch<CurseForgeFilesResponse>(
      `/mods/${encodeURIComponent(modId)}/files`,
    );

    return data.data.map(mapModpackFile);
  } catch (err) {
    logger.error({ err, modId }, "Failed to fetch CurseForge modpack versions");
    return [];
  }
}

export async function getModsByIds(modIds: number[]): Promise<CurseForgeMod[]> {
  if (!isConfigured()) {
    return [];
  }

  try {
    const response = await curseforgePost<{ data: CurseForgeMod[] }>("/mods", {
      modIds,
    });
    return response.data;
  } catch (err) {
    logger.error({ err, modIds }, "Failed to fetch CurseForge mods by IDs");
    return [];
  }
}

interface CurseForgeFileResponse {
  data: CurseForgeFile;
}

export async function getFilesByIds(
  fileIds: { modId: number; fileId: number }[],
): Promise<CurseForgeFile[]> {
  if (!isConfigured()) {
    return [];
  }

  const MAX_CONCURRENT = 10;
  const files: CurseForgeFile[] = [];

  try {
    for (let i = 0; i < fileIds.length; i += MAX_CONCURRENT) {
      const batch = fileIds.slice(i, i + MAX_CONCURRENT);
      const promises = batch.map((entry) =>
        curseforgeFetch<CurseForgeFileResponse>(
          `/mods/${entry.modId}/files/${entry.fileId}`,
        ),
      );

      const results = await Promise.all(promises);
      files.push(...results.map((r) => r.data));
    }

    return files;
  } catch (err) {
    logger.error(
      { err, count: fileIds.length },
      "Failed to fetch CurseForge files by IDs",
    );
    return [];
  }
}

export async function getCategories(): Promise<ModCategory[]> {
  if (!isConfigured()) return [];

  return categoriesCache.get(async () => {
    try {
      const data = await curseforgeFetch<CurseForgeCategoriesResponse>(
        `/categories?gameId=${MINECRAFT_GAME_ID}&classId=${MODS_CLASS_ID}`,
      );
      return data.data
        .filter((c) => c.classId === MODS_CLASS_ID)
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          curseforgeId: String(c.id),
          iconUrl: c.iconUrl || undefined,
        }));
    } catch (err) {
      logger.error({ err }, "Failed to fetch CurseForge categories");
      return [];
    }
  });
}

export async function getModpackCategories(): Promise<ModCategory[]> {
  if (!isConfigured()) return [];

  return modpackCategoriesCache.get(async () => {
    try {
      const data = await curseforgeFetch<CurseForgeCategoriesResponse>(
        `/categories?gameId=${MINECRAFT_GAME_ID}&classId=${MODPACKS_CLASS_ID}`,
      );
      return data.data
        .filter((c) => c.classId === MODPACKS_CLASS_ID)
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          curseforgeId: String(c.id),
          iconUrl: c.iconUrl || undefined,
        }));
    } catch (err) {
      logger.error({ err }, "Failed to fetch CurseForge modpack categories");
      return [];
    }
  });
}
