use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

const MS_CLIENT_ID: &str = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const MS_TENANT: &str = "consumers";
const MS_SCOPE: &str = "XboxLive.signin offline_access";

const KEYRING_SERVICE: &str = "mc-server-manager";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XboxLiveAuthResponse {
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: XboxDisplayClaims,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XboxDisplayClaims {
    pub xui: Vec<XboxUserInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XboxUserInfo {
    pub uhs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftAuthResponse {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MSAuthStatus {
    pub status: String,
    pub account: Option<LauncherAccount>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAccount {
    pub id: String,
    pub uuid: String,
    pub username: String,
    pub account_type: String,
    pub last_used: Option<String>,
    pub created_at: String,
}

pub struct AuthState {
    pub pending_auth: Mutex<Option<DeviceCodeResponse>>,
}

impl AuthState {
    pub fn new() -> Self {
        Self {
            pending_auth: Mutex::new(None),
        }
    }
}

fn keyring_set(key: &str, value: &str) -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .set_password(value)
        .map_err(|e| format!("keyring set: {e}"))
}

fn keyring_get(key: &str) -> Result<String, String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("keyring get: {e}"))
}

fn keyring_delete(key: &str) -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring entry: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete: {e}")),
    }
}

#[tauri::command]
pub async fn ms_auth_start(
    state: State<'_, AuthState>,
) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let params = [("client_id", MS_CLIENT_ID), ("scope", MS_SCOPE)];

    let res = client
        .post(format!(
            "https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/devicecode"
        ))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("device code request failed: {e}"))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("device code endpoint returned error: {body}"));
    }

    let device_code: DeviceCodeResponse = res
        .json()
        .await
        .map_err(|e| format!("failed to parse device code response: {e}"))?;

    *state.pending_auth.lock().unwrap() = Some(device_code.clone());

    Ok(device_code)
}

#[tauri::command]
pub async fn ms_auth_poll(
    state: State<'_, AuthState>,
) -> Result<MSAuthStatus, String> {
    let device_code = state
        .pending_auth
        .lock()
        .unwrap()
        .clone()
        .ok_or("No pending auth")?;

    let client = reqwest::Client::new();
    let params = [
        ("client_id", MS_CLIENT_ID),
        (
            "grant_type",
            "urn:ietf:params:oauth:grant-type:device_code",
        ),
        ("device_code", &device_code.device_code),
    ];

    let res = client
        .post(format!(
            "https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/token"
        ))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token poll failed: {e}"))?;

    if res.status() == reqwest::StatusCode::BAD_REQUEST {
        let error: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("failed to parse error response: {e}"))?;
        let error_code = error["error"].as_str().unwrap_or("unknown");

        if error_code == "authorization_pending" {
            return Ok(MSAuthStatus {
                status: "pending".to_string(),
                account: None,
                error: None,
            });
        } else if error_code == "expired_token" {
            *state.pending_auth.lock().unwrap() = None;
            return Ok(MSAuthStatus {
                status: "expired".to_string(),
                account: None,
                error: Some("Device code expired".to_string()),
            });
        } else {
            *state.pending_auth.lock().unwrap() = None;
            return Ok(MSAuthStatus {
                status: "error".to_string(),
                account: None,
                error: Some(format!("Auth error: {error_code}")),
            });
        }
    }

    let token: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("failed to parse token response: {e}"))?;

    let account = complete_auth_chain(token).await?;
    *state.pending_auth.lock().unwrap() = None;

    Ok(MSAuthStatus {
        status: "complete".to_string(),
        account: Some(account),
        error: None,
    })
}

#[tauri::command]
pub async fn ms_auth_refresh(account_uuid: String) -> Result<LauncherAccount, String> {
    let refresh_token = keyring_get(&format!("ms_refresh_token_{account_uuid}"))?;

    let client = reqwest::Client::new();
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("scope", MS_SCOPE),
    ];

    let res = client
        .post(format!(
            "https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/token"
        ))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("refresh token request failed: {e}"))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("refresh token exchange failed: {body}"));
    }

    let token: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("failed to parse refresh response: {e}"))?;

    complete_auth_chain(token).await
}

#[tauri::command]
pub async fn get_mc_access_token(account_uuid: String) -> Result<String, String> {
    keyring_get(&format!("mc_access_token_{account_uuid}"))
}

#[tauri::command]
pub async fn remove_account(account_uuid: String) -> Result<(), String> {
    keyring_delete(&format!("mc_access_token_{account_uuid}"))?;
    keyring_delete(&format!("ms_refresh_token_{account_uuid}"))?;
    Ok(())
}

async fn complete_auth_chain(token: TokenResponse) -> Result<LauncherAccount, String> {
    let client = reqwest::Client::new();

    let xbox_auth_body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", token.access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let xbox_res: XboxLiveAuthResponse = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&xbox_auth_body)
        .send()
        .await
        .map_err(|e| format!("Xbox Live auth failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Xbox Live response parse failed: {e}"))?;

    let uhs = xbox_res
        .display_claims
        .xui
        .first()
        .ok_or("No Xbox user hash in response")?
        .uhs
        .clone();

    let xsts_body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbox_res.token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let xsts_res: XboxLiveAuthResponse = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&xsts_body)
        .send()
        .await
        .map_err(|e| format!("XSTS auth failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("XSTS response parse failed: {e}"))?;

    let mc_auth_body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={uhs};{}", xsts_res.token)
    });

    let mc_auth_res: MinecraftAuthResponse = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_auth_body)
        .send()
        .await
        .map_err(|e| format!("Minecraft auth failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Minecraft auth response parse failed: {e}"))?;

    let profile: MinecraftProfile = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_auth_res.access_token)
        .send()
        .await
        .map_err(|e| format!("Minecraft profile fetch failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Minecraft profile parse failed: {e}"))?;

    keyring_set(
        &format!("mc_access_token_{}", profile.id),
        &mc_auth_res.access_token,
    )?;
    keyring_set(
        &format!("ms_refresh_token_{}", profile.id),
        &token.refresh_token,
    )?;

    Ok(LauncherAccount {
        id: uuid::Uuid::new_v4().to_string(),
        uuid: profile.id,
        username: profile.name,
        account_type: "msa".to_string(),
        last_used: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
