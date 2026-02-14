import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getDb } from "./database.js";
import type { UserRole, JWTPayload } from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";

let cachedSecret: string | null = null;

export function getOrCreateJWTSecret(): string {
  if (cachedSecret) {
    return cachedSecret;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("jwt_secret") as { value: string } | undefined;

  if (row) {
    cachedSecret = row.value;
    return cachedSecret;
  }

  const secret = crypto.randomBytes(64).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "jwt_secret",
    secret,
  );
  cachedSecret = secret;
  return cachedSecret;
}

export function generateAccessToken(user: {
  id: string;
  username: string;
  role: UserRole;
}): string {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };
  return jwt.sign(payload, getOrCreateJWTSecret(), {
    algorithm: "HS256",
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getOrCreateJWTSecret(), {
      algorithms: ["HS256"],
    }) as JWTPayload;
  } catch (err) {
    logger.debug("JWT verification failed");
    return null;
  }
}
