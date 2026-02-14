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
import { modsRouter, serverModsRouter } from "./routes/mods.js";
import { modpacksRouter, serverModpacksRouter } from "./routes/modpacks.js";
import { launcherRouter } from "./routes/launcher.js";
import { instanceModsRouter } from "./routes/instance-mods.js";
import { acmeRouter } from "./routes/acme.js";
import { clientLogsRouter } from "./routes/client-logs.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { invitationsRouter } from "./routes/invitations.js";
import { helmetConfig } from "./middleware/security.js";
import { corsOptions } from "./middleware/cors-config.js";
import { authRateLimit } from "./middleware/rate-limit.js";
import { AppError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

export const app = express();

// ACME challenge route — must be before any auth middleware (publicly accessible)
app.use(acmeRouter);

// Security middleware
app.use(helmetConfig);
app.use(cors(corsOptions));
app.use(express.json());

// Rate limiting (auth only — brute-force protection on login)
app.use("/api/auth", authRateLimit);

app.use("/api/log", clientLogsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/invitations", invitationsRouter);

app.use("/api/system", systemRouter);
app.use("/api/servers", serversRouter);
app.use("/api/versions", versionsRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/servers", logsRouter);
app.use("/api/mods", modsRouter);
app.use("/api/servers", serverModsRouter);
app.use("/api/modpacks", modpacksRouter);
app.use("/api/servers", serverModpacksRouter);
app.use("/api/launcher", launcherRouter);
app.use("/api/launcher", instanceModsRouter);

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
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof AppError) {
      logger.warn(
        {
          statusCode: err.statusCode,
          code: err.code,
          method: req.method,
          path: req.path,
          userId: req.user?.id,
        },
        err.message,
      );
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    // Unexpected errors
    logger.error(
      {
        err,
        method: req.method,
        path: req.path,
        query: req.query,
        userId: req.user?.id,
      },
      "Unhandled error",
    );
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  },
);
