import type {
  SetupRequest,
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  RefreshResponse,
  AuthStatusResponse,
} from "@mc-server-manager/shared";
import { authFetch } from "./client.js";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function setupAccount(data: SetupRequest): Promise<AuthResponse> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  return res.json();
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  return res.json();
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const error = new ApiError(
      res.status,
      body.error || res.statusText,
      body.code,
    );
    throw error;
  }

  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResponse> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  return res.json();
}

export async function logout(refreshToken: string): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }
}

export async function logoutAll(): Promise<{ revokedCount: number }> {
  return authFetch<{ revokedCount: number }>("/api/auth/logout-all", {
    method: "POST",
  });
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch("/api/auth/status");

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  return res.json();
}
