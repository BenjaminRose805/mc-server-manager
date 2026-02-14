/**
 * Microsoft OAuth2 device-code auth flow for Minecraft.
 *
 * Chain: MS device code → MS token → Xbox Live → XSTS → Minecraft Services → profile
 *
 * Key reliability features:
 * - MS refresh token saved BEFORE auth chain (recoverable on partial failure)
 * - Token expiry tracking with 60s safety buffer
 * - Per-request timeouts (15s) with 1 retry on transient (5xx/network) errors
 * - Auth mutex prevents concurrent flows from racing on secure storage
 * - Human-readable XSTS error messages for common failure codes
 * - `slow_down` response handled per RFC 8628
 *
 * @module auth
 */

import { saveSecret, getSecret, deleteSecret } from "./secure-storage.js";
import type {
  MSAuthDeviceCode,
  MSAuthStatus,
  LauncherAccount,
} from "@mc-server-manager/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const MS_TENANT = "consumers";
const MS_SCOPE = "XboxLive.signin offline_access";

const TOKEN_URL = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`;
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/devicecode`;

/** Per-request timeout for auth chain HTTP calls (ms). */
const REQUEST_TIMEOUT_MS = 15_000;

/** Safety buffer subtracted from token TTL when computing expiresAt (ms). */
const EXPIRY_BUFFER_MS = 60_000;

/** Known XSTS error codes → user-friendly messages. */
const XSTS_ERROR_MESSAGES: Record<number, string> = {
  2148916233:
    "This Microsoft account has no Xbox account. Create one at xbox.com",
  2148916235: "Xbox Live is not available in your country/region",
  2148916236: "Adult verification is required for this account",
  2148916237: "Adult verification is required for this account",
  2148916238:
    "This is a child account. A parent must approve in Xbox Family Settings",
};

// ---------------------------------------------------------------------------
// Internal response types (match MS/Xbox/Minecraft JSON shapes)
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface XboxLiveAuthResponse {
  Token: string;
  DisplayClaims: {
    xui: Array<{ uhs: string }>;
  };
}

interface MinecraftAuthResponse {
  access_token: string;
  expires_in: number;
}

interface MinecraftProfile {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let pendingAuth: DeviceCodeResponse | null = null;

/** Simple promise-based mutex to prevent concurrent auth chain execution. */
let authLock: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Fetch with an AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry a fetch function once on transient (5xx / network) failures.
 * 4xx errors are never retried — they indicate auth problems.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const isTransient =
      err instanceof Error &&
      (err.name === "AbortError" ||
        (err as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
        (err as NodeJS.ErrnoException).code === "ECONNRESET" ||
        (err as NodeJS.ErrnoException).code === "ECONNREFUSED");
    if (!isTransient) throw err;
    // Wait 1s then retry once
    await new Promise((r) => setTimeout(r, 1000));
    return await fn();
  }
}

/** Acquire the auth lock, run `fn`, then release. Prevents concurrent chain execution. */
async function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = authLock;
  let release: () => void;
  authLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// ---------------------------------------------------------------------------
// Token expiry helpers
// ---------------------------------------------------------------------------

function saveTokenWithExpiry(
  key: string,
  token: string,
  expiresInSec: number,
): void {
  saveSecret(key, token);
  saveSecret(
    `${key}_expires_at`,
    String(Date.now() + expiresInSec * 1000 - EXPIRY_BUFFER_MS),
  );
}

function getTokenIfValid(key: string): string | null {
  const expiresAt = Number(getSecret(`${key}_expires_at`) ?? "0");
  if (Date.now() >= expiresAt) return null;
  return getSecret(key);
}

function deleteTokenWithExpiry(key: string): void {
  deleteSecret(key);
  deleteSecret(`${key}_expires_at`);
}

// ---------------------------------------------------------------------------
// Auth chain (Xbox Live → XSTS → Minecraft → Profile)
// ---------------------------------------------------------------------------

