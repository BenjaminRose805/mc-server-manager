import { Router } from "express";
import { z } from "zod";
import {
  getUserById,
  getUserWithPasswordHash,
  listUsers,
  updateUserProfile,
  updateUserRole,
  deactivateUser,
} from "../models/user.js";
import {
  requireAuth,
  requireAdminOrOwner,
  requireOwner,
} from "../middleware/auth.js";
import { verifyPassword, hashPassword } from "../services/auth.js";
import { revokeAllUserSessions } from "../services/session.js";
import { AppError, NotFoundError, ForbiddenError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export const usersRouter = Router();

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

const updateMinecraftSchema = z.object({
  minecraftUsername: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/),
  minecraftUuid: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
});

usersRouter.get("/me", requireAuth, (req, res, next) => {
  try {
    const user = getUserById(req.user!.id);
    if (!user) {
      throw new NotFoundError("User", req.user!.id);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const body = validate(updateProfileSchema, req.body);
    const updateData: {
      displayName?: string;
      avatarUrl?: string;
      passwordHash?: string;
    } = {};

    if (body.displayName !== undefined) {
      updateData.displayName = body.displayName;
    }
    if (body.avatarUrl !== undefined) {
      updateData.avatarUrl = body.avatarUrl;
    }

    if (body.newPassword !== undefined) {
      if (!body.currentPassword) {
        throw new AppError(
          "Current password is required to set a new password",
          400,
          "VALIDATION_ERROR",
        );
      }

      const userWithHash = getUserWithPasswordHash(req.user!.id);
      if (!userWithHash) {
        throw new NotFoundError("User", req.user!.id);
      }

      const isValid = await verifyPassword(
        userWithHash.passwordHash,
        body.currentPassword,
      );
      if (!isValid) {
        throw new AppError(
          "Current password is incorrect",
          400,
          "VALIDATION_ERROR",
        );
      }

      updateData.passwordHash = await hashPassword(body.newPassword);
    }

    updateUserProfile(req.user!.id, updateData);

    const updatedUser = getUserById(req.user!.id);
    if (!updatedUser) {
      throw new NotFoundError("User", req.user!.id);
    }

    logger.info({ userId: req.user!.id }, "User profile updated");
    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/me/minecraft", requireAuth, (req, res, next) => {
  try {
    const body = validate(updateMinecraftSchema, req.body);

    updateUserProfile(req.user!.id, {
      minecraftUsername: body.minecraftUsername,
      minecraftUuid: body.minecraftUuid,
    });

    const updatedUser = getUserById(req.user!.id);
    if (!updatedUser) {
      throw new NotFoundError("User", req.user!.id);
    }

    logger.info({ userId: req.user!.id }, "Minecraft profile updated");
    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/", requireAuth, requireAdminOrOwner, (req, res, next) => {
  try {
    const filters: { role?: "owner" | "admin" | "member"; active?: boolean } =
      {};

    if (req.query.role && typeof req.query.role === "string") {
      const roleSchema = z.enum(["owner", "admin", "member"]).optional();
      filters.role = validate(roleSchema, req.query.role);
    }
    if (req.query.active !== undefined) {
      filters.active = req.query.active === "true";
    }

    const users = listUsers(filters);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:id", requireAuth, requireAdminOrOwner, (req, res, next) => {
  try {
    const id = validate(z.string().min(1), req.params.id);
    const user = getUserById(id);
    if (!user) {
      throw new NotFoundError("User", id);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/:id/role", requireAuth, requireOwner, (req, res, next) => {
  try {
    const id = validate(z.string().min(1), req.params.id);

    const body = validate(updateRoleSchema, req.body);

    const targetUser = getUserById(id);
    if (!targetUser) {
      throw new NotFoundError("User", id);
    }

    if (targetUser.role === "owner") {
      throw new AppError("Cannot change owner role", 400, "VALIDATION_ERROR");
    }

    updateUserRole(id, body.role);

    const updatedUser = getUserById(id);
    if (!updatedUser) {
      throw new NotFoundError("User", id);
    }

    logger.info({ userId: id, newRole: body.role }, "User role updated");
    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

usersRouter.delete("/:id", requireAuth, requireOwner, (req, res, next) => {
  try {
    const id = validate(z.string().min(1), req.params.id);

    const targetUser = getUserById(id);
    if (!targetUser) {
      throw new NotFoundError("User", id);
    }

    if (targetUser.role === "owner") {
      throw new ForbiddenError("Cannot delete owner account");
    }

    deactivateUser(id);
    revokeAllUserSessions(id);

    logger.info({ userId: id }, "User deactivated");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
