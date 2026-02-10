import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  // Electron main process sets MC_DATA_DIR to app.getPath('userData')
  if (process.env.MC_DATA_DIR) return process.env.MC_DATA_DIR;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(projectRoot, "data");
}

const dataDir = resolveDataDir();

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  host: process.env.HOST ?? "localhost",
  dataDir,
  serversDir: process.env.SERVERS_DIR ?? path.join(dataDir, "servers"),
  dbPath: process.env.DB_PATH ?? path.join(dataDir, "mc-manager.db"),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
