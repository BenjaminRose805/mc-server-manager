# Epic 3 — Minecraft Client Launcher

> **Prerequisite for**: Epic 4 (Client Mods), Epic 9 (Mod Sync)
> **Standalone value**: Launch Minecraft from the same app used to manage servers — full custom launcher with Microsoft authentication, version management, and instance isolation
> **Dependencies**: Epic 1 (Tauri Desktop) — required. The Tauri Rust core provides native OS access for launching processes, managing files, and secure credential storage.

---

## Executive Summary

Build a complete Minecraft client launcher into the Tauri desktop app. Users can authenticate with Microsoft accounts, select any Minecraft version, create isolated game instances (profiles), and launch the game — all from the same interface they use to manage servers.

### Key Decisions

- **Microsoft authentication in Rust**: The full OAuth2 device code flow, Xbox Live authentication chain, and token management happen in Tauri's Rust core. This provides native security (OS keychain integration) and keeps sensitive tokens out of the JavaScript layer.
- **Instance isolation**: Each profile gets its own directory for saves, mods, resource packs, and config. Libraries, assets, and game JARs are shared across instances to save disk space.
- **Java version management**: Automatically detect installed JVMs and download the correct Java version for each Minecraft version (Java 8 for 1.16-, Java 17 for 1.18-1.20.4, Java 21 for 1.20.5+).
- **Mojang's official APIs**: Use the official version manifest, asset system, and library resolution. This ensures compatibility and avoids reverse-engineering.
- **Backend stores metadata**: The Express backend stores instance configurations in SQLite. The Rust core handles all file I/O and process launching.

---

## Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Microsoft OAuth2 Device Code Flow (Rust Core)                 │
│                                                                 │
│  1. POST /oauth2/v2.0/devicecode                                │
│     → user_code, device_code, verification_uri                  │
│                                                                 │
│  2. User visits verification_uri, enters user_code              │
│                                                                 │
│  3. Poll POST /oauth2/v2.0/token (every 5s)                     │
│     → access_token, refresh_token                               │
│                                                                 │
│  4. POST https://user.auth.xboxlive.com/user/authenticate       │
│     Body: { "RelyingParty": "http://auth.xboxlive.com",         │
│             "TokenType": "JWT",                                 │
│             "Properties": {                                     │
│               "AuthMethod": "RPS",                              │
│               "SiteName": "user.auth.xboxlive.com",             │
│               "RpsTicket": "d={access_token}" } }               │
│     → xbox_token, user_hash (uhs)                               │
│                                                                 │
│  5. POST https://xsts.auth.xboxlive.com/xsts/authorize          │
│     Body: { "RelyingParty": "rp://api.minecraftservices.com/",  │
│             "TokenType": "JWT",                                 │
│             "Properties": {                                     │
│               "UserTokens": [xbox_token],                       │
│               "SandboxId": "RETAIL" } }                         │
│     → xsts_token                                                │
│                                                                 │
│  6. POST https://api.minecraftservices.com/authentication/      │
│          login_with_xbox                                        │
│     Body: { "identityToken": "XBL3.0 x={uhs};{xsts_token}" }    │
│     → minecraft_access_token (expires in 24h)                   │
│                                                                 │
│  7. GET https://api.minecraftservices.com/minecraft/profile     │
│     → uuid, name                                                │
│                                                                 │
│  Tokens stored in OS keychain via tauri-plugin-keychain         │
└─────────────────────────────────────────────────────────────────┘
```

### Game Launch Flow

```
Frontend (LauncherUI)
  │
  ├── POST /api/launcher/instances          → Create instance
  ├── GET  /api/launcher/instances          → List instances
  ├── POST /api/launcher/instances/:id/launch → Launch game
  │
  └── Tauri IPC Commands
        │
        ├── ms_auth_start()                 → Begin device code flow
        ├── ms_auth_poll()                  → Check auth status
        ├── ms_auth_refresh()               → Refresh expired token
        ├── get_accounts()                  → List stored accounts
        ├── remove_account()                → Remove account
        │
        ├── get_java_installations()        → Detect installed JVMs
        ├── download_java(version)          → Download from Adoptium
        │
        └── launch_game(instance_id)        → Construct command, spawn process

Backend (Express)
  ├── InstanceService      → CRUD for instances, version selection
  ├── VersionService       → Fetch/cache Mojang version manifest
  ├── AssetService         → Download assets, libraries, game JARs
  └── SQLite               → instances table

Tauri Core (Rust)
  ├── AuthModule           → MS OAuth2, Xbox Live, MC auth chain
  ├── JavaManager          → Detect/download/manage Java installations
  ├── GameLauncher         → Construct launch command, spawn child process
  └── FileManager          → Extract natives, manage instance directories
```

### Directory Structure

```
data/
├── launcher/
│   ├── instances/                    # Per-instance directories
│   │   ├── {nanoid-1}/               # Instance 1
│   │   │   ├── saves/                # World saves (isolated)
│   │   │   ├── resourcepacks/        # Resource packs (isolated)
│   │   │   ├── mods/                 # Mods (isolated)
│   │   │   ├── shaderpacks/          # Shaders (isolated)
│   │   │   ├── options.txt           # Game settings (isolated)
│   │   │   └── servers.dat           # Server list (isolated)
│   │   └── {nanoid-2}/               # Instance 2
│   │       └── ...
│   │
│   ├── libraries/                    # Shared across all instances
│   │   └── {group}/{artifact}/{version}/{artifact}-{version}.jar
│   │
│   ├── assets/                       # Shared across all instances
│   │   ├── indexes/                  # Asset index JSONs
│   │   │   └── 1.21.json
│   │   └── objects/                  # Asset files (hash-based)
│   │       └── {hash[:2]}/{hash}
│   │
│   ├── versions/                     # Shared game JARs
│   │   └── 1.21.4/
│   │       ├── 1.21.4.jar
│   │       └── 1.21.4.json           # Version manifest
│   │
│   ├── runtime/                      # Downloaded Java runtimes
│   │   ├── java-8/
│   │   ├── java-17/
│   │   └── java-21/
│   │
│   └── natives/                      # Extracted native libraries (per-launch)
│       └── {instance-id}-{timestamp}/
```

---

## Database Changes

New table for launcher instances:

```sql
-- Migration: 00X_launcher_instances.sql

