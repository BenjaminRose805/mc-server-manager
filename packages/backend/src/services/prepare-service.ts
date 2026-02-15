import { nanoid } from "nanoid";
import path from "node:path";
import type { PrepareJob } from "@mc-server-manager/shared";
import { VersionService } from "./version-service.js";
import { AssetService } from "./asset-service.js";
import { LibraryService } from "./library-service.js";
import { config } from "../config.js";
import { ConflictError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const jobs = new Map<string, PrepareJob>();
const activeInstancePrepares = new Map<string, string>();
const abortControllers = new Map<string, AbortController>();
const JOB_TTL_MS = 60 * 60 * 1000;

const versionService = new VersionService(config.dataDir);
const assetService = new AssetService(config.dataDir);
const libraryService = new LibraryService(config.dataDir);

export function getPrepareJob(jobId: string): PrepareJob | undefined {
  return jobs.get(jobId);
}

export function startPrepare(
  instanceId: string,
  mcVersion: string,
): PrepareJob {
  const existingJobId = activeInstancePrepares.get(instanceId);
  if (existingJobId) {
    const existingJob = jobs.get(existingJobId);
    if (
      existingJob &&
      existingJob.phase !== "completed" &&
      existingJob.phase !== "failed"
    ) {
      throw new ConflictError(
        `A prepare job is already in progress for this instance (job: ${existingJobId})`,
      );
    }
    activeInstancePrepares.delete(instanceId);
  }

  const jobId = nanoid(12);

  const job: PrepareJob = {
    id: jobId,
    instanceId,
    mcVersion,
    phase: "pending",
    progress: 0,
    phaseCurrent: 0,
    phaseTotal: 0,
    result: null,
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);
  activeInstancePrepares.set(instanceId, jobId);

  const abortController = new AbortController();
  abortControllers.set(jobId, abortController);

  runPrepare(job, abortController.signal).catch((err) => {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, "Prepare job was cancelled");
      job.phase = "failed";
      job.error = "Cancelled";
    } else {
      logger.error({ jobId, error: err.message }, "Prepare job failed");
      job.phase = "failed";
      job.error = err.message;
    }

    activeInstancePrepares.delete(instanceId);
    abortControllers.delete(jobId);
  });

  return job;
}

export function cancelPrepare(jobId: string): boolean {
  const controller = abortControllers.get(jobId);
  if (!controller) return false;

  const job = jobs.get(jobId);
  if (!job) return false;

  if (job.phase === "completed" || job.phase === "failed") {
    return false;
  }

  controller.abort();
  return true;
}

export function cleanupOldPrepareJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (
      (job.phase === "completed" || job.phase === "failed") &&
      now - job.createdAt > JOB_TTL_MS
    ) {
      jobs.delete(id);
    }
  }
}

async function runPrepare(job: PrepareJob, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Cancelled");

  // Phase: version (5% of overall progress)
  job.phase = "version";
  job.phaseCurrent = 0;
  job.phaseTotal = 2;

  const versionJson = await versionService.downloadVersionJson(
    job.mcVersion,
    signal,
  );
  job.phaseCurrent = 1;
  job.progress = 2;

  if (signal.aborted) throw new Error("Cancelled");

  const gameJarPath = await versionService.downloadGameJar(
    job.mcVersion,
    signal,
  );
  job.phaseCurrent = 2;
  job.progress = 5;

  if (signal.aborted) throw new Error("Cancelled");

  // Phase: libraries (25% of overall progress: 5% -> 30%)
  job.phase = "libraries";
  job.phaseCurrent = 0;
  job.phaseTotal = 0;

  const classpath = await libraryService.downloadLibraries(
    versionJson,
    (current, total) => {
      job.phaseCurrent = current;
      job.phaseTotal = total;
      job.progress = 5 + Math.round((current / Math.max(total, 1)) * 25);
    },
    signal,
  );

  job.progress = 30;

  if (signal.aborted) throw new Error("Cancelled");

  // Phase: assets (70% of overall progress: 30% -> 100%)
  job.phase = "assets";
  job.phaseCurrent = 0;
  job.phaseTotal = 0;

  await assetService.downloadAssets(
    versionJson,
    (current, total) => {
      job.phaseCurrent = current;
      job.phaseTotal = total;
      job.progress = 30 + Math.round((current / Math.max(total, 1)) * 70);
    },
    signal,
  );

  if (signal.aborted) throw new Error("Cancelled");

  const launcherDir = path.join(config.dataDir, "launcher");
  const nativesDir = path.join(
    launcherDir,
    "natives",
    `${job.instanceId}-prepare`,
  );
  await libraryService.extractNatives(versionJson, nativesDir);

  const assetIndexObj = versionJson.assetIndex as { id: string } | undefined;
  const assetIndex = assetIndexObj?.id ?? (versionJson.assets as string) ?? "";
  const assetsDir = path.join(launcherDir, "assets");

  job.result = {
    classpath,
    mainClass: versionJson.mainClass as string,
    assetIndex,
    assetsDir,
    versionId: job.mcVersion,
    gameJarPath,
    nativesDir,
  };
  job.phase = "completed";
  job.progress = 100;
  job.phaseCurrent = job.phaseTotal;

  activeInstancePrepares.delete(job.instanceId);
  abortControllers.delete(job.id);

  logger.info({ jobId: job.id }, "Prepare job completed");
}
