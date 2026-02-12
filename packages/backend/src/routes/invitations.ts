import { Router } from "express";
import { customAlphabet } from "nanoid";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  createInvitation,
  listInvitations,
  deleteInvitation,
} from "../models/invitation.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { requireAuth, requireAdminOrOwner } from "../middleware/auth.js";

export const invitationsRouter = Router();

invitationsRouter.use(requireAuth);
invitationsRouter.use(requireAdminOrOwner);

const generateCode = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  8,
);

function parseDuration(durationStr: string): number {
  const match = durationStr.match(/^(\d+)([dhm])$/);
  if (!match) {
    throw new AppError(
      'Invalid duration format. Use format like "7d", "24h", or "30m"',
      400,
      "VALIDATION_ERROR",
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      throw new AppError("Invalid duration unit", 400, "VALIDATION_ERROR");
  }
}

const createInvitationSchema = z.object({
  maxUses: z.number().int().positive().optional().default(1),
  expiresIn: z
    .string()
    .regex(/^\d+[dhm]$/)
    .optional(),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

/**
 * POST /api/invitations — Create a new invitation
 */
invitationsRouter.post("/", (req, res, next) => {
  try {
    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new AppError(message, 400, "VALIDATION_ERROR");
    }

    const body = parsed.data;
    const id = nanoid(12);
    const code = generateCode();

    let expiresAt: string | null = null;
    if (body.expiresIn) {
      const durationMs = parseDuration(body.expiresIn);
      const expiresDate = new Date(Date.now() + durationMs);
      expiresAt = expiresDate.toISOString();
    }

    const invitation = createInvitation({
      id,
      code,
      createdBy: req.user!.id,
      maxUses: body.maxUses,
      role: body.role,
      expiresAt,
    });

    const link = `${req.protocol}://${req.get("host")}/register?code=${code}`;

    logger.info({ invitationId: invitation.id, code }, "Invitation created");
    res.status(201).json({ ...invitation, link });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/invitations — List all invitations
 */
invitationsRouter.get("/", (_req, res, next) => {
  try {
    const invitations = listInvitations();
    res.json({ invitations });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/invitations/:id — Delete an invitation
 */
invitationsRouter.delete("/:id", (req, res, next) => {
  try {
    deleteInvitation(req.params.id);
    logger.info({ invitationId: req.params.id }, "Invitation deleted");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
