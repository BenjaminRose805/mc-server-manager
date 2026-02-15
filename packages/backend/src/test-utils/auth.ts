import { nanoid } from "nanoid";
import type { UserRole } from "@mc-server-manager/shared";
import { generateAccessToken } from "../services/jwt.js";
import { createUser } from "../models/user.js";

export interface TestUser {
  id: string;
  username: string;
  role: UserRole;
  token: string;
}

export function createTestUser(
  overrides: Partial<{ id: string; username: string; role: UserRole }> = {},
): TestUser {
  const id = overrides.id ?? nanoid();
  const username = overrides.username ?? `testuser-${id.slice(0, 8)}`;
  const role = overrides.role ?? "member";

  createUser({
    id,
    username,
    displayName: username,
    passwordHash: "test-hash-not-real",
    role,
  });

  const token = generateAccessToken({ id, username, role });

  return { id, username, role, token };
}

export function createTestOwner(
  overrides: Partial<{ id: string; username: string }> = {},
): TestUser {
  return createTestUser({ ...overrides, role: "owner" });
}
