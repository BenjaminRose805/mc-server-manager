import type { Invitation } from "@mc-server-manager/shared";
import { request } from "./client.js";

export async function createInvitation(data: {
  role: "admin" | "member";
  maxUses?: number;
  expiresAt?: string | null;
}): Promise<Invitation> {
  return request<Invitation>("/api/invitations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getInvitations(): Promise<Invitation[]> {
  return request<Invitation[]>("/api/invitations");
}

export async function deleteInvitation(id: string): Promise<void> {
  return request<void>(`/api/invitations/${id}`, {
    method: "DELETE",
  });
}