CREATE TABLE launcher_instances (
  id              TEXT PRIMARY KEY,         -- nanoid
  name            TEXT NOT NULL,            -- User-facing name
  mc_version      TEXT NOT NULL,            -- e.g. "1.21.4"
  version_type    TEXT NOT NULL DEFAULT 'release', -- release, snapshot, old_beta, old_alpha
  loader          TEXT,                     -- null (vanilla), fabric, forge, neoforge, quilt
  loader_version  TEXT,                     -- Loader version string
  java_version    INTEGER NOT NULL,         -- Required Java major version (8, 17, 21)
  java_path       TEXT,                     -- Path to java executable (null = auto-detect)
  ram_min         INTEGER NOT NULL DEFAULT 2,    -- Min RAM in GB
  ram_max         INTEGER NOT NULL DEFAULT 4,    -- Max RAM in GB
  resolution_width  INTEGER,                -- Window width (null = default)
  resolution_height INTEGER,                -- Window height (null = default)
  jvm_args        TEXT,                     -- Custom JVM arguments (JSON array)
  game_args       TEXT,                     -- Custom game arguments (JSON array)
  icon            TEXT,                     -- Icon path or URL
  last_played     TEXT,                     -- ISO timestamp
  total_playtime  INTEGER NOT NULL DEFAULT 0, -- Seconds
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_launcher_instances_last_played ON launcher_instances(last_played DESC);
```

New table for Microsoft accounts:

```sql
-- Migration: 00X_launcher_accounts.sql

CREATE TABLE launcher_accounts (
  id              TEXT PRIMARY KEY,         -- nanoid
  uuid            TEXT NOT NULL UNIQUE,     -- Minecraft UUID
  username        TEXT NOT NULL,            -- Minecraft username
  account_type    TEXT NOT NULL DEFAULT 'msa', -- msa (Microsoft), legacy (deprecated)
  last_used       TEXT,                     -- ISO timestamp
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tokens are NOT stored in SQLite — they live in OS keychain via Rust
```

---

## Shared Types

Add to `shared/src/index.ts`:

```typescript
// --- Launcher Types ---

export interface LauncherInstance {
  id: string;
  name: string;
  mcVersion: string;
  versionType: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  loader: 'fabric' | 'forge' | 'neoforge' | 'quilt' | null;
  loaderVersion: string | null;
  javaVersion: number;
  javaPath: string | null;
  ramMin: number;
  ramMax: number;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  jvmArgs: string[];
  gameArgs: string[];
  icon: string | null;
  lastPlayed: string | null;
  totalPlaytime: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  name: string;
  mcVersion: string;
  versionType?: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  loader?: 'fabric' | 'forge' | 'neoforge' | 'quilt';
  loaderVersion?: string;
  ramMin?: number;
  ramMax?: number;
}

export interface UpdateInstanceRequest {
  name?: string;
  ramMin?: number;
  ramMax?: number;
  resolutionWidth?: number | null;
  resolutionHeight?: number | null;
  jvmArgs?: string[];
  gameArgs?: string[];
  icon?: string | null;
}

export interface LauncherAccount {
  id: string;
  uuid: string;
  username: string;
  accountType: 'msa' | 'legacy';
  lastUsed: string | null;
  createdAt: string;
}

export interface MinecraftVersion {
  id: string;                    // e.g. "1.21.4"
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;                   // URL to version JSON
  time: string;                  // ISO timestamp
  releaseTime: string;           // ISO timestamp
  sha1: string;                  // Hash of version JSON
}

export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MinecraftVersion[];
}

export interface JavaInstallation {
  version: number;               // Major version (8, 17, 21)
  path: string;                  // Path to java executable
  vendor: string;                // e.g. "Eclipse Adoptium", "Oracle"
  fullVersion: string;           // e.g. "17.0.9+9"
}

export interface MSAuthDeviceCode {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface MSAuthStatus {
  status: 'pending' | 'complete' | 'expired' | 'error';
  account?: LauncherAccount;
  error?: string;
}

export interface LaunchGameRequest {
  instanceId: string;
  accountId: string;
}

export interface GameProcess {
  instanceId: string;
  pid: number;
  startedAt: string;
}
```

---

## Phase 3A: Microsoft Authentication (Rust Core)

### 3A.1: Tauri plugin dependencies

Add to `packages/desktop/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-keychain = "2"
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
```

### 3A.2: Auth module structure

**New file**: `packages/desktop/src-tauri/src/auth.rs`

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

const MS_CLIENT_ID: &str = "YOUR_AZURE_APP_CLIENT_ID"; // From Azure app registration
const MS_TENANT: &str = "consumers";
const MS_SCOPE: &str = "XboxLive.signin offline_access";

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

/// Step 1: Initiate device code flow
#[tauri::command]
pub async fn ms_auth_start(
    state: State<'_, AuthState>,
) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", MS_CLIENT_ID),
        ("scope", MS_SCOPE),
    ];

    let res = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
            MS_TENANT
        ))
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let device_code: DeviceCodeResponse = res.json().await.map_err(|e| e.to_string())?;

    // Store for polling
    *state.pending_auth.lock().unwrap() = Some(device_code.clone());

    Ok(device_code)
}

/// Step 2: Poll for token
#[tauri::command]
pub async fn ms_auth_poll(
    state: State<'_, AuthState>,
    app: tauri::AppHandle,
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
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("device_code", &device_code.device_code),
    ];

    let res = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            MS_TENANT
        ))
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status() == 400 {
        // Still pending or expired
        let error: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
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
        }
    }

    let token: TokenResponse = res.json().await.map_err(|e| e.to_string())?;

    // Continue auth chain: Xbox Live → XSTS → Minecraft
    let account = complete_auth_chain(&app, token).await?;

    // Clear pending auth
    *state.pending_auth.lock().unwrap() = None;

    Ok(MSAuthStatus {
        status: "complete".to_string(),
        account: Some(account),
        error: None,
    })
}

async fn complete_auth_chain(
    app: &tauri::AppHandle,
    token: TokenResponse,
) -> Result<LauncherAccount, String> {
    let client = reqwest::Client::new();

    // Step 3: Xbox Live authentication
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
        .json(&xbox_auth_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let uhs = &xbox_res.display_claims.xui[0].uhs;

    // Step 4: XSTS authentication
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
        .json(&xsts_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Step 5: Minecraft authentication
    let mc_auth_body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_res.token)
    });

    let mc_auth_res: MinecraftAuthResponse = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_auth_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Step 6: Get Minecraft profile
    let profile: MinecraftProfile = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_auth_res.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Store tokens in OS keychain
    let keychain = app.keychain();
    keychain
        .set(&format!("mc_access_token_{}", profile.id), &mc_auth_res.access_token)
        .map_err(|e| e.to_string())?;
    keychain
        .set(&format!("ms_refresh_token_{}", profile.id), &token.refresh_token)
        .map_err(|e| e.to_string())?;

    // Return account info (to be stored in SQLite by backend)
    Ok(LauncherAccount {
        id: uuid::Uuid::new_v4().to_string(),
        uuid: profile.id,
        username: profile.name,
        account_type: "msa".to_string(),
        last_used: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn ms_auth_refresh(
    app: tauri::AppHandle,
    account_uuid: String,
) -> Result<(), String> {
    // Retrieve refresh token from keychain, exchange for new access token
    // Implementation similar to complete_auth_chain but using refresh_token grant
    todo!("Implement refresh flow")
}

#[tauri::command]
pub async fn get_mc_access_token(
    app: tauri::AppHandle,
    account_uuid: String,
) -> Result<String, String> {
    let keychain = app.keychain();
    keychain
        .get(&format!("mc_access_token_{}", account_uuid))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_account(
    app: tauri::AppHandle,
    account_uuid: String,
) -> Result<(), String> {
    let keychain = app.keychain();
    let _ = keychain.delete(&format!("mc_access_token_{}", account_uuid));
    let _ = keychain.delete(&format!("ms_refresh_token_{}", account_uuid));
    Ok(())
}
```

### 3A.3: Register auth commands

Modify `packages/desktop/src-tauri/src/lib.rs`:

```rust
mod auth;

use auth::AuthState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_keychain::init())
        .manage(AuthState::new())
        .invoke_handler(tauri::generate_handler![
            auth::ms_auth_start,
            auth::ms_auth_poll,
            auth::ms_auth_refresh,
            auth::get_mc_access_token,
            auth::remove_account,
        ])
        // ... existing setup
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3A.4: Azure app registration

**Manual step** (documented in implementation guide):

1. Go to Azure Portal → App Registrations → New Registration
2. Name: "MC Server Manager Launcher"
3. Supported account types: "Personal Microsoft accounts only"
4. Redirect URI: Leave blank (device code flow doesn't need it)
5. After creation, copy the **Application (client) ID** → use as `MS_CLIENT_ID`
6. No client secret needed for device code flow
7. **Note**: Mojang approval may be required for production use. For development/personal use, this works without approval.

**Files created**: `packages/desktop/src-tauri/src/auth.rs`
**Files modified**: `packages/desktop/src-tauri/src/lib.rs`, `packages/desktop/src-tauri/Cargo.toml`

---

## Phase 3B: Version Manifest & Asset Management

### 3B.1: Version service (backend)

**New file**: `packages/backend/src/services/version-service.ts`

```typescript
import { MinecraftVersion, VersionManifest } from '@mc-server-manager/shared';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const CACHE_TTL = 3600 * 1000; // 1 hour

export class VersionService {
  private manifestCache: { data: VersionManifest; timestamp: number } | null = null;
  private versionsDir: string;

  constructor(private dataDir: string) {
    this.versionsDir = join(dataDir, 'launcher', 'versions');
    mkdirSync(this.versionsDir, { recursive: true });
  }

  /** Fetch and cache the version manifest */
  async getManifest(): Promise<VersionManifest> {
    const now = Date.now();
    if (this.manifestCache && now - this.manifestCache.timestamp < CACHE_TTL) {
      return this.manifestCache.data;
    }

    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`Failed to fetch version manifest: ${res.statusText}`);

    const manifest: VersionManifest = await res.json();
    this.manifestCache = { data: manifest, timestamp: now };

    return manifest;
  }

  /** Get all versions, optionally filtered by type */
  async getVersions(type?: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'): Promise<MinecraftVersion[]> {
    const manifest = await this.getManifest();
    if (!type) return manifest.versions;
    return manifest.versions.filter(v => v.type === type);
  }

  /** Download a version JSON if not already cached */
  async downloadVersionJson(versionId: string): Promise<any> {
    const versionDir = join(this.versionsDir, versionId);
    const jsonPath = join(versionDir, `${versionId}.json`);

    if (existsSync(jsonPath)) {
      return JSON.parse(readFileSync(jsonPath, 'utf-8'));
    }

    const manifest = await this.getManifest();
    const version = manifest.versions.find(v => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    mkdirSync(versionDir, { recursive: true });

    const res = await fetch(version.url);
    if (!res.ok) throw new Error(`Failed to download version JSON: ${res.statusText}`);

    const versionJson = await res.json();

    // Verify hash
    const jsonStr = JSON.stringify(versionJson);
    const hash = createHash('sha1').update(jsonStr).digest('hex');
    if (hash !== version.sha1) {
      throw new Error(`Version JSON hash mismatch for ${versionId}`);
    }

    // Save to disk
    await fs.promises.writeFile(jsonPath, jsonStr);

    return versionJson;
  }

  /** Download the game JAR */
  async downloadGameJar(versionId: string): Promise<string> {
    const versionJson = await this.downloadVersionJson(versionId);
    const versionDir = join(this.versionsDir, versionId);
    const jarPath = join(versionDir, `${versionId}.jar`);

    if (existsSync(jarPath)) {
      return jarPath;
    }

    const download = versionJson.downloads.client;
    if (!download) throw new Error(`No client download for ${versionId}`);

    const res = await fetch(download.url);
    if (!res.ok) throw new Error(`Failed to download game JAR: ${res.statusText}`);

    await pipeline(res.body!, createWriteStream(jarPath));

    // Verify hash
    const jarData = readFileSync(jarPath);
    const hash = createHash('sha1').update(jarData).digest('hex');
    if (hash !== download.sha1) {
      throw new Error(`Game JAR hash mismatch for ${versionId}`);
    }

    return jarPath;
  }
}
```

### 3B.2: Asset service

**New file**: `packages/backend/src/services/asset-service.ts`

```typescript
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

export class AssetService {
  private assetsDir: string;
  private indexesDir: string;
  private objectsDir: string;

  constructor(private dataDir: string) {
    this.assetsDir = join(dataDir, 'launcher', 'assets');
    this.indexesDir = join(this.assetsDir, 'indexes');
    this.objectsDir = join(this.assetsDir, 'objects');
    mkdirSync(this.indexesDir, { recursive: true });
    mkdirSync(this.objectsDir, { recursive: true });
  }

  /** Download asset index JSON */
  async downloadAssetIndex(versionJson: any): Promise<any> {
    const assetIndex = versionJson.assetIndex;
    const indexPath = join(this.indexesDir, `${assetIndex.id}.json`);

    if (existsSync(indexPath)) {
      return JSON.parse(readFileSync(indexPath, 'utf-8'));
    }

    const res = await fetch(assetIndex.url);
    if (!res.ok) throw new Error(`Failed to download asset index: ${res.statusText}`);

    const indexJson = await res.json();
    const indexStr = JSON.stringify(indexJson);

    // Verify hash
    const hash = createHash('sha1').update(indexStr).digest('hex');
    if (hash !== assetIndex.sha1) {
      throw new Error(`Asset index hash mismatch`);
    }

    await fs.promises.writeFile(indexPath, indexStr);

    return indexJson;
  }

  /** Download all assets for a version */
  async downloadAssets(versionJson: any, onProgress?: (current: number, total: number) => void): Promise<void> {
    const indexJson = await this.downloadAssetIndex(versionJson);
    const objects = Object.values(indexJson.objects) as Array<{ hash: string; size: number }>;

    let completed = 0;
    const total = objects.length;

    // Download in parallel (limit concurrency to 10)
    const concurrency = 10;
    const chunks = [];
    for (let i = 0; i < objects.length; i += concurrency) {
      chunks.push(objects.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async obj => {
          await this.downloadAsset(obj.hash);
          completed++;
          onProgress?.(completed, total);
        })
      );
    }
  }

  private async downloadAsset(hash: string): Promise<void> {
    const subdir = hash.substring(0, 2);
    const objectDir = join(this.objectsDir, subdir);
    const objectPath = join(objectDir, hash);

    if (existsSync(objectPath)) {
      return; // Already downloaded
    }

    mkdirSync(objectDir, { recursive: true });

    const url = `https://resources.download.minecraft.net/${subdir}/${hash}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download asset ${hash}: ${res.statusText}`);

    await pipeline(res.body!, createWriteStream(objectPath));

    // Verify hash
    const data = readFileSync(objectPath);
    const actualHash = createHash('sha1').update(data).digest('hex');
    if (actualHash !== hash) {
      throw new Error(`Asset hash mismatch: ${hash}`);
    }
  }
}
```

### 3B.3: Library service

**New file**: `packages/backend/src/services/library-service.ts`

```typescript
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import os from 'os';

