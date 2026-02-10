/**
 * Download service — manages JAR download/install jobs.
 *
 * Delegates actual download logic to server type providers.
 * Handles provisioning status, one-per-server guards, cancellation,
 * and jarPath updates on completion.
 */

import { nanoid } from 'nanoid';
import type { DownloadJob, DownloadRequest, ServerType } from '@mc-server-manager/shared';
import { getProvider } from '../providers/registry.js';
import { updateServer } from '../models/server.js';
import { serverManager } from './server-manager.js';
import { logger } from '../utils/logger.js';
import { ConflictError } from '../utils/errors.js';

/**
 * In-memory store for active download jobs.
 * Jobs are ephemeral — they don't survive server restarts.
 */
const jobs = new Map<string, DownloadJob>();

/**
 * Track which servers have active downloads (one-per-server guard).
 * Maps serverId -> jobId.
 */
const activeServerDownloads = new Map<string, string>();

/**
 * AbortControllers for in-flight downloads (cancellation support).
 * Maps jobId -> AbortController.
 */
const abortControllers = new Map<string, AbortController>();

/** TTL for completed/failed jobs before cleanup (1 hour). */
const JOB_TTL_MS = 60 * 60 * 1000;

/**
 * Get a download job by ID.
 */
export function getDownloadJob(jobId: string): DownloadJob | undefined {
  return jobs.get(jobId);
}

/**
 * Get all active download jobs.
 */
export function getAllDownloadJobs(): DownloadJob[] {
  return Array.from(jobs.values());
}

/**
 * Start a download job for a server.
 * Delegates to the appropriate provider for the server type.
 * Returns the job immediately — the download runs in the background.
 */
export function startDownload(
  request: DownloadRequest,
  destDir: string
): DownloadJob {
  // One-per-server guard
  const existingJobId = activeServerDownloads.get(request.serverId);
  if (existingJobId) {
    const existingJob = jobs.get(existingJobId);
    if (existingJob && (existingJob.status === 'pending' || existingJob.status === 'downloading' || existingJob.status === 'installing')) {
      throw new ConflictError(`A download is already in progress for this server (job: ${existingJobId})`);
    }
    // Previous job is completed/failed — allow a new one
    activeServerDownloads.delete(request.serverId);
  }

  const jobId = nanoid(12);

  const job: DownloadJob = {
    id: jobId,
    serverId: request.serverId,
    mcVersion: request.mcVersion,
    serverType: request.serverType,
    status: 'pending',
    progress: 0,
    totalBytes: null,
    downloadedBytes: 0,
    filePath: null,
    log: [],
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);
  activeServerDownloads.set(request.serverId, jobId);

  // Create AbortController for cancellation
  const abortController = new AbortController();
  abortControllers.set(jobId, abortController);

  // Set server to provisioning status
  serverManager.setProvisioning(request.serverId);

  // Start the async download without awaiting
  runDownload(job, request, destDir, abortController.signal).catch((err) => {
    if (abortController.signal.aborted) {
      logger.info({ jobId }, 'Download was cancelled');
      job.status = 'failed';
      job.error = 'Cancelled';
    } else {
      logger.error({ jobId, error: err.message }, 'Download failed');
      job.status = 'failed';
      job.error = err.message;
    }

    // Clean up provisioning and tracking
    serverManager.clearProvisioning(request.serverId);
    activeServerDownloads.delete(request.serverId);
    abortControllers.delete(jobId);
  });

  return job;
}

/**
 * Cancel an in-progress download.
 * Returns true if the job was found and cancelled, false if not found or already done.
 */
export function cancelDownload(jobId: string): boolean {
  const controller = abortControllers.get(jobId);
  if (!controller) return false;

  const job = jobs.get(jobId);
  if (!job) return false;

  if (job.status !== 'pending' && job.status !== 'downloading' && job.status !== 'installing') {
    return false; // Already completed or failed
  }

  controller.abort();
  return true;
}

/**
 * Actually perform the download via the provider. Updates the job object in place.
 */
async function runDownload(
  job: DownloadJob,
  request: DownloadRequest,
  destDir: string,
  signal: AbortSignal
): Promise<void> {
  // Check for cancellation before starting
  if (signal.aborted) throw new Error('Cancelled');

  const provider = getProvider(request.serverType);

  // Provider handles the download/install and returns the final JAR path
  const jarPath = await provider.download(request, destDir, job);

  // Check for cancellation after download
  if (signal.aborted) throw new Error('Cancelled');

  // Update job as completed
  job.filePath = jarPath;
  job.status = 'completed';
  job.progress = 100;

  // Update server's jarPath in the database
  updateServer(request.serverId, { jarPath });

  // Clear provisioning and tracking
  serverManager.clearProvisioning(request.serverId);
  activeServerDownloads.delete(request.serverId);
  abortControllers.delete(job.id);

  logger.info(
    { jobId: job.id, path: jarPath },
    'Download completed — jarPath updated'
  );
}

/**
 * Clean up old completed/failed jobs (older than 1 hour).
 * Never cleans up active jobs (downloading/installing/pending).
 * Call periodically to prevent memory leaks.
 */
export function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (
      (job.status === 'completed' || job.status === 'failed') &&
      now - job.createdAt > JOB_TTL_MS
    ) {
      jobs.delete(id);
    }
  }
}
