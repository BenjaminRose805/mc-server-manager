import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..', '..');

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  host: process.env.HOST ?? 'localhost',
  dataDir: process.env.DATA_DIR ?? path.join(projectRoot, 'data'),
  serversDir: process.env.SERVERS_DIR ?? path.join(projectRoot, 'data', 'servers'),
  dbPath: process.env.DB_PATH ?? path.join(projectRoot, 'data', 'mc-manager.db'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
} as const;
