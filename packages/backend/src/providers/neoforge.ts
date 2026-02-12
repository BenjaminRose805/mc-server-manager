/**
 * NeoForgeProvider — handles NeoForge server operations.
 *
 * NeoForge has a two-phase install: download installer JAR, then run it.
 * Uses @args-file launch pattern (all NeoForge versions are modern).
 *
 * Maven repo: https://maven.neoforged.net/releases/net/neoforged/neoforge/
 */

import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type {
  McVersion,
  NeoForgeVersionInfo,
  DownloadRequest,
  DownloadJob,
  Server,
} from "@mc-server-manager/shared";
import type { ServerProvider, LaunchConfig } from "./provider.js";
import { registerProvider } from "./registry.js";
import { TTLCache } from "../utils/cache.js";
import { logger } from "../utils/logger.js";

/** NeoForge Maven API URL for all release versions. */
const NEOFORGE_VERSIONS_URL =
  "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

/** Maven base URL for downloading NeoForge installer JARs. */
const NEOFORGE_MAVEN =
  "https://maven.neoforged.net/releases/net/neoforged/neoforge";

/** Cache for version list (10 minutes). */
const versionsCache = new TTLCache<string[]>();

/**
 * Map a NeoForge version (e.g. "21.4.50") to a Minecraft version.
 * Pattern: NeoForge X.Y.* → MC 1.X.Y (for MC >= 1.20.2).
 * When Y is 0, the MC version has no patch (e.g. NeoForge 21.0.x → MC 1.21).
 */
function neoforgeToMcVersion(neoforgeVersion: string): string {
  const parts = neoforgeVersion.split(".");
  if (parts.length < 2) return "unknown";

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);

  if (isNaN(major) || isNaN(minor)) return "unknown";

  if (minor === 0) {
    return `1.${major}`;
  }
  return `1.${major}.${minor}`;
}

/**
 * Group NeoForge versions by their derived MC version.
 * Returns Map<mcVersion, neoforgeVersion[]>.
 */
function groupByMcVersion(versions: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const v of versions) {
    const mc = neoforgeToMcVersion(v);
    if (mc === "unknown") continue;
    if (!map.has(mc)) map.set(mc, []);
    map.get(mc)!.push(v);
  }
  return map;
}

/**
 * Sort NeoForge version strings in descending order (newest first).
 * Handles versions like "21.4.50", "21.4.50-beta".
 */
function sortNeoForgeVersionsDesc(versions: string[]): string[] {
  return versions.slice().sort((a, b) => {
    const pa = a.split(/[.\-]/).map((s) => {
      const n = parseInt(s, 10);
      return isNaN(n) ? 0 : n;
    });
    const pb = b.split(/[.\-]/).map((s) => {
      const n = parseInt(s, 10);
      return isNaN(n) ? 0 : n;
    });
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na !== nb) return nb - na;
    }
    // Non-beta (shorter) sorts before beta (longer) at equal numeric parts
    if (a.includes("-") && !b.includes("-")) return 1;
    if (!a.includes("-") && b.includes("-")) return -1;
    return 0;
  });
}

/** Find unix_args.txt/win_args.txt under libraries/net/neoforged/neoforge/<version>/ */
function findArgsFile(
  serverDir: string,
  neoforgeVersion: string,
): string | null {
  const argsDir = path.join(
    serverDir,
    "libraries",
    "net",
    "neoforged",
    "neoforge",
    neoforgeVersion,
  );

  const isWindows = process.platform === "win32";
  const argsFileName = isWindows ? "win_args.txt" : "unix_args.txt";
  const argsPath = path.join(argsDir, argsFileName);

  if (fs.existsSync(argsPath)) return argsPath;

  // Fallback: search for any *_args.txt in that dir
  if (fs.existsSync(argsDir)) {
    const files = fs.readdirSync(argsDir);
    const argsFile = files.find((f) => f.endsWith("_args.txt"));
    if (argsFile) return path.join(argsDir, argsFile);
  }

  return null;
}

function runNeoForgeInstaller(
  javaPath: string,
  installerPath: string,
  serverDir: string,
  job: DownloadJob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    job.status = "installing";
    job.log.push("Running NeoForge installer...");

    logger.info(
      { jobId: job.id, installerPath, serverDir },
      "Starting NeoForge installer",
    );

    const installerProc = spawn(
      javaPath,
      ["-jar", installerPath, "--installServer"],
      {
        cwd: serverDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    installerProc.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        job.log.push(line);
        logger.debug({ jobId: job.id, line }, "NeoForge installer stdout");
      }
    });

    installerProc.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        job.log.push(line);
        logger.debug({ jobId: job.id, line }, "NeoForge installer stderr");
      }
    });

    installerProc.on("error", (err) => {
      logger.error({ jobId: job.id, err }, "NeoForge installer process error");
      reject(new Error(`NeoForge installer failed to start: ${err.message}`));
    });

    installerProc.on("exit", (code, signal) => {
      logger.info(
        { jobId: job.id, code, signal },
        "NeoForge installer process exited",
      );

      if (code === 0) {
        job.log.push("NeoForge installer completed successfully.");
        resolve();
      } else {
        const tail = job.log.slice(-5).join("\n");
        reject(
          new Error(
            `NeoForge installer exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. Last output:\n${tail}`,
          ),
        );
      }
    });
  });
}

class NeoForgeProvider implements ServerProvider {
  readonly type = "neoforge" as const;

