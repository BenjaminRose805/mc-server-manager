/**
 * PaperProvider — handles Paper Minecraft server operations.
 *
 * Paper is a high-performance Minecraft server fork.
 * API: https://api.papermc.io/v2/projects/paper
 */

import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import type {
  McVersion,
  PaperVersionInfo,
  DownloadRequest,
  DownloadJob,
  Server,
} from '@mc-server-manager/shared';
import type { ServerProvider, LaunchConfig } from './provider.js';
import { registerProvider } from './registry.js';
import { TTLCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const PAPER_API = 'https://api.papermc.io/v2/projects/paper';

// --- Paper API response types ---

interface PaperVersionsResponse {
  project_id: string;
  project_name: string;
  version_groups: string[];
  versions: string[];
}

interface PaperBuildsResponse {
  project_id: string;
  project_name: string;
  version: string;
  builds: PaperBuild[];
}

interface PaperBuild {
  build: number;
  time: string;
  channel: string;  // 'default' or 'experimental'
  promoted: boolean;
  changes: Array<{ commit: string; summary: string; message: string }>;
  downloads: {
    application: {
      name: string;
      sha256: string;
    };
  };
}

// --- Cache ---

const versionsCache = new TTLCache<string[]>();

class PaperProvider implements ServerProvider {
  readonly type = 'paper' as const;

  async getVersions(_includeSnapshots = false): Promise<McVersion[]> {
    const versions = await versionsCache.get(async () => {
      logger.info('Fetching Paper versions...');
      const res = await fetch(PAPER_API);
      if (!res.ok) {
        throw new Error(`Failed to fetch Paper versions: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as PaperVersionsResponse;
      return data.versions;
    });

    // Paper versions are MC version strings. Return them as releases, newest first.
    return versions
      .slice()
      .reverse()
      .map((v) => ({
        id: v,
        type: 'release' as const,
        releaseTime: '', // Paper API doesn't provide release times for the version list
      }));
  }

  async getVersionInfo(mcVersion: string): Promise<PaperVersionInfo> {
    const res = await fetch(`${PAPER_API}/versions/${mcVersion}/builds`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Paper builds for ${mcVersion}: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as PaperBuildsResponse;

    // Filter to default channel builds only
    const defaultBuilds = data.builds.filter((b) => b.channel === 'default');
    const buildNumbers = defaultBuilds.map((b) => b.build);
    const latestBuild = buildNumbers.length > 0 ? buildNumbers[buildNumbers.length - 1] : data.builds[data.builds.length - 1].build;

    return {
      type: 'paper',
      mcVersion,
      builds: buildNumbers,
      latestBuild,
    };
  }

  async download(request: DownloadRequest, destDir: string, job: DownloadJob): Promise<string> {
    if (request.serverType !== 'paper') {
      throw new Error('PaperProvider can only handle paper downloads');
    }

    // Determine which build to download
    let build: number;
    if ('build' in request && request.build) {
      build = request.build;
    } else {
      // Get the latest build
      const info = await this.getVersionInfo(request.mcVersion);
      build = info.latestBuild;
    }

    // Get the build details for the download filename and hash
    const buildsRes = await fetch(`${PAPER_API}/versions/${request.mcVersion}/builds/${build}`);
    if (!buildsRes.ok) {
      throw new Error(`Failed to fetch Paper build ${build} for ${request.mcVersion}: ${buildsRes.status}`);
    }

    const buildData = (await buildsRes.json()) as PaperBuild;
    const downloadName = buildData.downloads.application.name;
    const expectedSha256 = buildData.downloads.application.sha256;

    const downloadUrl = `${PAPER_API}/versions/${request.mcVersion}/builds/${build}/downloads/${downloadName}`;

    job.status = 'downloading';
    job.log.push(`Downloading Paper ${request.mcVersion} build ${build}...`);

    logger.info(
      { jobId: job.id, version: request.mcVersion, build, url: downloadUrl },
      'Starting Paper JAR download'
    );

    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, downloadName);
    const tempPath = destPath + '.tmp';

    // Stream download with progress tracking
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      job.totalBytes = parseInt(contentLength, 10);
    }

    const hasher = crypto.createHash('sha256');
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

    const nodeStream = Readable.fromWeb(trackingStream as import('stream/web').ReadableStream);
    const fileStream = createWriteStream(tempPath);

    await pipeline(nodeStream, fileStream);

    // Verify SHA256 hash
    const actualSha256 = hasher.digest('hex');
    if (actualSha256 !== expectedSha256) {
      fs.unlinkSync(tempPath);
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }

    // Move temp file to final destination
    fs.renameSync(tempPath, destPath);

    job.log.push(`Download verified (SHA256: ${actualSha256.substring(0, 12)}...)`);

    logger.info(
      { jobId: job.id, path: destPath, sha256: actualSha256 },
      'Paper JAR download completed and verified'
    );

    return destPath;
  }

  getLaunchConfig(server: Server): LaunchConfig {
    const jvmArgs = server.jvmArgs.split(/\s+/).filter(Boolean);
    return {
      javaArgs: [...jvmArgs, '-jar', server.jarPath, 'nogui'],
      cwd: server.directory,
    };
  }

  // Paper uses the same Done regex as vanilla
  // No need to override getDoneRegex()

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
registerProvider(new PaperProvider());
