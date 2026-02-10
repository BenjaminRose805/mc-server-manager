/**
 * Log viewer routes — browse and read historical Minecraft server log files.
 *
 * These routes are mounted under /api/servers (i.e., /api/servers/:id/logs).
 * All file operations include path traversal protection.
 */

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { getServerById } from '../models/server.js';
import { validatePathWithinBase, validateLogExtension } from '../utils/path-safety.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const logsRouter = Router();

/** Maximum uncompressed log file size we'll serve (50 MB). */
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;

/** Default number of lines per page. */
const DEFAULT_LIMIT = 500;

interface LogFileEntry {
  name: string;
  size: number;
  modifiedAt: string;
}

/**
 * GET /api/servers/:id/logs — List log files for a server
 */
logsRouter.get('/:id/logs', (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    const logsDir = path.join(server.directory, 'logs');

    if (!fs.existsSync(logsDir)) {
      // No logs directory yet — server hasn't been started
      res.json({ files: [] });
      return;
    }

    const entries = fs.readdirSync(logsDir, { withFileTypes: true });
    const files: LogFileEntry[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      // Only list files with allowed extensions
      const ext = path.extname(entry.name).toLowerCase();
      const isLogGz = entry.name.toLowerCase().endsWith('.log.gz');
      if (!isLogGz && ext !== '.log' && ext !== '.txt') continue;

      const filePath = path.join(logsDir, entry.name);
      const stat = fs.statSync(filePath);

      files.push({
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    // Sort by modification time, newest first
    files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

    res.json({ files });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/servers/:id/logs/:filename — Read a log file's content
 * Query params:
 *   ?offset=0 — line offset (0-based)
 *   ?limit=500 — max lines to return
 *   ?search=pattern — regex search filter
 */
logsRouter.get('/:id/logs/:filename', async (req, res, next) => {
  try {
    const server = getServerById(req.params.id);
    const logsDir = path.join(server.directory, 'logs');
    const filename = req.params.filename;

    // Security: validate path traversal
    const filePath = validatePathWithinBase(filename, logsDir);
    validateLogExtension(filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('Log file', filename);
    }

    // Parse query params
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT));
    const searchPattern = req.query.search as string | undefined;

    // Validate search regex if provided
    let searchRegex: RegExp | null = null;
    if (searchPattern) {
      try {
        searchRegex = new RegExp(searchPattern, 'i');
      } catch {
        throw new AppError('Invalid search regex', 400, 'INVALID_REGEX');
      }
    }

    // Read file content
    let content: string;

    if (filename.toLowerCase().endsWith('.gz')) {
      // Decompress .gz files
      const stat = fs.statSync(filePath);
      // Check compressed size as rough proxy (actual uncompressed will be larger)
      if (stat.size > MAX_UNCOMPRESSED_SIZE) {
        throw new AppError('Log file is too large to view', 413, 'FILE_TOO_LARGE');
      }

      content = await decompressGzFile(filePath);

      if (content.length > MAX_UNCOMPRESSED_SIZE) {
        throw new AppError('Decompressed log file exceeds 50MB limit', 413, 'FILE_TOO_LARGE');
      }
    } else {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_UNCOMPRESSED_SIZE) {
        throw new AppError('Log file is too large to view', 413, 'FILE_TOO_LARGE');
      }
      content = fs.readFileSync(filePath, 'utf-8');
    }

    // Split into lines
    let lines = content.split('\n');
    // Remove trailing empty line if present
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const totalLines = lines.length;

    // Apply search filter if provided
    if (searchRegex) {
      lines = lines.filter((line) => searchRegex!.test(line));
    }

    const filteredTotal = lines.length;

    // Apply pagination
    const paginatedLines = lines.slice(offset, offset + limit);
    const hasMore = offset + limit < filteredTotal;

    res.json({
      content: paginatedLines.join('\n'),
      lines: paginatedLines,
      totalLines,
      filteredLines: searchRegex ? filteredTotal : totalLines,
      offset,
      limit,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Decompress a .gz file and return its content as a string.
 */
function decompressGzFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const stream = createReadStream(filePath).pipe(gunzip);

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    stream.on('error', (err) => {
      reject(new AppError(`Failed to decompress log file: ${err.message}`, 500, 'DECOMPRESS_ERROR'));
    });
  });
}