async function completeAuthChain(
  msAccessToken: string,
  msRefreshToken: string,
): Promise<LauncherAccount> {
  // Step 1: Xbox Live auth
  const xboxRes = await withRetry(() =>
    fetchWithTimeout("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: `d=${msAccessToken}`,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    }),
  );

  if (!xboxRes.ok) {
    const body = await xboxRes.text();
    throw new Error(`Xbox Live auth failed (${xboxRes.status}): ${body}`);
  }

  const xboxData: XboxLiveAuthResponse = await xboxRes.json();
  const uhs = xboxData.DisplayClaims.xui[0]?.uhs;
  if (!uhs) {
    throw new Error("No Xbox user hash in response");
  }

  // Step 2: XSTS auth
  const xstsRes = await withRetry(() =>
    fetchWithTimeout("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: "RETAIL",
          UserTokens: [xboxData.Token],
        },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT",
      }),
    }),
  );

  if (!xstsRes.ok) {
    // Parse XSTS-specific error codes for human-readable messages
    let errorMessage = `Xbox authentication failed (${xstsRes.status})`;
    try {
      const body = (await xstsRes.json()) as { XErr?: number };
      if (body.XErr && XSTS_ERROR_MESSAGES[body.XErr]) {
        errorMessage = XSTS_ERROR_MESSAGES[body.XErr];
      } else if (body.XErr) {
        errorMessage = `Xbox authentication failed (code ${body.XErr})`;
      }
    } catch {
      // JSON parse failed — use default message
    }
    throw new Error(errorMessage);
  }

  const xstsData: XboxLiveAuthResponse = await xstsRes.json();

  // Step 3: Minecraft auth
  const mcAuthRes = await withRetry(() =>
    fetchWithTimeout(
      "https://api.minecraftservices.com/authentication/login_with_xbox",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identityToken: `XBL3.0 x=${uhs};${xstsData.Token}`,
        }),
      },
    ),
  );

  if (!mcAuthRes.ok) {
    const body = await mcAuthRes.text();
    throw new Error(`Minecraft auth failed (${mcAuthRes.status}): ${body}`);
  }

  const mcAuth: MinecraftAuthResponse = await mcAuthRes.json();

  // Step 4: Minecraft profile
  const profileRes = await withRetry(() =>
    fetchWithTimeout("https://api.minecraftservices.com/minecraft/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${mcAuth.access_token}` },
    }),
  );

  if (profileRes.status === 404) {
    throw new Error(
      "This Microsoft account does not own Minecraft Java Edition",
    );
  }

  if (!profileRes.ok) {
    const body = await profileRes.text();
    throw new Error(
      `Minecraft profile fetch failed (${profileRes.status}): ${body}`,
    );
  }

  const profile: MinecraftProfile = await profileRes.json();

  // Save tokens with expiry tracking (MC token ~24h, refresh token persisted)
  saveTokenWithExpiry(
    `mc_access_token_${profile.id}`,
    mcAuth.access_token,
    mcAuth.expires_in,
  );
  saveSecret(`ms_refresh_token_${profile.id}`, msRefreshToken);

  return {
    id: crypto.randomUUID(),
    uuid: profile.id,
    username: profile.name,
    accountType: "msa",
    lastUsed: null,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function msAuthStart(): Promise<MSAuthDeviceCode> {
  const res = await fetchWithTimeout(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: MS_CLIENT_ID,
      scope: MS_SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Device code request failed: ${body}`);
  }

  const data: DeviceCodeResponse = await res.json();
  pendingAuth = data;

  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export async function msAuthPoll(): Promise<MSAuthStatus> {
  if (!pendingAuth) {
    throw new Error("No pending auth");
  }

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: MS_CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: pendingAuth.device_code,
    }),
  });

  if (res.status === 400) {
    const error = (await res.json()) as { error: string };
    const errorCode = error.error ?? "unknown";

    if (errorCode === "authorization_pending") {
      return { status: "pending" };
    }

    // RFC 8628 §3.5: client MUST increase interval by 5 seconds
    if (errorCode === "slow_down") {
      return { status: "slow_down" };
    }

    if (errorCode === "authorization_declined") {
      pendingAuth = null;
      return { status: "error", error: "Sign-in request was denied" };
    }

    pendingAuth = null;

    if (errorCode === "expired_token") {
      return { status: "expired", error: "Device code expired" };
    }

    return { status: "error", error: `Auth error: ${errorCode}` };
  }

  if (!res.ok) {
    pendingAuth = null;
    const body = await res.text();
    return { status: "error", error: `Token request failed: ${body}` };
  }

  // Token exchange succeeded — run chain under auth lock to prevent races
  const token: TokenResponse = await res.json();

  const account = await withAuthLock(async () => {
    return await completeAuthChain(token.access_token, token.refresh_token);
  });

  pendingAuth = null;

  return { status: "complete", account };
}

export async function msAuthCancel(): Promise<void> {
  pendingAuth = null;
}

export async function msAuthRefresh(
  accountUuid: string,
): Promise<LauncherAccount> {
  const refreshToken = getSecret(`ms_refresh_token_${accountUuid}`);
  if (!refreshToken) {
    throw new Error(`No refresh token found for account ${accountUuid}`);
  }

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Refresh token exchange failed: ${body}`);
  }

  const token: TokenResponse = await res.json();
  return withAuthLock(() =>
    completeAuthChain(token.access_token, token.refresh_token),
  );
}

export async function getMcAccessToken(accountUuid: string): Promise<string> {
  // Check cached token with expiry
  const cachedToken = getTokenIfValid(`mc_access_token_${accountUuid}`);
  if (cachedToken) {
    return cachedToken;
  }

  // Token expired or missing — try refresh
  const refreshToken = getSecret(`ms_refresh_token_${accountUuid}`);
  if (!refreshToken) {
    throw new Error(`No tokens found for account ${accountUuid}`);
  }

  await msAuthRefresh(accountUuid);

  const newToken = getTokenIfValid(`mc_access_token_${accountUuid}`);
  if (!newToken) {
    throw new Error(
      `Failed to obtain access token after refresh for ${accountUuid}`,
    );
  }

  return newToken;
}

export async function removeAccount(accountUuid: string): Promise<void> {
  deleteTokenWithExpiry(`mc_access_token_${accountUuid}`);
  deleteSecret(`ms_refresh_token_${accountUuid}`);
}