export class LibraryService {
  private librariesDir: string;

  constructor(private dataDir: string) {
    this.librariesDir = join(dataDir, 'launcher', 'libraries');
    mkdirSync(this.librariesDir, { recursive: true });
  }

  /** Download all libraries for a version */
  async downloadLibraries(
    versionJson: any,
    onProgress?: (current: number, total: number) => void
  ): Promise<string[]> {
    const libraries = this.filterLibrariesForPlatform(versionJson.libraries);
    const classpathLibs: string[] = [];

    let completed = 0;
    const total = libraries.length;

    for (const lib of libraries) {
      const libPath = await this.downloadLibrary(lib);
      if (libPath && !lib.natives) {
        classpathLibs.push(libPath);
      }
      completed++;
      onProgress?.(completed, total);
    }

    return classpathLibs;
  }

  /** Extract native libraries for the current platform */
  async extractNatives(versionJson: any, nativesDir: string): Promise<void> {
    const libraries = this.filterLibrariesForPlatform(versionJson.libraries);
    const nativeLibs = libraries.filter(lib => lib.natives);

    mkdirSync(nativesDir, { recursive: true });

    for (const lib of nativeLibs) {
      const libPath = await this.downloadLibrary(lib);
      if (libPath) {
        // Extract JAR to nativesDir (use a ZIP library like adm-zip)
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(libPath);
        zip.extractAllTo(nativesDir, true);
      }
    }
  }

