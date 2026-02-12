import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { hashPassword, verifyPassword } from "../services/auth.js";
import { generateAccessToken } from "../services/jwt.js";
import {
  createSession,
  validateRefreshToken,
  revokeSession,
  revokeAllUserSessions,
  generateRefreshToken,
} from "../services/session.js";
import {
  isLockedOut,
  recordLoginAttempt,
  clearLoginAttempts,
} from "../services/brute-force.js";
import {
  createUser,
  getUserByUsername,
  getUserByUsernameWithHash,
  getUserById,
  countUsers,
  updateLastLogin,
} from "../models/user.js";
import {
  getInvitationByCode,
  incrementInvitationUses,
} from "../models/invitation.js";
import { requireAuth, invalidateUserCountCache } from "../middleware/auth.js";
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const authRouter = Router();

authRouter.get("/status", (_req, res) => {
  const userCount = countUsers();
  res.json({
    setupRequired: userCount === 0,
    multiUser: userCount > 0,
  });
});

const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be 20 characters or less")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username may only contain letters, numbers, and underscores",
  );

const setupSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(50).trim(),
});

const registerSchema = z.object({
  inviteCode: z.string(),
  username: usernameSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(50).trim(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

authRouter.post("/setup", async (req, res, next) => {
  try {
    if (countUsers() !== 0) {
      throw new ConflictError("Setup already completed");
    }

    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { username, password, displayName } = parsed.data;
    const passwordHash = await hashPassword(password);
    const id = nanoid(12);

    const user = createUser({
      id,
      username,
      displayName,
      passwordHash,
      role: "owner",
    });

    const refreshToken = generateRefreshToken();
    createSession(
      user.id,
      refreshToken,
      req.headers["user-agent"] ?? null,
      req.ip ?? null,
    );

    const accessToken = generateAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    invalidateUserCountCache();

    logger.info(
      { userId: user.id, username: user.username },
      "Initial setup completed",
    );
    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { inviteCode, username, password, displayName } = parsed.data;

    const invitation = getInvitationByCode(inviteCode);
    if (!invitation) {
      throw new AppError(
        "Invalid or expired invite code",
        400,
        "INVALID_INVITE",
      );
    }

    if (getUserByUsername(username)) {
      throw new ConflictError(`Username "${username}" is already taken`);
    }

    const passwordHash = await hashPassword(password);
    const id = nanoid(12);

    const user = createUser({
      id,
      username,
      displayName,
      passwordHash,
      role: invitation.role,
    });

    incrementInvitationUses(invitation.id);

    const refreshToken = generateRefreshToken();
    createSession(
      user.id,
      refreshToken,
      req.headers["user-agent"] ?? null,
      req.ip ?? null,
    );

    const accessToken = generateAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    logger.info(
      { userId: user.id, username: user.username },
      "User registered via invitation",
    );
    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const ip = req.ip ?? "unknown";

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const { username, password } = parsed.data;

    if (isLockedOut(username, ip)) {
      res.set("Retry-After", "900");
      throw new AppError(
        "Too many login attempts. Please try again later.",
        429,
        "RATE_LIMITED",
      );
    }

    const userWithHash = getUserByUsernameWithHash(username);
    if (!userWithHash) {
      recordLoginAttempt(username, ip, false);
      throw new UnauthorizedError("Invalid credentials");
    }

    const valid = await verifyPassword(userWithHash.passwordHash, password);
    if (!valid) {
      recordLoginAttempt(username, ip, false);
      throw new UnauthorizedError("Invalid credentials");
    }

    if (!userWithHash.isActive) {
      throw new ForbiddenError("Account is deactivated");
    }

    recordLoginAttempt(username, ip, true);
    clearLoginAttempts(username);
    updateLastLogin(userWithHash.id);

    const refreshToken = generateRefreshToken();
    createSession(
      userWithHash.id,
      refreshToken,
      req.headers["user-agent"] ?? null,
      req.ip ?? null,
    );

    const accessToken = generateAccessToken({
      id: userWithHash.id,
      username: userWithHash.username,
      role: userWithHash.role,
    });

    const { passwordHash: _, ...user } = userWithHash;

    logger.info({ userId: user.id, username: user.username }, "User logged in");
    res.json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", (req, res, next) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const session = validateRefreshToken(parsed.data.refreshToken);
    if (!session) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const user = getUserById(session.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const accessToken = generateAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const session = validateRefreshToken(parsed.data.refreshToken);
    if (session) {
      revokeSession(session.id);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout-all", requireAuth, (req, res, next) => {
  try {
    const revokedCount = revokeAllUserSessions(req.user!.id);
    logger.info({ userId: req.user!.id, revokedCount }, "All sessions revoked");
    res.json({ revokedCount });
  } catch (err) {
    next(err);
  }
});
