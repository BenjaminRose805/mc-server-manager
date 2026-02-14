import rateLimit from "express-rate-limit";
import { logger } from "../utils/logger.js";

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, path: req.path, method: req.method },
      "Auth rate limit exceeded",
    );
    res
      .status(429)
      .json({
        error: "Too many authentication attempts, please try again later",
      });
  },
});
