import { Router } from "express";
import { z } from "zod";
import { logger } from "../utils/logger.js";

export const clientLogsRouter = Router();

const logEntrySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string().max(1000),
  context: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
});

const batchSchema = z.object({
  entries: z.array(logEntrySchema).max(50),
});

clientLogsRouter.post("/", (req, res) => {
  const result = batchSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Invalid log payload" });
    return;
  }

  for (const entry of result.data.entries) {
    const ctx = {
      ...entry.context,
      source: "frontend",
      clientTimestamp: entry.timestamp,
    };

    switch (entry.level) {
      case "debug":
        logger.debug(ctx, entry.message);
        break;
      case "info":
        logger.info(ctx, entry.message);
        break;
      case "warn":
        logger.warn(ctx, entry.message);
        break;
      case "error":
        logger.error(ctx, entry.message);
        break;
    }
  }

  res.status(204).end();
});