  private filterLibrariesForPlatform(libraries: any[]): any[] {
    const platform = this.getCurrentPlatform();

    return libraries.filter(lib => {
      if (!lib.rules) return true;

      let allowed = false;
      for (const rule of lib.rules) {
        if (rule.action === 'allow') {
          if (!rule.os || this.matchesOS(rule.os, platform)) {
            allowed = true;
          }
        } else if (rule.action === 'disallow') {
          if (!rule.os || this.matchesOS(rule.os, platform)) {
            allowed = false;
          }
        }
      }

      return allowed;
    });
  }

  private async downloadLibrary(lib: any): Promise<string | null> {
    const artifact = lib.downloads?.artifact;
    if (!artifact) return null;

    const libPath = join(this.librariesDir, artifact.path);

    if (existsSync(libPath)) {
      return libPath;
    }

    const libDir = join(libPath, '..');
    mkdirSync(libDir, { recursive: true });

    const res = await fetch(artifact.url);
    if (!res.ok) {
      console.warn(`Failed to download library ${artifact.path}: ${res.statusText}`);
      return null;
    }

    await pipeline(res.body!, createWriteStream(libPath));

    // Verify hash
    const data = readFileSync(libPath);
    const hash = createHash('sha1').update(data).digest('hex');
    if (hash !== artifact.sha1) {
      throw new Error(`Library hash mismatch: ${artifact.path}`);
    }

    return libPath;
  }

  private getCurrentPlatform(): string {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'osx';
    return 'linux';
  }

  private matchesOS(osRule: any, platform: string): boolean {
    if (osRule.name && osRule.name !== platform) return false;
    // Additional checks for osRule.version, osRule.arch can be added here
    return true;
  }
}
```

**Files created**: `packages/backend/src/services/version-service.ts`, `packages/backend/src/services/asset-service.ts`, `packages/backend/src/services/library-service.ts`

---

## Phase 3C: Java Version Management (Rust Core)

### 3C.1: Java manager module

**New file**: `packages/desktop/src-tauri/src/java.rs`

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    pub version: u32,
    pub path: String,
    pub vendor: String,
    pub full_version: String,
}

/// Detect installed Java installations
#[tauri::command]
pub async fn get_java_installations() -> Result<Vec<JavaInstallation>, String> {
    let mut installations = Vec::new();

    // Check common installation paths
    let search_paths = get_java_search_paths();

    for path in search_paths {
        if let Ok(installation) = detect_java_at_path(&path) {
            installations.push(installation);
        }
    }

    // Also check JAVA_HOME
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java_path = PathBuf::from(java_home).join("bin").join("java");
        if let Ok(installation) = detect_java_at_path(&java_path.to_string_lossy()) {
            installations.push(installation);
        }
    }

    // Deduplicate by path
    installations.sort_by(|a, b| a.path.cmp(&b.path));
    installations.dedup_by(|a, b| a.path == b.path);

    Ok(installations)
}

fn get_java_search_paths() -> Vec<String> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        paths.push(r"C:\Program Files\Java".to_string());
        paths.push(r"C:\Program Files\Eclipse Adoptium".to_string());
        paths.push(r"C:\Program Files\Microsoft\jdk".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        paths.push("/Library/Java/JavaVirtualMachines".to_string());
        paths.push("/usr/libexec/java_home".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        paths.push("/usr/lib/jvm".to_string());
        paths.push("/usr/java".to_string());
    }

    paths
}

fn detect_java_at_path(path: &str) -> Result<JavaInstallation, String> {
    let output = Command::new(path)
        .arg("-version")
        .output()
        .map_err(|e| e.to_string())?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Parse version from output like: openjdk version "17.0.9" 2023-10-17
    let version_line = stderr.lines().next().ok_or("No version output")?;
    
    let full_version = version_line
        .split('"')
        .nth(1)
        .ok_or("Could not parse version")?
        .to_string();

    let major_version = full_version
        .split('.')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    let vendor = if stderr.contains("Eclipse Adoptium") {
        "Eclipse Adoptium"
    } else if stderr.contains("Oracle") {
        "Oracle"
    } else if stderr.contains("Microsoft") {
        "Microsoft"
    } else {
        "Unknown"
    }
    .to_string();

    Ok(JavaInstallation {
        version: major_version,
        path: path.to_string(),
        vendor,
        full_version,
    })
}

/// Download Java from Adoptium API
#[tauri::command]
pub async fn download_java(
    app: tauri::AppHandle,
    version: u32,
) -> Result<JavaInstallation, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let runtime_dir = data_dir.join("launcher").join("runtime").join(format!("java-{}", version));
    std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;

    // Determine platform and architecture
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let adoptium_os = match os {
        "windows" => "windows",
        "macos" => "mac",
        "linux" => "linux",
        _ => return Err(format!("Unsupported OS: {}", os)),
    };

    let adoptium_arch = match arch {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        _ => return Err(format!("Unsupported architecture: {}", arch)),
    };

    // Fetch latest release from Adoptium API
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse",
        version, adoptium_os, adoptium_arch
    );

    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !res.ok() {
        return Err(format!("Failed to download Java {}: {}", version, res.status()));
    }

    // Download and extract (implementation depends on archive format: .zip for Windows, .tar.gz for Unix)
    // This is a simplified placeholder — full implementation would handle extraction
    
    let java_path = runtime_dir.join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });

    Ok(JavaInstallation {
        version,
        path: java_path.to_string_lossy().to_string(),
        vendor: "Eclipse Adoptium".to_string(),
        full_version: format!("{}.0.0", version),
    })
}
```

### 3C.2: Register Java commands

Modify `packages/desktop/src-tauri/src/lib.rs`:

```rust
mod java;

.invoke_handler(tauri::generate_handler![
    // ... existing auth commands
    java::get_java_installations,
    java::download_java,
])
```

