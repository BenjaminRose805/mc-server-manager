import type {
  ModLoader,
  ModSearchResult,
  ModSearchResponse,
  ModVersion,
  ModDependency,
  ModSide,
  ModpackSearchResult,
  ModpackSearchResponse,
  ModpackVersion,
  ModSortOption,
  ModEnvironment,
  ModCategory,
} from "@mc-server-manager/shared";
import { TTLCache } from "../../utils/cache.js";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/errors.js";

const BASE_URL = "https://api.modrinth.com/v2";
const USER_AGENT =
  "mc-server-manager/1.0.0 (https://github.com/mc-server-manager)";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const MODRINTH_SORT_MAP: Record<ModSortOption, string> = {
  relevance: "relevance",
  downloads: "downloads",
  updated: "updated",
  newest: "newest",
};

interface ModrinthSearchHit {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string;
  downloads: number;
  date_modified: string;
  categories: string[];
  versions: string[];
  loaders: string[];
  client_side?: string;
  server_side?: string;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string;
  downloads: number;
  updated: string;
  categories: string[];
  game_versions: string[];
  loaders: string[];
  team: string;
}

interface ModrinthTagCategory {
  icon: string;
  name: string;
  project_type: string;
  header: string;
}

interface ModrinthTeamMember {
  user: {
    username: string;
  };
  role: string;
}

interface ModrinthVersionFile {
  filename: string;
  url: string;
  size: number;
  primary: boolean;
}

interface ModrinthDependency {
  project_id: string | null;
  version_id: string | null;
  dependency_type: "required" | "optional" | "incompatible" | "embedded";
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
  dependencies: ModrinthDependency[];
  version_type: "release" | "beta" | "alpha";
  date_published: string;
}

const searchCaches = new Map<string, TTLCache<ModSearchResponse>>();
const modpackSearchCaches = new Map<string, TTLCache<ModpackSearchResponse>>();
const categoriesCache = new TTLCache<ModCategory[]>(30 * 60 * 1000);
const modpackCategoriesCache = new TTLCache<ModCategory[]>(30 * 60 * 1000);

function getSearchCache(key: string): TTLCache<ModSearchResponse> {
  let cache = searchCaches.get(key);
  if (!cache) {
    cache = new TTLCache<ModSearchResponse>(SEARCH_CACHE_TTL_MS);
    searchCaches.set(key, cache);
  }
  return cache;
}

function getModpackSearchCache(key: string): TTLCache<ModpackSearchResponse> {
  let cache = modpackSearchCaches.get(key);
  if (!cache) {
    cache = new TTLCache<ModpackSearchResponse>(SEARCH_CACHE_TTL_MS);
    modpackSearchCaches.set(key, cache);
  }
  return cache;
}

