import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type {
  MinecraftVersion,
  VersionManifest,
  VersionType,
} from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";

const MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const CACHE_TTL = 3600 * 1000;

export class VersionService {
  private manifestCache: { data: VersionManifest; timestamp: number } | null =
    null;
  private versionsDir: string;

  constructor(private dataDir: string) {
    this.versionsDir = join(dataDir, "launcher", "versions");
    mkdirSync(this.versionsDir, { recursive: true });
  }

  async getManifest(): Promise<VersionManifest> {
    const now = Date.now();
    if (this.manifestCache && now - this.manifestCache.timestamp < CACHE_TTL) {
      return this.manifestCache.data;
    }

    logger.info("Fetching Mojang version manifest for launcher...");

    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch version manifest: ${res.status} ${res.statusText}`,
      );
    }

    const manifest = (await res.json()) as VersionManifest;
    this.manifestCache = { data: manifest, timestamp: now };

    logger.info(
      { versionCount: manifest.versions.length },
      "Launcher version manifest cached",
    );
    return manifest;
  }

  async getVersions(type?: VersionType): Promise<MinecraftVersion[]> {
    const manifest = await this.getManifest();
    if (!type) return manifest.versions;
    return manifest.versions.filter((v) => v.type === type);
  }

  async downloadVersionJson(
    versionId: string,
  ): Promise<Record<string, unknown>> {
    const versionDir = join(this.versionsDir, versionId);
    const jsonPath = join(versionDir, `${versionId}.json`);

    if (existsSync(jsonPath)) {
      const existing = await readFile(jsonPath, "utf-8");
      return JSON.parse(existing) as Record<string, unknown>;
    }

    const manifest = await this.getManifest();
    const version = manifest.versions.find((v) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found in manifest`);

    await mkdir(versionDir, { recursive: true });

    const res = await fetch(version.url);
    if (!res.ok) {
      throw new Error(
        `Failed to download version JSON for ${versionId}: ${res.status} ${res.statusText}`,
      );
    }

    const body = await res.text();

    const hash = createHash("sha1").update(body).digest("hex");
    if (hash !== version.sha1) {
      throw new Error(
        `Version JSON SHA1 mismatch for ${versionId}: expected ${version.sha1}, got ${hash}`,
      );
    }

    await writeFile(jsonPath, body, "utf-8");
    logger.info({ versionId }, "Downloaded version JSON");

    return JSON.parse(body) as Record<string, unknown>;
  }

  async downloadGameJar(versionId: string): Promise<string> {
    const versionJson = await this.downloadVersionJson(versionId);
    const versionDir = join(this.versionsDir, versionId);
    const jarPath = join(versionDir, `${versionId}.jar`);

    if (existsSync(jarPath)) {
      const existingData = await readFile(jarPath);
      const existingHash = createHash("sha1")
        .update(existingData)
        .digest("hex");
      const downloads = versionJson.downloads as Record<
        string,
        { url: string; sha1: string; size: number }
      >;
      if (downloads.client && existingHash === downloads.client.sha1) {
        return jarPath;
      }
    }

    const downloads = versionJson.downloads as
      | Record<string, { url: string; sha1: string; size: number }>
      | undefined;
    if (!downloads?.client) {
      throw new Error(`No client download available for ${versionId}`);
    }

    const clientDownload = downloads.client;

    logger.info(
      { versionId, size: clientDownload.size },
      "Downloading client JAR",
    );

    const res = await fetch(clientDownload.url);
    if (!res.ok) {
      throw new Error(
        `Failed to download client JAR for ${versionId}: ${res.status} ${res.statusText}`,
      );
    }

    if (!res.body) {
      throw new Error(
        `No response body for client JAR download of ${versionId}`,
      );
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(jarPath));

    const jarData = await readFile(jarPath);
    const hash = createHash("sha1").update(jarData).digest("hex");
    if (hash !== clientDownload.sha1) {
      throw new Error(
        `Client JAR SHA1 mismatch for ${versionId}: expected ${clientDownload.sha1}, got ${hash}`,
      );
    }

    logger.info({ versionId, jarPath }, "Downloaded client JAR");
    return jarPath;
  }
}