**Files created**: `packages/desktop/src-tauri/src/java.rs`
**Files modified**: `packages/desktop/src-tauri/src/lib.rs`

---

## Phase 3D: Instance Management (Backend)

### 3D.1: Instance model

**New file**: `packages/backend/src/models/instance.ts`

```typescript
import { LauncherInstance } from '@mc-server-manager/shared';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export class InstanceModel {
  constructor(private db: Database.Database) {}

  getAll(): LauncherInstance[] {
    const rows = this.db.prepare('SELECT * FROM launcher_instances ORDER BY last_played DESC').all();
    return rows.map(this.mapRow);
  }

  getById(id: string): LauncherInstance | null {
    const row = this.db.prepare('SELECT * FROM launcher_instances WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  create(data: Omit<LauncherInstance, 'id' | 'createdAt' | 'updatedAt'>): LauncherInstance {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO launcher_instances (
          id, name, mc_version, version_type, loader, loader_version,
          java_version, java_path, ram_min, ram_max, resolution_width, resolution_height,
          jvm_args, game_args, icon, last_played, total_playtime, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        data.mcVersion,
        data.versionType,
        data.loader,
        data.loaderVersion,
        data.javaVersion,
        data.javaPath,
        data.ramMin,
        data.ramMax,
        data.resolutionWidth,
        data.resolutionHeight,
        JSON.stringify(data.jvmArgs),
        JSON.stringify(data.gameArgs),
        data.icon,
        data.lastPlayed,
        data.totalPlaytime,
        now,
        now
      );

    return this.getById(id)!;
  }

  update(id: string, updates: Partial<LauncherInstance>): LauncherInstance {
    const now = new Date().toISOString();
    const fields = Object.keys(updates)
      .filter(k => k !== 'id' && k !== 'createdAt')
      .map(k => `${this.toSnakeCase(k)} = ?`);

    const values = Object.entries(updates)
      .filter(([k]) => k !== 'id' && k !== 'createdAt')
      .map(([k, v]) => {
        if (k === 'jvmArgs' || k === 'gameArgs') return JSON.stringify(v);
        return v;
      });

    this.db
      .prepare(`UPDATE launcher_instances SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values, now, id);

    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM launcher_instances WHERE id = ?').run(id);
  }

  private mapRow(row: any): LauncherInstance {
    return {
      id: row.id,
      name: row.name,
      mcVersion: row.mc_version,
      versionType: row.version_type,
      loader: row.loader,
      loaderVersion: row.loader_version,
      javaVersion: row.java_version,
      javaPath: row.java_path,
      ramMin: row.ram_min,
      ramMax: row.ram_max,
      resolutionWidth: row.resolution_width,
      resolutionHeight: row.resolution_height,
      jvmArgs: JSON.parse(row.jvm_args || '[]'),
      gameArgs: JSON.parse(row.game_args || '[]'),
      icon: row.icon,
      lastPlayed: row.last_played,
      totalPlaytime: row.total_playtime,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
```

### 3D.2: Instance service

**New file**: `packages/backend/src/services/instance-service.ts`

```typescript
import { CreateInstanceRequest, LauncherInstance, UpdateInstanceRequest } from '@mc-server-manager/shared';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { InstanceModel } from '../models/instance.js';
import { VersionService } from './version-service.js';

export class InstanceService {
  constructor(
    private instanceModel: InstanceModel,
    private versionService: VersionService,
    private dataDir: string
  ) {}

  async listInstances(): Promise<LauncherInstance[]> {
    return this.instanceModel.getAll();
  }

  async getInstanceById(id: string): Promise<LauncherInstance> {
    const instance = this.instanceModel.getById(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    return instance;
  }

  async createInstance(request: CreateInstanceRequest): Promise<LauncherInstance> {
    // Fetch version JSON to determine required Java version
    const versionJson = await this.versionService.downloadVersionJson(request.mcVersion);
    const javaVersion = versionJson.javaVersion?.majorVersion || this.inferJavaVersion(request.mcVersion);

    const instance = this.instanceModel.create({
      name: request.name,
      mcVersion: request.mcVersion,
      versionType: request.versionType || 'release',
      loader: request.loader || null,
      loaderVersion: request.loaderVersion || null,
      javaVersion,
      javaPath: null, // Auto-detect at launch
      ramMin: request.ramMin || 2,
      ramMax: request.ramMax || 4,
      resolutionWidth: null,
      resolutionHeight: null,
      jvmArgs: [],
      gameArgs: [],
      icon: null,
      lastPlayed: null,
      totalPlaytime: 0,
    });

    // Create instance directory
    const instanceDir = join(this.dataDir, 'launcher', 'instances', instance.id);
    mkdirSync(instanceDir, { recursive: true });
    mkdirSync(join(instanceDir, 'saves'), { recursive: true });
    mkdirSync(join(instanceDir, 'resourcepacks'), { recursive: true });
    mkdirSync(join(instanceDir, 'mods'), { recursive: true });
    mkdirSync(join(instanceDir, 'shaderpacks'), { recursive: true });

    return instance;
  }

  async updateInstance(id: string, updates: UpdateInstanceRequest): Promise<LauncherInstance> {
    return this.instanceModel.update(id, updates);
  }

  async deleteInstance(id: string): Promise<void> {
    // Delete instance directory
    const instanceDir = join(this.dataDir, 'launcher', 'instances', id);
    await fs.promises.rm(instanceDir, { recursive: true, force: true });

    this.instanceModel.delete(id);
  }

  private inferJavaVersion(mcVersion: string): number {
    const [major, minor] = mcVersion.split('.').map(Number);

    if (major === 1 && minor <= 16) return 8;
    if (major === 1 && minor === 17) return 16;
    if (major === 1 && minor >= 18 && minor <= 20) return 17;
    return 21; // 1.20.5+
  }
}
```

### 3D.3: Instance routes

**New file**: `packages/backend/src/routes/launcher.ts`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { InstanceService } from '../services/instance-service.js';
import { VersionService } from '../services/version-service.js';

const router = Router();

const createInstanceSchema = z.object({
  name: z.string().min(1).max(100),
  mcVersion: z.string(),
  versionType: z.enum(['release', 'snapshot', 'old_beta', 'old_alpha']).optional(),
  loader: z.enum(['fabric', 'forge', 'neoforge', 'quilt']).optional(),
  loaderVersion: z.string().optional(),
  ramMin: z.number().int().min(1).max(64).optional(),
  ramMax: z.number().int().min(1).max(64).optional(),
});

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ramMin: z.number().int().min(1).max(64).optional(),
  ramMax: z.number().int().min(1).max(64).optional(),
  resolutionWidth: z.number().int().positive().nullable().optional(),
  resolutionHeight: z.number().int().positive().nullable().optional(),
  jvmArgs: z.array(z.string()).optional(),
  gameArgs: z.array(z.string()).optional(),
  icon: z.string().nullable().optional(),
});

router.get('/instances', async (req, res, next) => {
  try {
    const instances = await req.app.locals.instanceService.listInstances();
    res.json(instances);
  } catch (err) {
    next(err);
  }
});

router.get('/instances/:id', async (req, res, next) => {
  try {
    const instance = await req.app.locals.instanceService.getInstanceById(req.params.id);
    res.json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/instances', async (req, res, next) => {
  try {
    const data = createInstanceSchema.parse(req.body);
    const instance = await req.app.locals.instanceService.createInstance(data);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.patch('/instances/:id', async (req, res, next) => {
  try {
    const updates = updateInstanceSchema.parse(req.body);
    const instance = await req.app.locals.instanceService.updateInstance(req.params.id, updates);
    res.json(instance);
  } catch (err) {
    next(err);
  }
});

router.delete('/instances/:id', async (req, res, next) => {
  try {
    await req.app.locals.instanceService.deleteInstance(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/versions', async (req, res, next) => {
  try {
    const type = req.query.type as 'release' | 'snapshot' | undefined;
    const versions = await req.app.locals.versionService.getVersions(type);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

export default router;
```

**Files created**: `packages/backend/src/models/instance.ts`, `packages/backend/src/services/instance-service.ts`, `packages/backend/src/routes/launcher.ts`
**Files modified**: `packages/backend/src/app.ts` (mount launcher routes), `packages/backend/migrations/` (new migration files)

---

## Phase 3E: Game Launching (Rust Core)

### 3E.1: Game launcher module

**New file**: `packages/desktop/src-tauri/src/launcher.rs`

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command};
use tauri::State;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameProcess {
    pub instance_id: String,
    pub pid: u32,
    pub started_at: String,
}

pub struct LauncherState {
    pub running_games: Mutex<Vec<GameProcess>>,
}

impl LauncherState {
    pub fn new() -> Self {
        Self {
            running_games: Mutex::new(Vec::new()),
        }
    }
}

#[tauri::command]
pub async fn launch_game(
    app: tauri::AppHandle,
    state: State<'_, LauncherState>,
    instance_id: String,
    account_id: String,
) -> Result<GameProcess, String> {
    // 1. Fetch instance details from backend
    let instance = fetch_instance(&instance_id).await?;

    // 2. Get Minecraft access token from keychain
    let mc_token = crate::auth::get_mc_access_token(app.clone(), account_id.clone()).await?;

    // 3. Get account details from backend
    let account = fetch_account(&account_id).await?;

    // 4. Resolve Java path
    let java_path = resolve_java_path(&instance).await?;

    // 5. Fetch version JSON from backend
    let version_json = fetch_version_json(&instance.mc_version).await?;

    // 6. Build classpath
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let classpath = build_classpath(&data_dir, &version_json)?;

    // 7. Extract natives
    let natives_dir = extract_natives(&data_dir, &instance_id, &version_json).await?;

    // 8. Build JVM arguments
    let jvm_args = build_jvm_args(&instance, &natives_dir, &classpath);

    // 9. Build game arguments
    let game_args = build_game_args(&instance, &account, &mc_token, &data_dir, &version_json);

    // 10. Construct command
    let mut cmd = Command::new(&java_path);
    cmd.args(&jvm_args);
    cmd.arg(&version_json.main_class);
    cmd.args(&game_args);

    // 11. Set working directory to instance directory
    let instance_dir = data_dir.join("launcher").join("instances").join(&instance_id);
    cmd.current_dir(&instance_dir);

    // 12. Spawn process
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    let process = GameProcess {
        instance_id: instance_id.clone(),
        pid,
        started_at: chrono::Utc::now().to_rfc3339(),
    };

    state.running_games.lock().unwrap().push(process.clone());

    // Monitor process in background
    tokio::spawn(async move {
        let _ = child.wait_with_output();
        // Remove from running_games when process exits
    });

    Ok(process)
}

fn build_jvm_args(instance: &Instance, natives_dir: &PathBuf, classpath: &str) -> Vec<String> {
    let mut args = vec![
        format!("-Xms{}G", instance.ram_min),
        format!("-Xmx{}G", instance.ram_max),
        format!("-Djava.library.path={}", natives_dir.display()),
        "-Dminecraft.launcher.brand=MCServerManager".to_string(),
        "-Dminecraft.launcher.version=1.0".to_string(),
    ];

    // Add custom JVM args
    args.extend(instance.jvm_args.clone());

    // Add classpath
    args.push("-cp".to_string());
    args.push(classpath.to_string());

    args
}

fn build_game_args(
    instance: &Instance,
    account: &Account,
    mc_token: &str,
    data_dir: &PathBuf,
    version_json: &VersionJson,
) -> Vec<String> {
    let instance_dir = data_dir.join("launcher").join("instances").join(&instance.id);
    let assets_dir = data_dir.join("launcher").join("assets");

    let mut args = vec![
        "--username".to_string(),
        account.username.clone(),
        "--version".to_string(),
        instance.mc_version.clone(),
        "--gameDir".to_string(),
        instance_dir.to_string_lossy().to_string(),
        "--assetsDir".to_string(),
        assets_dir.to_string_lossy().to_string(),
        "--assetIndex".to_string(),
        version_json.asset_index.id.clone(),
        "--uuid".to_string(),
        account.uuid.clone(),
        "--accessToken".to_string(),
        mc_token.to_string(),
        "--userType".to_string(),
        "msa".to_string(),
        "--versionType".to_string(),
        instance.version_type.clone(),
    ];

    // Add resolution if specified
    if let (Some(width), Some(height)) = (instance.resolution_width, instance.resolution_height) {
        args.push("--width".to_string());
        args.push(width.to_string());
        args.push("--height".to_string());
        args.push(height.to_string());
    }

    // Add custom game args
    args.extend(instance.game_args.clone());

    args
}

fn build_classpath(data_dir: &PathBuf, version_json: &VersionJson) -> Result<String, String> {
    let mut classpath_entries = Vec::new();

    // Add all library JARs
    let libraries_dir = data_dir.join("launcher").join("libraries");
    for lib in &version_json.libraries {
        if let Some(artifact) = &lib.downloads.artifact {
            let lib_path = libraries_dir.join(&artifact.path);
            classpath_entries.push(lib_path.to_string_lossy().to_string());
        }
    }

    // Add game JAR
    let game_jar = data_dir
        .join("launcher")
        .join("versions")
        .join(&version_json.id)
        .join(format!("{}.jar", version_json.id));
    classpath_entries.push(game_jar.to_string_lossy().to_string());

    let separator = if cfg!(windows) { ";" } else { ":" };
    Ok(classpath_entries.join(separator))
}

async fn extract_natives(
    data_dir: &PathBuf,
    instance_id: &str,
    version_json: &VersionJson,
) -> Result<PathBuf, String> {
    let natives_dir = data_dir
        .join("launcher")
        .join("natives")
        .join(format!("{}-{}", instance_id, chrono::Utc::now().timestamp()));

    std::fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;

    // Extract native libraries (implementation uses zip extraction)
    // This is a placeholder — full implementation would extract .so/.dll/.dylib files

    Ok(natives_dir)
}

// Helper functions to fetch data from backend
async fn fetch_instance(id: &str) -> Result<Instance, String> {
    // HTTP request to backend /api/launcher/instances/:id
    todo!()
}

async fn fetch_account(id: &str) -> Result<Account, String> {
    // HTTP request to backend /api/launcher/accounts/:id
    todo!()
}

async fn fetch_version_json(version: &str) -> Result<VersionJson, String> {
    // HTTP request to backend /api/launcher/versions/:version/json
    todo!()
}

async fn resolve_java_path(instance: &Instance) -> Result<String, String> {
    if let Some(path) = &instance.java_path {
        return Ok(path.clone());
    }

    // Auto-detect Java for the required version
    let installations = crate::java::get_java_installations().await?;
    let matching = installations
        .iter()
        .find(|j| j.version == instance.java_version as u32);

    if let Some(java) = matching {
        Ok(java.path.clone())
    } else {
        Err(format!(
            "Java {} not found. Please install it or specify a custom path.",
            instance.java_version
        ))
    }
}

// Placeholder structs (these would be imported from shared types)
#[derive(Debug, Clone, Deserialize)]
struct Instance {
    id: String,
    mc_version: String,
    version_type: String,
    java_version: i32,
    java_path: Option<String>,
    ram_min: i32,
    ram_max: i32,
    resolution_width: Option<i32>,
    resolution_height: Option<i32>,
    jvm_args: Vec<String>,
    game_args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Account {
    uuid: String,
    username: String,
}

#[derive(Debug, Clone, Deserialize)]
struct VersionJson {
    id: String,
    main_class: String,
    asset_index: AssetIndex,
    libraries: Vec<Library>,
}

#[derive(Debug, Clone, Deserialize)]
struct AssetIndex {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Library {
    downloads: LibraryDownloads,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryDownloads {
    artifact: Option<Artifact>,
}

#[derive(Debug, Clone, Deserialize)]
struct Artifact {
    path: String,
}
```

### 3E.2: Register launcher commands

Modify `packages/desktop/src-tauri/src/lib.rs`:

```rust
mod launcher;

use launcher::LauncherState;

.manage(LauncherState::new())
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    launcher::launch_game,
])
```

**Files created**: `packages/desktop/src-tauri/src/launcher.rs`
**Files modified**: `packages/desktop/src-tauri/src/lib.rs`

---

## Phase 3F: Frontend — Launcher UI

### 3F.1: Launcher page structure

**New page**: `packages/frontend/src/pages/Launcher.tsx`

```tsx
import { useState } from 'react';
import { InstanceList } from '../components/launcher/InstanceList';
import { CreateInstanceDialog } from '../components/launcher/CreateInstanceDialog';
import { AccountManager } from '../components/launcher/AccountManager';

export function Launcher() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAccountManager, setShowAccountManager] = useState(false);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-gray-700 p-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Minecraft Launcher</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAccountManager(true)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Accounts
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            New Instance
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <InstanceList />
      </main>

      {showCreateDialog && (
        <CreateInstanceDialog onClose={() => setShowCreateDialog(false)} />
      )}

      {showAccountManager && (
        <AccountManager onClose={() => setShowAccountManager(false)} />
      )}
    </div>
  );
}
```

### 3F.2: Key components

| Component | Purpose |
|-----------|---------|
| `InstanceList.tsx` | Grid of instance cards with play button, edit, delete |
| `InstanceCard.tsx` | Individual instance card (icon, name, version, last played) |
| `CreateInstanceDialog.tsx` | Modal for creating new instance (name, version picker, loader) |
| `EditInstanceDialog.tsx` | Modal for editing instance settings (RAM, resolution, JVM args) |
| `AccountManager.tsx` | List of Microsoft accounts, add/remove |
| `MSAuthFlow.tsx` | Device code flow UI (show code, verification link, polling) |
| `VersionPicker.tsx` | Dropdown/list for selecting MC version (releases, snapshots) |
| `JavaManager.tsx` | Detect/download Java installations |

### 3F.3: Zustand store

**New file**: `packages/frontend/src/stores/launcherStore.ts`

```typescript
import { create } from 'zustand';
import { LauncherInstance, LauncherAccount, MinecraftVersion } from '@mc-server-manager/shared';
import { invoke } from '@tauri-apps/api/core';

