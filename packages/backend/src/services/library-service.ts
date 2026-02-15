import { createHash } from "node:crypto";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { logger } from "../utils/logger.js";

type Platform = "windows" | "osx" | "linux";

interface OsRule {
  name?: string;
  version?: string;
  arch?: string;
}

interface LibraryRule {
  action: "allow" | "disallow";
  os?: OsRule;
}

interface LibraryArtifact {
  path: string;
  url: string;
  sha1: string;
  size: number;
}

interface LibraryDownloads {
  artifact?: LibraryArtifact;
  classifiers?: Record<string, LibraryArtifact>;
}

interface LibraryEntry {
  name: string;
  downloads?: LibraryDownloads;
  rules?: LibraryRule[];
  natives?: Record<string, string>;
}

const DOWNLOAD_CONCURRENCY = 10;

export class LibraryService {
  private librariesDir: string;

  constructor(private dataDir: string) {
    this.librariesDir = join(dataDir, "launcher", "libraries");
    mkdirSync(this.librariesDir, { recursive: true });
  }

  async downloadLibraries(
    versionJson: Record<string, unknown>,
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const libraries = versionJson.libraries as LibraryEntry[] | undefined;
    if (!libraries) {
      throw new Error("Version JSON missing libraries field");
    }

    const filtered = this.filterLibrariesForPlatform(libraries);
    const classpath: string[] = [];

    let completed = 0;
    const total = filtered.length;

    logger.info({ totalLibraries: total }, "Starting library downloads");

    for (let i = 0; i < filtered.length; i += DOWNLOAD_CONCURRENCY) {
      const chunk = filtered.slice(i, i + DOWNLOAD_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (lib) => {
          const libPath = await this.downloadLibrary(lib, signal);
          completed++;
          onProgress?.(completed, total);
          return { lib, path: libPath };
        }),
      );

      for (const result of results) {
        if (result.path && !result.lib.natives) {
          classpath.push(result.path);
        }
      }
    }

    logger.info(
      { classpathEntries: classpath.length },
      "Library downloads complete",
    );
    return classpath;
  }

  async extractNatives(
    versionJson: Record<string, unknown>,
    nativesDir: string,
  ): Promise<void> {
    const libraries = versionJson.libraries as LibraryEntry[] | undefined;
    if (!libraries) return;

    const platform = this.getCurrentPlatform();
    const filtered = this.filterLibrariesForPlatform(libraries);
    const nativeLibs = filtered.filter((lib) => lib.natives);

    mkdirSync(nativesDir, { recursive: true });

    for (const lib of nativeLibs) {
      const classifierKey = lib.natives?.[platform];
      if (!classifierKey) continue;

      const resolvedKey = classifierKey.replace(
        "${arch}",
        process.arch === "x64" ? "64" : "32",
      );
      const classifier = lib.downloads?.classifiers?.[resolvedKey];
      if (!classifier) {
        logger.warn(
          { library: lib.name, classifier: resolvedKey },
          "Native classifier not found, skipping",
        );
        continue;
      }

      const nativePath = join(this.librariesDir, classifier.path);

      if (!existsSync(nativePath)) {
        await this.downloadArtifact(classifier, nativePath);
      }

      try {
        const zip = new AdmZip(nativePath);
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          if (entry.entryName.startsWith("META-INF/")) continue;
          zip.extractEntryTo(entry, nativesDir, false, true);
        }
        logger.debug({ library: lib.name }, "Extracted native library");
      } catch (err) {
        logger.warn(
          { library: lib.name, error: (err as Error).message },
          "Failed to extract native library",
        );
      }
    }

    logger.info(
      { nativesDir, count: nativeLibs.length },
      "Native extraction complete",
    );
  }

  private filterLibrariesForPlatform(
    libraries: LibraryEntry[],
  ): LibraryEntry[] {
    const platform = this.getCurrentPlatform();

    return libraries.filter((lib) => {
      if (!lib.rules) return true;

      let allowed = false;
      for (const rule of lib.rules) {
        if (rule.action === "allow") {
          if (!rule.os) {
            allowed = true;
          } else if (this.matchesOS(rule.os, platform)) {
            allowed = true;
          }
        } else if (rule.action === "disallow") {
          if (!rule.os) {
            allowed = false;
          } else if (this.matchesOS(rule.os, platform)) {
            allowed = false;
          }
        }
      }

      return allowed;
    });
  }

  private async downloadLibrary(
    lib: LibraryEntry,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const artifact = lib.downloads?.artifact;
    if (!artifact) {
      if (!lib.natives) {
        logger.warn(
          { library: lib.name },
          "Library has no artifact URL, skipping",
        );
      }
      return null;
    }

    if (!artifact.url) {
      logger.warn(
        { library: lib.name },
        "Library artifact URL is empty, skipping",
      );
      return null;
    }

    const libPath = join(this.librariesDir, artifact.path);

    if (existsSync(libPath)) {
      const existingData = await readFile(libPath);
      const existingHash = createHash("sha1")
        .update(existingData)
        .digest("hex");
      if (existingHash === artifact.sha1) {
        return libPath;
      }
      logger.info(
        { library: lib.name },
        "Existing library hash mismatch, re-downloading",
      );
    }

    await this.downloadArtifact(artifact, libPath, signal);
    return libPath;
  }

  private async downloadArtifact(
    artifact: LibraryArtifact,
    destPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true });

    const res = await fetch(artifact.url, { signal });
    if (!res.ok) {
      logger.warn(
        { url: artifact.url, status: res.status },
        "Failed to download library artifact, skipping",
      );
      return;
    }

    if (!res.body) {
      logger.warn(
        { url: artifact.url },
        "No response body for library artifact, skipping",
      );
      return;
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(destPath));

    const data = await readFile(destPath);
    const hash = createHash("sha1").update(data).digest("hex");
    if (hash !== artifact.sha1) {
      await unlink(destPath);
      throw new Error(
        `Library SHA1 mismatch for ${artifact.path}: expected ${artifact.sha1}, got ${hash}`,
      );
    }
  }

  private getCurrentPlatform(): Platform {
    switch (process.platform) {
      case "win32":
        return "windows";
      case "darwin":
        return "osx";
      default:
        return "linux";
    }
  }

  private matchesOS(osRule: OsRule, platform: Platform): boolean {
    if (osRule.name && osRule.name !== platform) return false;
    if (osRule.arch && osRule.arch !== process.arch) return false;
    return true;
  }
}
