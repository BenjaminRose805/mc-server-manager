/**
 * ForgeProvider — handles Minecraft Forge server operations.
 *
 * Forge has a two-phase install: download installer JAR, then run it.
 * Modern (1.17+) uses @args-file launch, legacy (1.12-1.16) uses -jar.
 *
 * Maven repo: https://maven.minecraftforge.net/net/minecraftforge/forge/
 */

import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type {
  McVersion,
  ForgeVersionInfo,
  DownloadRequest,
  DownloadJob,
  Server,
} from "@mc-server-manager/shared";
import { compareMcVersions } from "@mc-server-manager/shared";
import type { ServerProvider, LaunchConfig } from "./provider.js";
import { registerProvider } from "./registry.js";
import { TTLCache } from "../utils/cache.js";
import { logger } from "../utils/logger.js";

/** Forge metadata URL for all versions. */
const FORGE_METADATA_URL =
  "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

/** Maven base URL for downloading Forge installer JARs. */
const FORGE_MAVEN = "https://maven.minecraftforge.net";

/** MC version where Forge switched to the modern @args-file launcher. */
const MODERN_FORGE_MC_VERSION = "1.17";

/** Cache for Maven version list (10 minutes). */
const mavenVersionsCache = new TTLCache<string[]>();

function isModernForge(mcVersion: string): boolean {
  return compareMcVersions(mcVersion, MODERN_FORGE_MC_VERSION) >= 0;
}

/** Regex-extract <version> tags from Maven metadata XML (avoids XML parser dep). */
function parseVersionsFromXml(xml: string): string[] {
  const versions: string[] = [];
  const regex = /<version>([^<]+)<\/version>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    versions.push(match[1]);
  }
  return versions;
}

/** Group "mcVersion-forgeVersion" strings into Map<mcVersion, forgeVersion[]>. */
function groupByMcVersion(versions: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const v of versions) {
    const dashIdx = v.indexOf("-");
    if (dashIdx === -1) continue;
    const mc = v.substring(0, dashIdx);
    const forge = v.substring(dashIdx + 1);
    if (!map.has(mc)) map.set(mc, []);
    map.get(mc)!.push(forge);
  }
  return map;
}

/** Find unix_args.txt/win_args.txt under libraries/net/minecraftforge/forge/<fullVersion>/ */
function findArgsFile(
  serverDir: string,
  mcVersion: string,
  forgeVersion: string,
): string | null {
  const fullVersion = `${mcVersion}-${forgeVersion}`;
  const argsDir = path.join(
    serverDir,
    "libraries",
    "net",
    "minecraftforge",
    "forge",
    fullVersion,
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

function findLegacyForgeJar(
  serverDir: string,
  mcVersion: string,
  forgeVersion: string,
): string | null {
  const fullVersion = `${mcVersion}-${forgeVersion}`;

  const candidates = [
    `forge-${fullVersion}.jar`,
    `forge-${fullVersion}-universal.jar`,
    `forge-${fullVersion}-server.jar`,
  ];

  for (const name of candidates) {
    const p = path.join(serverDir, name);
    if (fs.existsSync(p)) return p;
  }

  try {
    const files = fs.readdirSync(serverDir);
    const forgeJar = files.find(
      (f) =>
        f.startsWith("forge-") &&
        f.endsWith(".jar") &&
        !f.includes("installer") &&
        !f.includes("tmp"),
    );
    if (forgeJar) return path.join(serverDir, forgeJar);
  } catch {
    // ignore
  }

  return null;
}

function runForgeInstaller(
  javaPath: string,
  installerPath: string,
  serverDir: string,
  job: DownloadJob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    job.status = "installing";
    job.log.push("Running Forge installer...");

    logger.info(
      { jobId: job.id, installerPath, serverDir },
      "Starting Forge installer",
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
        logger.debug({ jobId: job.id, line }, "Forge installer stdout");
      }
    });

    installerProc.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        job.log.push(line);
        logger.debug({ jobId: job.id, line }, "Forge installer stderr");
      }
    });

    installerProc.on("error", (err) => {
      logger.error({ jobId: job.id, err }, "Forge installer process error");
      reject(new Error(`Forge installer failed to start: ${err.message}`));
    });

    installerProc.on("exit", (code, signal) => {
      logger.info(
        { jobId: job.id, code, signal },
        "Forge installer process exited",
      );

      if (code === 0) {
        job.log.push("Forge installer completed successfully.");
        resolve();
      } else {
        const tail = job.log.slice(-5).join("\n");
        reject(
          new Error(
            `Forge installer exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. Last output:\n${tail}`,
          ),
        );
      }
    });
  });
}

class ForgeProvider implements ServerProvider {
  readonly type = "forge" as const;