async function modrinthFetch<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  logger.debug({ url }, "Modrinth API request");

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(
      `Modrinth API error ${res.status}: ${res.statusText} - ${body}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  return (await res.json()) as T;
}

function mapLoaders(loaders: string[] | undefined | null): ModLoader[] {
  if (!loaders) return [];
  const validLoaders: ModLoader[] = [];
  for (const loader of loaders) {
    if (loader === "forge" || loader === "fabric" || loader === "neoforge") {
      validLoaders.push(loader);
    }
  }
  return validLoaders;
}

function deriveModSide(clientSide?: string, serverSide?: string): ModSide {
  if (!clientSide || !serverSide) return "unknown";
  const clientRequired = clientSide === "required" || clientSide === "optional";
  const serverRequired = serverSide === "required" || serverSide === "optional";
  if (clientRequired && !serverRequired) return "client";
  if (!clientRequired && serverRequired) return "server";
  if (clientRequired && serverRequired) return "both";
  return "unknown";
}

function mapSearchHit(hit: ModrinthSearchHit): ModSearchResult {
  const loaders = mapLoaders(hit.loaders);
  const loadersFromCategories =
    loaders.length > 0 ? loaders : mapLoaders(hit.categories);

  return {
    source: "modrinth",
    sourceId: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url ?? "",
    downloads: hit.downloads,
    lastUpdated: hit.date_modified,
    categories: hit.categories,
    mcVersions: hit.versions,
    loaders: loadersFromCategories,
    clientSide: hit.client_side ?? undefined,
    serverSide: hit.server_side ?? undefined,
  };
}

function mapDependency(dep: ModrinthDependency): ModDependency | null {
  if (!dep.project_id) return null;

  let type: ModDependency["type"];
  switch (dep.dependency_type) {
    case "required":
      type = "required";
      break;
    case "incompatible":
      type = "incompatible";
      break;
    default:
      type = "optional";
      break;
  }

  return {
    projectId: dep.project_id,
    versionId: dep.version_id ?? undefined,
    type,
  };
}

function mapVersion(v: ModrinthVersion): ModVersion {
  const primaryFile = v.files.find((f) => f.primary) ?? v.files[0];

  return {
    versionId: v.id,
    source: "modrinth",
    sourceId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    mcVersions: v.game_versions,
    loaders: mapLoaders(v.loaders),
    fileName: primaryFile?.filename ?? "",
    fileSize: primaryFile?.size ?? 0,
    downloadUrl: primaryFile?.url ?? "",
    dependencies: v.dependencies
      .map(mapDependency)
      .filter((d): d is ModDependency => d !== null),
    releaseType: v.version_type,
    datePublished: v.date_published,
  };
}

/**
 * Search for mods on Modrinth.
 */
export async function searchMods(
  query: string,
  loader: ModLoader,
  mcVersion: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categories?: string[],
  environment?: ModEnvironment,
): Promise<ModSearchResponse> {
  const cacheKey = `${query}:${loader}:${mcVersion}:${offset}:${limit}:${sort ?? ""}:${(categories ?? []).join(",")}:${environment ?? ""}`;
  const cache = getSearchCache(cacheKey);

  return cache.get(async () => {
    const facetGroups: string[][] = [
      ["project_type:mod"],
      [`categories:${loader}`],
      [`versions:${mcVersion}`],
    ];

    if (categories && categories.length > 0) {
      facetGroups.push(categories.map((c) => `categories:${c}`));
    }

    if (environment === "client") {
      facetGroups.push(["client_side:required", "client_side:optional"]);
    } else if (environment === "server") {
      facetGroups.push(["server_side:required", "server_side:optional"]);
    } else if (environment === "both") {
      facetGroups.push(["client_side:required", "client_side:optional"]);
      facetGroups.push(["server_side:required", "server_side:optional"]);
    }

    const resolvedSort = sort ?? (query ? "relevance" : "downloads");

    const params = new URLSearchParams({
      facets: JSON.stringify(facetGroups),
      offset: String(offset),
      limit: String(limit),
      index: MODRINTH_SORT_MAP[resolvedSort],
    });

    if (query) {
      params.set("query", query);
    }

    try {
      const data = await modrinthFetch<ModrinthSearchResponse>(
        `/search?${params.toString()}`,
      );

      return {
        results: data.hits.map(mapSearchHit),
        totalHits: data.total_hits,
      };
    } catch (err) {
      logger.error({ err, query, loader, mcVersion }, "Modrinth search failed");
      return { results: [], totalHits: 0 };
    }
  });
}

/**
 * Search for modpacks on Modrinth.
 */
export async function searchModpacks(
  query: string,
  offset = 0,
  limit = 20,
  sort?: ModSortOption,
  categories?: string[],
  environment?: ModEnvironment,
  mcVersion?: string,
): Promise<ModpackSearchResponse> {
  const cacheKey = `${query}:${offset}:${limit}:${sort ?? ""}:${(categories ?? []).join(",")}:${environment ?? ""}:${mcVersion ?? ""}`;
  const cache = getModpackSearchCache(cacheKey);

  return cache.get(async () => {
    const facetGroups: string[][] = [["project_type:modpack"]];

    if (mcVersion) {
      facetGroups.push([`versions:${mcVersion}`]);
    }

    if (categories && categories.length > 0) {
      facetGroups.push(categories.map((c) => `categories:${c}`));
    }

    if (environment === "client") {
      facetGroups.push(["client_side:required", "client_side:optional"]);
    } else if (environment === "server") {
      facetGroups.push(["server_side:required", "server_side:optional"]);
    } else if (environment === "both") {
      facetGroups.push(["client_side:required", "client_side:optional"]);
      facetGroups.push(["server_side:required", "server_side:optional"]);
    }

    const resolvedSort = sort ?? (query ? "relevance" : "downloads");

    const params = new URLSearchParams({
      facets: JSON.stringify(facetGroups),
      offset: String(offset),
      limit: String(limit),
      index: MODRINTH_SORT_MAP[resolvedSort],
    });

    if (query) {
      params.set("query", query);
    }

    try {
      const data = await modrinthFetch<ModrinthSearchResponse>(
        `/search?${params.toString()}`,
      );

      return {
        results: data.hits.map((hit) => ({
          source: "modrinth" as const,
          sourceId: hit.project_id,
          slug: hit.slug,
          name: hit.title,
          description: hit.description,
          author: hit.author,
          iconUrl: hit.icon_url ?? "",
          downloads: hit.downloads,
          lastUpdated: hit.date_modified,
          categories: hit.categories,
          mcVersions: hit.versions,
          loaders: mapLoaders(hit.loaders),
        })),
        totalHits: data.total_hits,
      };
    } catch (err) {
      logger.error({ err, query }, "Modrinth modpack search failed");
      return { results: [], totalHits: 0 };
    }
  });
}

/**
 * Get available versions for a Modrinth project filtered by loader and MC version.
 */
export async function getModVersions(
  projectId: string,
  loader: ModLoader,
  mcVersion: string,
): Promise<ModVersion[]> {
  try {
    const params = new URLSearchParams({
      loaders: JSON.stringify([loader]),
      game_versions: JSON.stringify([mcVersion]),
    });

    const versions = await modrinthFetch<ModrinthVersion[]>(
      `/project/${encodeURIComponent(projectId)}/version?${params.toString()}`,
    );

    return versions.map(mapVersion);
  } catch (err) {
    logger.error(
      { err, projectId, loader, mcVersion },
      "Failed to fetch Modrinth mod versions",
    );
    return [];
  }
}

/**
 * Get available versions for a Modrinth modpack project.
 */
export async function getModpackVersions(
  projectId: string,
): Promise<ModpackVersion[]> {
  try {
    const versions = await modrinthFetch<ModrinthVersion[]>(
      `/project/${encodeURIComponent(projectId)}/version`,
    );

    return versions.map((v) => {
      const primaryFile = v.files.find((f) => f.primary) ?? v.files[0];
      return {
        versionId: v.id,
        source: "modrinth" as const,
        sourceId: v.project_id,
        name: v.name,
        versionNumber: v.version_number,
        mcVersions: v.game_versions,
        loaders: mapLoaders(v.loaders),
        fileUrl: primaryFile?.url ?? "",
        fileSize: primaryFile?.size ?? 0,
        releaseType: v.version_type,
        datePublished: v.date_published,
      };
    });
  } catch (err) {
    logger.error(
      { err, projectId },
      "Failed to fetch Modrinth modpack versions",
    );
    return [];
  }
}

/**
 * Get project details from Modrinth.
 */
export async function getProjectDetails(
  projectId: string,
): Promise<ModSearchResult> {
  const project = await modrinthFetch<ModrinthProject>(
    `/project/${encodeURIComponent(projectId)}`,
  );

  let author = "";
  try {
    const members = await modrinthFetch<ModrinthTeamMember[]>(
      `/project/${encodeURIComponent(projectId)}/members`,
    );
    const owner = members.find((m) => m.role === "Owner") ?? members[0];
    if (owner) {
      author = owner.user.username;
    }
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to fetch Modrinth project team");
  }

  return {
    source: "modrinth",
    sourceId: project.id,
    slug: project.slug,
    name: project.title,
    description: project.description,
    author,
    iconUrl: project.icon_url ?? "",
    downloads: project.downloads,
    lastUpdated: project.updated,
    categories: project.categories,
    mcVersions: project.game_versions,
    loaders: mapLoaders(project.loaders),
  };
}

/**
 * Get project side information by slug for CurseForge cross-reference.
 */
export async function getProjectBySlug(slug: string): Promise<{
  clientSide: string;
  serverSide: string;
  sourceId: string;
} | null> {
  try {
    const project = await modrinthFetch<
      ModrinthProject & { client_side?: string; server_side?: string }
    >(`/project/${encodeURIComponent(slug)}`);

    return {
      clientSide: project.client_side ?? "",
      serverSide: project.server_side ?? "",
      sourceId: project.id,
    };
  } catch (err) {
    logger.debug({ err, slug }, "Project not found on Modrinth");
    return null;
  }
}

/**
 * Get available mod categories from Modrinth.
 */
export async function getCategories(): Promise<ModCategory[]> {
  return categoriesCache.get(async () => {
    try {
      const data = await modrinthFetch<ModrinthTagCategory[]>("/tag/category");
      return data
        .filter((c) => c.project_type === "mod")
        .map((c) => ({
          slug: c.name,
          name: c.name
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          modrinthId: c.name,
          iconUrl: c.icon || undefined,
        }));
    } catch (err) {
      logger.error({ err }, "Failed to fetch Modrinth categories");
      return [];
    }
  });
}

/**
 * Get available modpack categories from Modrinth.
 */
export async function getModpackCategories(): Promise<ModCategory[]> {
  return modpackCategoriesCache.get(async () => {
    try {
      const data = await modrinthFetch<ModrinthTagCategory[]>("/tag/category");
      return data
        .filter((c) => c.project_type === "modpack")
        .map((c) => ({
          slug: c.name,
          name: c.name
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          modrinthId: c.name,
          iconUrl: c.icon || undefined,
        }));
    } catch (err) {
      logger.error({ err }, "Failed to fetch Modrinth modpack categories");
      return [];
    }
  });
}
