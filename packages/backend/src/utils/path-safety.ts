/**
 * Path traversal protection utilities.
 *
 * HARD SECURITY REQUIREMENT — these functions MUST be used before
 * serving any user-specified file path to prevent directory traversal attacks.
 */

import path from 'node:path';
import { AppError } from './errors.js';

/** Allowed log file extensions. */
const ALLOWED_LOG_EXTENSIONS = new Set(['.log', '.gz', '.txt']);

/**
 * Validate that a requested path resolves to a location within the base directory.
 *
 * @param requestedPath - The user-supplied filename or relative path
 * @param baseDir - The trusted base directory (e.g., server logs dir)
 * @returns The validated absolute path
 * @throws AppError if the path is outside the base directory
 */
export function validatePathWithinBase(requestedPath: string, baseDir: string): string {
  // Reject null bytes (can trick path resolution on some systems)
  if (requestedPath.includes('\0')) {
    throw new AppError('Invalid path: contains null bytes', 400, 'INVALID_PATH');
  }

  // Reject explicit .. segments (defense in depth, even though path.resolve handles this)
  if (requestedPath.includes('..')) {
    throw new AppError('Invalid path: directory traversal not allowed', 400, 'PATH_TRAVERSAL');
  }

  // Resolve to absolute path
  const resolved = path.resolve(baseDir, requestedPath);

  // Ensure the resolved path starts with the base directory
  const normalizedBase = path.resolve(baseDir) + path.sep;
  if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
    throw new AppError('Invalid path: outside allowed directory', 400, 'PATH_TRAVERSAL');
  }

  return resolved;
}

/**
 * Validate that a file path has an allowed log file extension.
 *
 * @param filePath - The file path to check
 * @throws AppError if the extension is not allowed
 */
export function validateLogExtension(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();

  // Handle .log.gz double extension
  if (filePath.toLowerCase().endsWith('.log.gz')) {
    return; // Allowed
  }

  if (!ALLOWED_LOG_EXTENSIONS.has(ext)) {
    throw new AppError(
      `Invalid file extension: '${ext}'. Allowed: ${[...ALLOWED_LOG_EXTENSIONS].join(', ')}`,
      400,
      'INVALID_EXTENSION'
    );
  }
}
