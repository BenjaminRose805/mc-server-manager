/**
 * Microsoft OAuth2 device-code auth flow for Minecraft.
 * Ported from packages/desktop/src-tauri/src/auth.rs.
 *
 * Chain: MS device code → MS token → Xbox Live → XSTS → Minecraft Services → profile
 *
 * @module auth
 */

import { saveSecret, getSecret, deleteSecret } from "./secure-storage.js";
import type {
  MSAuthDeviceCode,
  MSAuthStatus,
  LauncherAccount,
} from "@mc-server-manager/shared";

// Constants

const MS_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const MS_TENANT = "consumers";
const MS_SCOPE = "XboxLive.signin offline_access";

const TOKEN_URL = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`;
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/devicecode`;

// Internal response types (match MS/Xbox/Minecraft JSON shapes)

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

let pendingAuth: DeviceCodeResponse | null = null;

function formBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function completeAuthChain(
  token: TokenResponse,
): Promise<LauncherAccount> {
  const xboxRes = await fetch(
    "https://user.auth.xboxlive.com/user/authenticate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: `d=${token.access_token}`,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    },
  );

  if (!xboxRes.ok) {
    const body = await xboxRes.text();
    throw new Error(`Xbox Live auth failed: ${body}`);
  }

  const xboxData: XboxLiveAuthResponse = await xboxRes.json();
  const uhs = xboxData.DisplayClaims.xui[0]?.uhs;
  if (!uhs) {
    throw new Error("No Xbox user hash in response");
  }

  const xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
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
  });

  if (!xstsRes.ok) {
    const body = await xstsRes.text();
    throw new Error(`XSTS auth failed: ${body}`);
  }

  const xstsData: XboxLiveAuthResponse = await xstsRes.json();

  const mcAuthRes = await fetch(
    "https://api.minecraftservices.com/authentication/login_with_xbox",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${uhs};${xstsData.Token}`,
      }),
    },
  );

  if (!mcAuthRes.ok) {
    const body = await mcAuthRes.text();
    throw new Error(`Minecraft auth failed: ${body}`);
  }

  const mcAuth: MinecraftAuthResponse = await mcAuthRes.json();

  const profileRes = await fetch(
    "https://api.minecraftservices.com/minecraft/profile",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${mcAuth.access_token}` },
    },
  );

  if (!profileRes.ok) {
    const body = await profileRes.text();
    throw new Error(`Minecraft profile fetch failed: ${body}`);
  }

  const profile: MinecraftProfile = await profileRes.json();

  saveSecret(`mc_access_token_${profile.id}`, mcAuth.access_token);
  saveSecret(`ms_refresh_token_${profile.id}`, token.refresh_token);

  return {
    id: crypto.randomUUID(),
    uuid: profile.id,
    username: profile.name,
    accountType: "msa",
    lastUsed: null,
    createdAt: new Date().toISOString(),
  };
}

export async function msAuthStart(): Promise<MSAuthDeviceCode> {
  const res = await fetch(DEVICE_CODE_URL, {
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

  const res = await fetch(TOKEN_URL, {
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

  const token: TokenResponse = await res.json();
  const account = await completeAuthChain(token);
  pendingAuth = null;

  return { status: "complete", account };
}

export async function msAuthRefresh(
  accountUuid: string,
): Promise<LauncherAccount> {
  const refreshToken = getSecret(`ms_refresh_token_${accountUuid}`);
  if (!refreshToken) {
    throw new Error(`No refresh token found for account ${accountUuid}`);
  }

  const res = await fetch(TOKEN_URL, {
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
  return completeAuthChain(token);
}

export async function getMcAccessToken(accountUuid: string): Promise<string> {
  const token = getSecret(`mc_access_token_${accountUuid}`);
  if (token) {
    return token;
  }

  const refreshToken = getSecret(`ms_refresh_token_${accountUuid}`);
  if (!refreshToken) {
    throw new Error(`No tokens found for account ${accountUuid}`);
  }

  await msAuthRefresh(accountUuid);

  const newToken = getSecret(`mc_access_token_${accountUuid}`);
  if (!newToken) {
    throw new Error(
      `Failed to obtain access token after refresh for ${accountUuid}`,
    );
  }

  return newToken;
}

export async function removeAccount(accountUuid: string): Promise<void> {
  deleteSecret(`mc_access_token_${accountUuid}`);
  deleteSecret(`ms_refresh_token_${accountUuid}`);
}
