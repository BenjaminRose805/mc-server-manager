import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { systemRouter } from "./routes/system.js";
import { serversRouter } from "./routes/servers.js";
import { versionsRouter } from "./routes/versions.js";
import { downloadsRouter } from "./routes/downloads.js";
import { logsRouter } from "./routes/logs.js";
import { AppError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/system", systemRouter);
app.use("/api/servers", serversRouter);
app.use("/api/versions", versionsRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/servers", logsRouter);

if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // MC_FRONTEND_DIST is set by Electron to point at extraResources/frontend/dist
  const frontendDist =
    process.env.MC_FRONTEND_DIST ??
    path.resolve(__dirname, "..", "..", "frontend", "dist");

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }
}

// Error handling middleware — must be last
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    // Unexpected errors
    logger.error({ err }, "Unhandled error");
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  },
);