  async getVersions(includeSnapshots = false): Promise<McVersion[]> {
    const grouped = await this.getGroupedVersions();

    const mcVersions = [...grouped.keys()].sort((a, b) =>
      compareMcVersions(b, a),
    );

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

  async getVersionInfo(mcVersion: string): Promise<ForgeVersionInfo> {
    const grouped = await this.getGroupedVersions();
    const forgeVersions = grouped.get(mcVersion);

    if (!forgeVersions || forgeVersions.length === 0) {
      throw new Error(`No Forge versions found for Minecraft ${mcVersion}`);
    }

    const sorted = forgeVersions.slice().sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) return nb - na;
      }
      return 0;
    });

    return {
      type: "forge",
      mcVersion,
      forgeVersions: sorted,
      latest: sorted[0],
    };
  }

  async download(
    request: DownloadRequest,
    destDir: string,
    job: DownloadJob,
  ): Promise<string> {
    if (request.serverType !== "forge") {
      throw new Error("ForgeProvider can only handle forge downloads");
    }

    const forgeVersion = request.forgeVersion;
    const fullVersion = `${request.mcVersion}-${forgeVersion}`;

    fs.mkdirSync(destDir, { recursive: true });

    const modsDir = path.join(destDir, "mods");
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }

    const installerFileName = `forge-${fullVersion}-installer.jar`;
    const installerUrl = `${FORGE_MAVEN}/net/minecraftforge/forge/${fullVersion}/${installerFileName}`;
    const installerPath = path.join(destDir, installerFileName);
    const tempPath = installerPath + ".tmp";

    job.status = "downloading";
    job.log.push(
      `Downloading Forge installer for MC ${request.mcVersion} (Forge ${forgeVersion})...`,
    );

    logger.info(
      {
        jobId: job.id,
        version: request.mcVersion,
        forgeVersion,
        url: installerUrl,
      },
      "Starting Forge installer download",
    );

    const res = await fetch(installerUrl);
    if (!res.ok || !res.body) {
      throw new Error(
        `Failed to download Forge installer: ${res.status} ${res.statusText}. ` +
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
              // Cap at 90% — remaining 10% is for the install phase
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

    // The provider interface doesn't pass the server's javaPath, so we use the
    // system default. The server model defaults to 'java' as well.
    const javaPath = "java";

    await runForgeInstaller(javaPath, installerPath, destDir, job);

    job.progress = 95;

    let serverJarPath: string;
    const modern = isModernForge(request.mcVersion);

    if (modern) {
      const argsFile = findArgsFile(destDir, request.mcVersion, forgeVersion);
      if (argsFile) {
        serverJarPath = argsFile;
        job.log.push(`Found args file: ${path.relative(destDir, argsFile)}`);
      } else {
        const legacyJar = findLegacyForgeJar(
          destDir,
          request.mcVersion,
          forgeVersion,
        );
        if (legacyJar) {
          serverJarPath = legacyJar;
          job.log.push(
            `Args file not found, using JAR: ${path.basename(legacyJar)}`,
          );
        } else {
          throw new Error(
            "Forge installer completed but could not find the server args file or JAR. " +
              "The installer may have failed silently. Check the install log for details.",
          );
        }
      }
    } else {
      const legacyJar = findLegacyForgeJar(
        destDir,
        request.mcVersion,
        forgeVersion,
      );
      if (legacyJar) {
        serverJarPath = legacyJar;
        job.log.push(`Found server JAR: ${path.basename(legacyJar)}`);
      } else {
        throw new Error(
          "Forge installer completed but could not find the server JAR. " +
            "The installer may have failed silently. Check the install log for details.",
        );
      }
    }

    try {
      fs.unlinkSync(installerPath);
      job.log.push("Cleaned up installer JAR.");
    } catch {
      logger.warn({ installerPath }, "Failed to clean up Forge installer JAR");
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
      { jobId: job.id, path: serverJarPath, modern },
      "Forge installation completed",
    );

    return serverJarPath;
  }

  getLaunchConfig(server: Server): LaunchConfig {
    const jvmArgs = server.jvmArgs.split(/\s+/).filter(Boolean);

    // Modern Forge (1.17+): jarPath points to an args file with classpath + main class
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
        return `Forge args file not found at ${server.jarPath}. The Forge installation may be incomplete.`;
      }
    } else {
      if (!fs.existsSync(server.jarPath)) {
        return `Server JAR not found at ${server.jarPath}. Download or set the JAR path first.`;
      }
    }

    return null;
  }

  private async getGroupedVersions(): Promise<Map<string, string[]>> {
    const allVersions = await mavenVersionsCache.get(async () => {
      logger.info("Fetching Forge versions from Maven...");
      const res = await fetch(FORGE_METADATA_URL);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch Forge version metadata: ${res.status} ${res.statusText}`,
        );
      }
      const xml = await res.text();
      return parseVersionsFromXml(xml);
    });

    return groupByMcVersion(allVersions);
  }
}

registerProvider(new ForgeProvider());
