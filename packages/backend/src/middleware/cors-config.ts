import type { CorsOptions } from "cors";

function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins = ["tauri://localhost", "https://tauri.localhost"];

  if (process.env.CUSTOM_DOMAIN) {
    allowedOrigins.push(process.env.CUSTOM_DOMAIN);
  }

  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
  } catch {
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
