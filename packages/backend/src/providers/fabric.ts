/**
 * FabricProvider — handles Fabric Minecraft server operations.
 *
 * Fabric provides a direct server JAR download (no installer step),
 * making it almost as simple as Paper.
 *
 * Meta API: https://meta.fabricmc.net/v2/
 */

import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type {
  McVersion,
  FabricVersionInfo,
  DownloadRequest,
  DownloadJob,
  Server,
} from "@mc-server-manager/shared";
import type { ServerProvider, LaunchConfig } from "./provider.js";
import { registerProvider } from "./registry.js";
import { TTLCache } from "../utils/cache.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const FABRIC_META_API = "https://meta.fabricmc.net/v2";

// --- Fabric Meta API response types ---

interface FabricGameVersion {
  version: string;
  stable: boolean;
}

interface FabricLoaderVersion {
  separator: string;
  build: number;
  maven: string;
  version: string;
  stable: boolean;
}

// --- Caches ---

const gameVersionsCache = new TTLCache<FabricGameVersion[]>();
const loaderVersionsCache = new TTLCache<FabricLoaderVersion[]>();

class FabricProvider implements ServerProvider {
  readonly type = "fabric" as const;

  async getVersions(includeSnapshots = false): Promise<McVersion[]> {
    const gameVersions = await gameVersionsCache.get(async () => {
      logger.info("Fetching Fabric game versions...");
      const res = await fetch(`${FABRIC_META_API}/versions/game`);
      if (!res.ok) {
        throw new AppError(
          `Failed to fetch Fabric game versions: ${res.status} ${res.statusText}`,
          502,
          "UPSTREAM_ERROR",
        );
      }
      return (await res.json()) as FabricGameVersion[];
    });

    return gameVersions
      .filter((v) => includeSnapshots || v.stable)
      .map((v) => ({
        id: v.version,
        type: (v.stable ? "release" : "snapshot") as "release" | "snapshot",
        releaseTime: "", // Fabric Meta doesn't provide release times
      }));
  }

  async getVersionInfo(mcVersion: string): Promise<FabricVersionInfo> {
    const loaderVersions = await this.getLoaderVersions();

    const stableLoaders = loaderVersions.filter((l) => l.stable);
    const latestLoader =
      stableLoaders.length > 0
        ? stableLoaders[0].version
        : loaderVersions[0].version;

    return {
      type: "fabric",
      mcVersion,
      loaderVersions: loaderVersions.map((l) => l.version),
      latestLoader,
    };
  }

  async download(
    request: DownloadRequest,
    destDir: string,
    job: DownloadJob,
  ): Promise<string> {
    if (request.serverType !== "fabric") {
      throw new AppError(
        "FabricProvider can only handle fabric downloads",
        400,
        "INVALID_PROVIDER",
      );
    }

    // Determine loader version
    let loaderVersion: string;
    if ("loaderVersion" in request && request.loaderVersion) {
      loaderVersion = request.loaderVersion;
    } else {
      const info = await this.getVersionInfo(request.mcVersion);
      loaderVersion = info.latestLoader;
    }

    // Fabric provides a direct server JAR download URL
    const downloadUrl = `${FABRIC_META_API}/versions/loader/${request.mcVersion}/${loaderVersion}/1.0.1/server/jar`;

    job.status = "downloading";
    job.log.push(
      `Downloading Fabric server for MC ${request.mcVersion} (loader ${loaderVersion})...`,
    );

    logger.info(
      {
        jobId: job.id,
        version: request.mcVersion,
        loaderVersion,
        url: downloadUrl,
      },
      "Starting Fabric server JAR download",
    );

    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });

    const jarName = `fabric-server-mc.${request.mcVersion}-loader.${loaderVersion}-launch.jar`;
    const destPath = path.join(destDir, jarName);
    const tempPath = destPath + ".tmp";

    // Stream download (Fabric doesn't provide hashes for this endpoint)
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) {
      throw new AppError(
        `Download failed: ${res.status} ${res.statusText}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      job.totalBytes = parseInt(contentLength, 10);
    }

    let downloaded = 0;

    const trackingStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            downloaded += value.byteLength;
            job.downloadedBytes = downloaded;
            if (job.totalBytes && job.totalBytes > 0) {
              job.progress = Math.round((downloaded / job.totalBytes) * 100);
            }
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    const nodeStream = Readable.fromWeb(
      trackingStream as import("stream/web").ReadableStream,
    );
    const fileStream = createWriteStream(tempPath);

    await pipeline(nodeStream, fileStream);

    // Move temp file to final destination
    fs.renameSync(tempPath, destPath);

    job.log.push(
      "Download complete (no hash verification available for Fabric)",
    );

    logger.info(
      { jobId: job.id, path: destPath },
      "Fabric server JAR download completed",
    );

    return destPath;
  }

  getLaunchConfig(server: Server): LaunchConfig {
    const jvmArgs = server.jvmArgs.split(/\s+/).filter(Boolean);
    return {
      javaArgs: [...jvmArgs, "-jar", server.jarPath, "nogui"],
      cwd: server.directory,
    };
  }

  // Fabric uses the same Done regex and stop command as vanilla
  // No need to override getDoneRegex() or getStopCommand()

  validateInstallation(server: Server): string | null {
    if (!fs.existsSync(server.jarPath)) {
      return `Server JAR not found at ${server.jarPath}. Download or set the JAR path first.`;
    }
    if (!fs.existsSync(server.directory)) {
      return `Server directory not found: ${server.directory}`;
    }
    return null;
  }

  // --- Private helpers ---

  private async getLoaderVersions(): Promise<FabricLoaderVersion[]> {
    return loaderVersionsCache.get(async () => {
      logger.info("Fetching Fabric loader versions...");
      const res = await fetch(`${FABRIC_META_API}/versions/loader`);
      if (!res.ok) {
        throw new AppError(
          `Failed to fetch Fabric loader versions: ${res.status} ${res.statusText}`,
          502,
          "UPSTREAM_ERROR",
        );
      }
      return (await res.json()) as FabricLoaderVersion[];
    });
  }
}

// Register on import
registerProvider(new FabricProvider());
