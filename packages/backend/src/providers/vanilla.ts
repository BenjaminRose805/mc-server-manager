/**
 * VanillaProvider — handles vanilla Minecraft server operations.
 *
 * Extracts existing vanilla logic from versions.ts and download.ts
 * into the provider interface pattern.
 */

import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import type {
  McVersion,
  DownloadRequest,
  DownloadJob,
  Server,
} from "@mc-server-manager/shared";
import type { ServerProvider, LaunchConfig } from "./provider.js";
import { registerProvider } from "./registry.js";
import { getVanillaVersions, getServerJarInfo } from "../services/versions.js";
import { AppError, NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

class VanillaProvider implements ServerProvider {
  readonly type = "vanilla" as const;

  async getVersions(includeSnapshots = false): Promise<McVersion[]> {
    return getVanillaVersions(includeSnapshots);
  }

  async download(
    request: DownloadRequest,
    destDir: string,
    job: DownloadJob,
  ): Promise<string> {
    if (request.serverType !== "vanilla") {
      throw new AppError(
        "VanillaProvider can only handle vanilla downloads",
        400,
        "INVALID_PROVIDER",
      );
    }

    // Look up the JAR download info from Mojang
    const jarInfo = await getServerJarInfo(request.mcVersion);
    if (!jarInfo) {
      throw new NotFoundError("server JAR", request.mcVersion);
    }

    job.totalBytes = jarInfo.size;
    job.status = "downloading";

    logger.info(
      {
        jobId: job.id,
        version: request.mcVersion,
        size: jarInfo.size,
        url: jarInfo.url,
      },
      "Starting vanilla JAR download",
    );

    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, "server.jar");
    const tempPath = destPath + ".tmp";

    // Stream download with progress tracking
    const res = await fetch(jarInfo.url);
    if (!res.ok || !res.body) {
      throw new AppError(
        `Download failed: ${res.status} ${res.statusText}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    const hasher = crypto.createHash("sha1");
    let downloaded = 0;

    const trackingStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            downloaded += value.byteLength;
            hasher.update(value);
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

    // Verify SHA1 hash
    const actualSha1 = hasher.digest("hex");
    if (actualSha1 !== jarInfo.sha1) {
      fs.unlinkSync(tempPath);
      throw new AppError(
        `SHA1 mismatch: expected ${jarInfo.sha1}, got ${actualSha1}`,
        502,
        "INTEGRITY_ERROR",
      );
    }

    // Move temp file to final destination
    fs.renameSync(tempPath, destPath);

    logger.info(
      { jobId: job.id, path: destPath, sha1: actualSha1 },
      "Vanilla JAR download completed and verified",
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

  validateInstallation(server: Server): string | null {
    if (!fs.existsSync(server.jarPath)) {
      return `Server JAR not found at ${server.jarPath}. Download or set the JAR path first.`;
    }
    if (!fs.existsSync(server.directory)) {
      return `Server directory not found: ${server.directory}`;
    }
    return null;
  }
}

// Register on import
registerProvider(new VanillaProvider());
