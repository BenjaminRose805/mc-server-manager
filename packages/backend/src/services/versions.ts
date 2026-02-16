import type {
  McVersion,
  MojangVersionManifest,
  MojangVersionEntry,
} from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

const MOJANG_MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

/**
 * Cache for the version manifest.
 * Re-fetched if older than 10 minutes.
 */
let cachedManifest: MojangVersionManifest | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch the Mojang version manifest (cached for 10 minutes).
 */
export async function getVersionManifest(): Promise<MojangVersionManifest> {
  const now = Date.now();
  if (cachedManifest && now - cachedAt < CACHE_TTL_MS) {
    return cachedManifest;
  }

  logger.info("Fetching Mojang version manifest...");

  const res = await fetch(MOJANG_MANIFEST_URL);
  if (!res.ok) {
    throw new AppError(
      `Failed to fetch version manifest: ${res.status} ${res.statusText}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const manifest = (await res.json()) as MojangVersionManifest;
  cachedManifest = manifest;
  cachedAt = now;

  logger.info(
    { versionCount: manifest.versions.length },
    "Version manifest cached",
  );
  return manifest;
}

/**
 * Get available Minecraft versions in our simplified format.
 * Filters to releases and snapshots, sorted by release date descending (newest first).
 */
export async function getVanillaVersions(
  includeSnapshots = false,
): Promise<McVersion[]> {
  const manifest = await getVersionManifest();

  return manifest.versions
    .filter((v) => {
      if (v.type === "release") return true;
      if (v.type === "snapshot" && includeSnapshots) return true;
      return false;
    })
    .map((v) => ({
      id: v.id,
      type: v.type as "release" | "snapshot",
      releaseTime: v.releaseTime,
    }));
}

/**
 * Get the Mojang version entry (with download URL) for a specific version.
 */
export async function getVersionEntry(
  versionId: string,
): Promise<MojangVersionEntry | null> {
  const manifest = await getVersionManifest();
  return manifest.versions.find((v) => v.id === versionId) ?? null;
}

/**
 * Mojang's version JSON (fetched per-version) contains the server JAR download URL.
 */
interface MojangVersionDetail {
  downloads: {
    server?: {
      sha1: string;
      size: number;
      url: string;
    };
  };
}

/**
 * Fetch the server JAR download URL and size for a specific version.
 * Returns null if no server JAR is available (very old versions don't have one).
 */
export async function getServerJarInfo(
  versionId: string,
): Promise<{ url: string; sha1: string; size: number } | null> {
  const entry = await getVersionEntry(versionId);
  if (!entry) {
    logger.warn({ versionId }, "Version not found in manifest");
    return null;
  }

  // Fetch the per-version detail JSON
  const res = await fetch(entry.url);
  if (!res.ok) {
    throw new AppError(
      `Failed to fetch version detail for ${versionId}: ${res.status}`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  const detail = (await res.json()) as MojangVersionDetail;
  const serverDownload = detail.downloads.server;
  if (!serverDownload) {
    logger.warn({ versionId }, "No server JAR available for this version");
    return null;
  }

  return {
    url: serverDownload.url,
    sha1: serverDownload.sha1,
    size: serverDownload.size,
  };
}
