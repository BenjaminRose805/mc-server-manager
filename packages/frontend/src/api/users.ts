import type { User } from "@mc-server-manager/shared";
import { request } from "./client.js";

export async function getCurrentUser(): Promise<User> {
  return request<User>("/api/users/me");
}

export async function updateProfile(data: {
  displayName?: string;
  avatarUrl?: string | null;
}): Promise<User> {
  return request<User>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getUsers(): Promise<User[]> {
  return request<User[]>("/api/users");
}

export async function getUserById(id: string): Promise<User> {
  return request<User>(`/api/users/${id}`);
}

export async function updateUserRole(
  id: string,
  role: "owner" | "admin" | "member",
): Promise<User> {
  return request<User>(`/api/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return request<void>(`/api/users/${id}`, {
    method: "DELETE",
  });
}

export async function updateMinecraftLink(data: {
  minecraftUsername: string;
  minecraftUuid: string;
}): Promise<User> {
  return request<User>("/api/users/me/minecraft", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