  async getVersions(includeSnapshots = false): Promise<McVersion[]> {
    const grouped = await this.getGroupedVersions();

    const mcVersions = [...grouped.keys()].sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) return nb - na;
      }
      return 0;
    });

    return mcVersions
      .filter((v) => {
        if (includeSnapshots) return true;
        return (
          !v.includes("-") &&
          !v.includes("_") &&
          !/[a-zA-Z]/.test(v.replace(/\d+\.\d+(\.\d+)?/, ""))
        );
      })
      .map((v) => ({
        id: v,
        type: "release" as const,
        releaseTime: "",
      }));
  }

  async getVersionInfo(mcVersion: string): Promise<NeoForgeVersionInfo> {
    const grouped = await this.getGroupedVersions();
    const neoforgeVersions = grouped.get(mcVersion);

    if (!neoforgeVersions || neoforgeVersions.length === 0) {
      throw new Error(`No NeoForge versions found for Minecraft ${mcVersion}`);
    }

    const sorted = sortNeoForgeVersionsDesc(neoforgeVersions);

    return {
      type: "neoforge",
      mcVersion,
      neoforgeVersions: sorted,
      latest: sorted[0],
    };
  }

  async download(
    request: DownloadRequest,
    destDir: string,
    job: DownloadJob,
  ): Promise<string> {
    if (request.serverType !== "neoforge") {
      throw new Error("NeoForgeProvider can only handle neoforge downloads");
    }

    const neoforgeVersion = request.neoforgeVersion;

    fs.mkdirSync(destDir, { recursive: true });

    const modsDir = path.join(destDir, "mods");
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }

    const installerFileName = `neoforge-${neoforgeVersion}-installer.jar`;
    const installerUrl = `${NEOFORGE_MAVEN}/${neoforgeVersion}/${installerFileName}`;
    const installerPath = path.join(destDir, installerFileName);
    const tempPath = installerPath + ".tmp";

    job.status = "downloading";
    job.log.push(
      `Downloading NeoForge installer (NeoForge ${neoforgeVersion})...`,
    );

    logger.info(
      {
        jobId: job.id,
        neoforgeVersion,
        url: installerUrl,
      },
      "Starting NeoForge installer download",
    );

    const res = await fetch(installerUrl);
    if (!res.ok || !res.body) {
      throw new Error(
        `Failed to download NeoForge installer: ${res.status} ${res.statusText}. ` +
          `URL: ${installerUrl}`,
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
              job.progress = Math.round((downloaded / job.totalBytes) * 90);
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

    fs.renameSync(tempPath, installerPath);

    job.log.push(
      `Installer downloaded (${Math.round(downloaded / 1024 / 1024)}MB)`,
    );

    const javaPath = "java";

    await runNeoForgeInstaller(javaPath, installerPath, destDir, job);

    job.progress = 95;

    const argsFile = findArgsFile(destDir, neoforgeVersion);
    let serverJarPath: string;

    if (argsFile) {
      serverJarPath = argsFile;
      job.log.push(`Found args file: ${path.relative(destDir, argsFile)}`);
    } else {
      throw new Error(
        "NeoForge installer completed but could not find the server args file. " +
          "The installer may have failed silently. Check the install log for details.",
      );
    }

    try {
      fs.unlinkSync(installerPath);
      job.log.push("Cleaned up installer JAR.");
    } catch {
      logger.warn(
        { installerPath },
        "Failed to clean up NeoForge installer JAR",
      );
    }

    try {
      const installerLog = path.join(
        destDir,
        installerPath.replace(".jar", ".jar.log"),
      );
      if (fs.existsSync(installerLog)) fs.unlinkSync(installerLog);
    } catch {
      // cleanup is non-fatal
    }

    job.progress = 100;

    logger.info(
      { jobId: job.id, path: serverJarPath },
      "NeoForge installation completed",
    );

    return serverJarPath;
  }

  getLaunchConfig(server: Server): LaunchConfig {
    const jvmArgs = server.jvmArgs.split(/\s+/).filter(Boolean);

    if (server.jarPath.endsWith("_args.txt")) {
      const relativeArgsPath = path.relative(server.directory, server.jarPath);
      return {
        javaArgs: [...jvmArgs, `@${relativeArgsPath}`, "nogui"],
        cwd: server.directory,
      };
    }

    return {
      javaArgs: [...jvmArgs, "-jar", server.jarPath, "nogui"],
      cwd: server.directory,
    };
  }

  getRunningTimeout(): number {
    return 300_000;
  }

  validateInstallation(server: Server): string | null {
    if (!fs.existsSync(server.directory)) {
      return `Server directory not found: ${server.directory}`;
    }

    if (server.jarPath.endsWith("_args.txt")) {
      if (!fs.existsSync(server.jarPath)) {
        return `NeoForge args file not found at ${server.jarPath}. The NeoForge installation may be incomplete.`;
      }
    } else {
      if (!fs.existsSync(server.jarPath)) {
        return `Server JAR not found at ${server.jarPath}. Download or set the JAR path first.`;
      }
    }

    return null;
  }

  private async getGroupedVersions(): Promise<Map<string, string[]>> {
    const allVersions = await versionsCache.get(async () => {
      logger.info("Fetching NeoForge versions from Maven...");
      const res = await fetch(NEOFORGE_VERSIONS_URL);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch NeoForge version metadata: ${res.status} ${res.statusText}`,
        );
      }
      const data: { versions: string[] } = await res.json();
      return data.versions;
    });

    return groupByMcVersion(allVersions);
  }
}

registerProvider(new NeoForgeProvider());
