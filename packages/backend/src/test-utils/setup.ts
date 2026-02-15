import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set environment variables BEFORE any app module imports
process.env.DB_PATH = ":memory:";
process.env.LOG_LEVEL = "silent";
process.env.MC_MIGRATIONS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "migrations",
);