interface LauncherState {
  instances: LauncherInstance[];
  accounts: LauncherAccount[];
  versions: MinecraftVersion[];
  selectedAccount: LauncherAccount | null;

  fetchInstances: () => Promise<void>;
  fetchAccounts: () => Promise<void>;
  fetchVersions: () => Promise<void>;
  createInstance: (data: CreateInstanceRequest) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  launchGame: (instanceId: string) => Promise<void>;
  startMSAuth: () => Promise<MSAuthDeviceCode>;
  pollMSAuth: () => Promise<MSAuthStatus>;
}

export const useLauncherStore = create<LauncherState>((set, get) => ({
  instances: [],
  accounts: [],
  versions: [],
  selectedAccount: null,

  fetchInstances: async () => {
    const res = await fetch('/api/launcher/instances');
    const instances = await res.json();
    set({ instances });
  },

  fetchAccounts: async () => {
    const res = await fetch('/api/launcher/accounts');
    const accounts = await res.json();
    set({ accounts, selectedAccount: accounts[0] || null });
  },

  fetchVersions: async () => {
    const res = await fetch('/api/launcher/versions');
    const versions = await res.json();
    set({ versions });
  },

  createInstance: async (data) => {
    const res = await fetch('/api/launcher/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const instance = await res.json();
    set(state => ({ instances: [...state.instances, instance] }));
  },

  deleteInstance: async (id) => {
    await fetch(`/api/launcher/instances/${id}`, { method: 'DELETE' });
    set(state => ({ instances: state.instances.filter(i => i.id !== id) }));
  },

  launchGame: async (instanceId) => {
    const { selectedAccount } = get();
    if (!selectedAccount) throw new Error('No account selected');

    await invoke('launch_game', {
      instanceId,
      accountId: selectedAccount.id,
    });
  },

  startMSAuth: async () => {
    return invoke('ms_auth_start');
  },

  pollMSAuth: async () => {
    return invoke('ms_auth_poll');
  },
}));
```

### 3F.4: MS Auth flow component

**New file**: `packages/frontend/src/components/launcher/MSAuthFlow.tsx`

```tsx
import { useState, useEffect } from 'react';
import { useLauncherStore } from '../../stores/launcherStore';

export function MSAuthFlow({ onComplete }: { onComplete: () => void }) {
  const [deviceCode, setDeviceCode] = useState<MSAuthDeviceCode | null>(null);
  const [status, setStatus] = useState<'idle' | 'polling' | 'complete' | 'error'>('idle');
  const { startMSAuth, pollMSAuth } = useLauncherStore();

  useEffect(() => {
    startAuth();
  }, []);

  async function startAuth() {
    const code = await startMSAuth();
    setDeviceCode(code);
    setStatus('polling');
    pollForToken(code.interval);
  }

  async function pollForToken(interval: number) {
    const poll = async () => {
      const result = await pollMSAuth();
      
      if (result.status === 'complete') {
        setStatus('complete');
        setTimeout(onComplete, 1000);
      } else if (result.status === 'expired' || result.status === 'error') {
        setStatus('error');
      } else {
        setTimeout(poll, interval * 1000);
      }
    };

    poll();
  }

  if (!deviceCode) return <div>Loading...</div>;

  return (
    <div className="p-6 text-center">
      <h2 className="text-xl font-bold mb-4">Sign in with Microsoft</h2>
      
      <div className="bg-gray-800 p-6 rounded-lg mb-4">
        <p className="mb-2">Go to:</p>
        <a
          href={deviceCode.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline text-lg"
        >
          {deviceCode.verificationUri}
        </a>
        
        <p className="mt-4 mb-2">Enter this code:</p>
        <div className="text-3xl font-mono font-bold tracking-wider">
          {deviceCode.userCode}
        </div>
      </div>

      {status === 'polling' && (
        <p className="text-gray-400">Waiting for you to sign in...</p>
      )}

      {status === 'complete' && (
        <p className="text-green-400">✓ Signed in successfully!</p>
      )}

      {status === 'error' && (
        <p className="text-red-400">Authentication failed. Please try again.</p>
      )}
    </div>
  );
}
```

**Files created**: `packages/frontend/src/pages/Launcher.tsx`, `packages/frontend/src/stores/launcherStore.ts`, `packages/frontend/src/components/launcher/` (8+ components)
**Files modified**: `packages/frontend/src/App.tsx` (add Launcher route)

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **3A** (MS auth) | ~8h | Device code flow, Xbox Live chain, keychain storage |
| 2 | **3B** (version/assets) | ~6h | Version manifest, asset/library downloading |
| 3 | **3C** (Java management) | ~4h | Detect installed JVMs, download from Adoptium |
| 4 | **3D** (instance CRUD) | ~5h | Instance model, service, routes, DB migration |
| 5 | **3E** (game launching) | ~7h | Command construction, process spawning, natives extraction |
| 6 | **3F** (frontend UI) | ~10h | Launcher page, instance cards, auth flow, version picker |

**Total: ~40 hours**

---

## Complete File Change Summary

### New Files (25+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/desktop/src-tauri/src/auth.rs` | 3A | Microsoft OAuth2 + Xbox Live + MC auth chain |
| `packages/desktop/src-tauri/src/java.rs` | 3C | Java detection and download |
| `packages/desktop/src-tauri/src/launcher.rs` | 3E | Game launching logic |
| `packages/backend/src/services/version-service.ts` | 3B | Version manifest management |
| `packages/backend/src/services/asset-service.ts` | 3B | Asset downloading |
| `packages/backend/src/services/library-service.ts` | 3B | Library downloading and natives extraction |
| `packages/backend/src/services/instance-service.ts` | 3D | Instance CRUD business logic |
| `packages/backend/src/models/instance.ts` | 3D | Instance DB model |
| `packages/backend/src/routes/launcher.ts` | 3D | Launcher REST routes |
| `packages/backend/migrations/00X_launcher_instances.sql` | 3D | Instances table |
| `packages/backend/migrations/00X_launcher_accounts.sql` | 3A | Accounts table |
| `packages/frontend/src/pages/Launcher.tsx` | 3F | Main launcher page |
| `packages/frontend/src/stores/launcherStore.ts` | 3F | Launcher Zustand store |
| `packages/frontend/src/components/launcher/InstanceList.tsx` | 3F | Instance grid |
| `packages/frontend/src/components/launcher/InstanceCard.tsx` | 3F | Instance card |
| `packages/frontend/src/components/launcher/CreateInstanceDialog.tsx` | 3F | Create instance modal |
| `packages/frontend/src/components/launcher/EditInstanceDialog.tsx` | 3F | Edit instance modal |
| `packages/frontend/src/components/launcher/AccountManager.tsx` | 3F | Account management UI |
| `packages/frontend/src/components/launcher/MSAuthFlow.tsx` | 3F | Device code flow UI |
| `packages/frontend/src/components/launcher/VersionPicker.tsx` | 3F | MC version selector |
| `packages/frontend/src/components/launcher/JavaManager.tsx` | 3F | Java installation UI |

### Modified Files (5)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 3A-3E | Launcher types (instances, accounts, versions, auth) |
| `packages/desktop/src-tauri/src/lib.rs` | 3A, 3C, 3E | Register auth, Java, launcher commands |
| `packages/desktop/src-tauri/Cargo.toml` | 3A | Add keychain, reqwest dependencies |
| `packages/backend/src/app.ts` | 3D | Mount launcher routes |
| `packages/frontend/src/App.tsx` | 3F | Add Launcher route |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Microsoft auth chain breaks (API changes) | Monitor Mojang/Microsoft developer forums. Implement retry logic with exponential backoff. Cache tokens aggressively. Provide clear error messages with links to troubleshooting docs. |
| Azure app registration requires Mojang approval for production | Document the approval process. For personal/development use, the app works without approval. For public distribution, apply for approval early (can take weeks). |
| Token refresh fails, user locked out | Implement graceful fallback: if refresh fails, prompt re-authentication. Never delete account data on auth failure. |
| Native library extraction fails on some platforms | Test on all 3 platforms. Provide detailed error logs. Fall back to manual extraction instructions if automated extraction fails. |

### Medium

| Risk | Mitigation |
|------|------------|
| Java version mismatch (user has wrong Java) | Auto-download correct Java version from Adoptium. Provide clear error message if download fails. Allow manual Java path override. |
| Asset/library download interrupted | Verify hashes after download. Resume partial downloads where possible. Retry failed downloads up to 3 times. |
| Classpath construction errors (platform-specific separators) | Use platform-aware separator (`;` on Windows, `:` on Unix). Test on all platforms. |
| Game crashes on launch | Capture stdout/stderr from game process. Show logs in UI. Provide troubleshooting guide (common issues: missing Java, corrupted files, incompatible mods). |

### Low

| Risk | Mitigation |
|------|------------|
| Disk space exhaustion (assets + libraries + instances) | Show disk usage in UI. Warn when space is low. Provide cleanup tools (delete unused instances, clear asset cache). |
| Version manifest changes format | Mojang's manifest format is stable. If it changes, update parser. Cache last known good manifest as fallback. |
| Keychain access denied on some systems | Graceful degradation: if keychain fails, store tokens in encrypted file (less secure but functional). Warn user. |

---

## Testing Checklist

1. **MS Auth**: Device code flow completes, tokens stored in keychain, profile fetched
2. **Account management**: Add account, switch accounts, remove account
3. **Token refresh**: Expired token auto-refreshes without user interaction
4. **Version list**: Fetch version manifest, filter by release/snapshot, display correctly
5. **Instance creation**: Create instance, directory structure created, DB record saved
6. **Java detection**: Detect installed Java versions, show in UI
7. **Java download**: Download Java 17 from Adoptium, extract, verify
8. **Asset download**: Download assets for 1.21.4, verify hashes, progress reporting
9. **Library download**: Download libraries, filter by platform, extract natives
10. **Game launch**: Launch vanilla 1.21.4, game window appears, logs visible
11. **Game launch (old version)**: Launch 1.8.9 with Java 8, works correctly
12. **Instance isolation**: Create 2 instances, saves/mods are separate
13. **RAM settings**: Set custom RAM, verify JVM args include correct -Xms/-Xmx
14. **Resolution settings**: Set custom resolution, game launches with correct window size
15. **Custom JVM args**: Add custom JVM arg, verify it appears in launch command
16. **Error handling**: Launch with no account selected → clear error message
17. **Error handling**: Launch with missing Java → prompt to download
18. **Cross-platform**: Build and test on Windows, macOS, Linux
