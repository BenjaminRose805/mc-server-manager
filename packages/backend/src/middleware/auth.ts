import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@mc-server-manager/shared";
import { verifyAccessToken } from "../services/jwt.js";
import { getPermission } from "../models/server-permission.js";
import { countUsers } from "../models/user.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: UserRole;
      };
    }
  }
}

const permissionKeyMap = {
  can_view: "canView",
  can_start: "canStart",
  can_console: "canConsole",
  can_edit: "canEdit",
  can_join: "canJoin",
} as const;

type PermissionFlag = keyof typeof permissionKeyMap;

let cachedUserCount: number | null = null;

export function invalidateUserCountCache(): void {
  cachedUserCount = null;
}

function isMultiUserMode(): boolean {
  if (cachedUserCount === null) {
    cachedUserCount = countUsers();
  }
  return cachedUserCount > 0;
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    if (!isMultiUserMode()) {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (
      !header ||
      typeof header !== "string" ||
      !header.startsWith("Bearer ")
    ) {
      logger.warn(
        { path: req.path, method: req.method },
        "Missing or malformed Authorization header",
      );
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }

    const token = header.slice(7);
    const payload = verifyAccessToken(token);
    if (!payload) {
      logger.warn(
        { path: req.path, method: req.method },
        "Invalid or expired access token",
      );
      throw new UnauthorizedError("Invalid or expired access token");
    }

    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        if (!isMultiUserMode()) {
          next();
          return;
        }
        throw new UnauthorizedError();
      }
      if (!roles.includes(req.user.role)) {
        logger.warn(
          {
            path: req.path,
            userId: req.user?.id,
            role: req.user?.role,
            requiredRoles: roles,
          },
          "Insufficient role",
        );
        throw new ForbiddenError(`Required role: ${roles.join(" or ")}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireOwner(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    if (!req.user) {
      if (!isMultiUserMode()) {
        next();
        return;
      }
      throw new UnauthorizedError();
    }
    if (req.user.role !== "owner") {
      throw new ForbiddenError("Owner role required");
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdminOrOwner(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    if (!req.user) {
      if (!isMultiUserMode()) {
        next();
        return;
      }
      throw new UnauthorizedError();
    }
    if (req.user.role !== "owner" && req.user.role !== "admin") {
      throw new ForbiddenError("Admin or owner role required");
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireServerPermission(permission: PermissionFlag) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        if (!isMultiUserMode()) {
          next();
          return;
        }
        throw new UnauthorizedError();
      }

      if (req.user.role === "owner" || req.user.role === "admin") {
        next();
        return;
      }

      const rawId = req.params.serverId ?? req.params.id;
      const serverId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!serverId) {
        throw new ForbiddenError("No server ID in request");
      }

      const record = getPermission(serverId, req.user.id);
      const key = permissionKeyMap[permission];

      if (!record || !record[key]) {
        logger.warn(
          { path: req.path, userId: req.user?.id, serverId, permission },
          "Server permission denied",
        );
        throw new ForbiddenError();
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
