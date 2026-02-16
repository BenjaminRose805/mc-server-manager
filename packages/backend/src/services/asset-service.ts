import { createHash } from "node:crypto";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const ASSET_BASE_URL = "https://resources.download.minecraft.net";
const DOWNLOAD_CONCURRENCY = 10;

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

interface VersionAssetIndex {
  id: string;
  url: string;
  sha1: string;
  size: number;
  totalSize: number;
}

export class AssetService {
  private assetsDir: string;
  private indexesDir: string;
  private objectsDir: string;

  constructor(private dataDir: string) {
    this.assetsDir = join(dataDir, "launcher", "assets");
    this.indexesDir = join(this.assetsDir, "indexes");
    this.objectsDir = join(this.assetsDir, "objects");
    mkdirSync(this.indexesDir, { recursive: true });
    mkdirSync(this.objectsDir, { recursive: true });
  }

  async downloadAssetIndex(
    versionJson: Record<string, unknown>,
  ): Promise<AssetIndex> {
    const assetIndex = versionJson.assetIndex as VersionAssetIndex;
    if (!assetIndex) {
      throw new AppError(
        "Version JSON missing assetIndex field",
        502,
        "UPSTREAM_ERROR",
      );
    }

    const indexPath = join(this.indexesDir, `${assetIndex.id}.json`);

    if (existsSync(indexPath)) {
      const existing = await readFile(indexPath, "utf-8");
      const existingHash = createHash("sha1").update(existing).digest("hex");
      if (existingHash === assetIndex.sha1) {
        return JSON.parse(existing) as AssetIndex;
      }
    }

    const res = await fetch(assetIndex.url);
    if (!res.ok) {
      throw new AppError(
        `Failed to download asset index ${assetIndex.id}: ${res.status} ${res.statusText}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    const body = await res.text();

    const hash = createHash("sha1").update(body).digest("hex");
    if (hash !== assetIndex.sha1) {
      throw new AppError(
        `Asset index SHA1 mismatch for ${assetIndex.id}: expected ${assetIndex.sha1}, got ${hash}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    await writeFile(indexPath, body, "utf-8");
    logger.info({ assetIndexId: assetIndex.id }, "Downloaded asset index");

    return JSON.parse(body) as AssetIndex;
  }

  async downloadAssets(
    versionJson: Record<string, unknown>,
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const indexJson = await this.downloadAssetIndex(versionJson);
    const objects = Object.values(indexJson.objects);
    const uniqueObjects = this.deduplicateByHash(objects);

    let completed = 0;
    const total = uniqueObjects.length;

    logger.info({ totalAssets: total }, "Starting asset downloads");

    for (let i = 0; i < uniqueObjects.length; i += DOWNLOAD_CONCURRENCY) {
      const chunk = uniqueObjects.slice(i, i + DOWNLOAD_CONCURRENCY);
      await Promise.all(
        chunk.map(async (obj) => {
          await this.downloadAsset(obj.hash, signal);
          completed++;
          onProgress?.(completed, total);
        }),
      );
    }

    logger.info({ totalAssets: total }, "Asset downloads complete");
  }

  private deduplicateByHash(
    objects: Array<{ hash: string; size: number }>,
  ): Array<{ hash: string; size: number }> {
    const seen = new Set<string>();
    const unique: Array<{ hash: string; size: number }> = [];
    for (const obj of objects) {
      if (!seen.has(obj.hash)) {
        seen.add(obj.hash);
        unique.push(obj);
      }
    }
    return unique;
  }

  private async downloadAsset(
    hash: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const prefix = hash.substring(0, 2);
    const objectDir = join(this.objectsDir, prefix);
    const objectPath = join(objectDir, hash);

    if (existsSync(objectPath)) {
      return;
    }

    await mkdir(objectDir, { recursive: true });

    const url = `${ASSET_BASE_URL}/${prefix}/${hash}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new AppError(
        `Failed to download asset ${hash}: ${res.status} ${res.statusText}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    if (!res.body) {
      throw new AppError(
        `No response body for asset ${hash}`,
        502,
        "UPSTREAM_ERROR",
      );
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(objectPath));

    const data = await readFile(objectPath);
    const actualHash = createHash("sha1").update(data).digest("hex");
    if (actualHash !== hash) {
      throw new AppError(
        `Asset SHA1 mismatch: expected ${hash}, got ${actualHash}`,
        502,
        "UPSTREAM_ERROR",
      );
    }
  }
}
