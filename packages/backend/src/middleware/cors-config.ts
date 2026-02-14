import type { CorsOptions } from "cors";
import { logger } from "../utils/logger.js";

function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins: string[] = [];

  if (process.env.CUSTOM_DOMAIN) {
    allowedOrigins.push(process.env.CUSTOM_DOMAIN);
  }

  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
  } catch (err) {
    logger.debug({ origin }, "CORS origin parse failed");
    return false;
  }

  return false;
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
