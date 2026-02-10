import express from 'express';
import cors from 'cors';
import { systemRouter } from './routes/system.js';
import { serversRouter } from './routes/servers.js';
import { versionsRouter } from './routes/versions.js';
import { downloadsRouter } from './routes/downloads.js';
import { logsRouter } from './routes/logs.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/system', systemRouter);
app.use('/api/servers', serversRouter);
app.use('/api/versions', versionsRouter);
app.use('/api/downloads', downloadsRouter);
app.use('/api/servers', logsRouter);

// Error handling middleware — must be last
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Unexpected errors
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});
