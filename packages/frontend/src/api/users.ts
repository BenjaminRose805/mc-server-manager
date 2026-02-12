import type { User } from "@mc-server-manager/shared";
import { authFetch } from "./client.js";

export async function getCurrentUser(): Promise<User> {
  return authFetch<User>("/api/users/me");
}

export async function updateProfile(data: {
  displayName?: string;
  avatarUrl?: string | null;
}): Promise<User> {
  return authFetch<User>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getUsers(): Promise<User[]> {
  return authFetch<User[]>("/api/users");
}

export async function getUserById(id: string): Promise<User> {
  return authFetch<User>(`/api/users/${id}`);
}

export async function updateUserRole(
  id: string,
  role: "owner" | "admin" | "member",
): Promise<User> {
  return authFetch<User>(`/api/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return authFetch<void>(`/api/users/${id}`, {
    method: "DELETE",
  });
}

export async function updateMinecraftLink(data: {
  minecraftUsername: string;
  minecraftUuid: string;
}): Promise<User> {
  return authFetch<User>("/api/users/me/minecraft", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
