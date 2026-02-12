# Design Document -- Minecraft Client Launcher

## Overview

Add a full Minecraft client launcher to the desktop application. The launcher spans three layers: Tauri Rust core (authentication, Java management, game process spawning), Express backend (instance CRUD, version/asset/library downloads, SQLite storage), and React frontend (launcher UI). The architecture splits security-sensitive operations (auth tokens) to Rust, heavy file I/O to the backend, and presentation to the frontend.

## Steering Document Alignment

### Technical Standards (tech.md)
No steering docs exist. This design follows project conventions:
- TypeScript strict mode for all backend/frontend code
- Rust stable (edition 2021) for Tauri core modules
- ES modules, Zod validation on routes, Pino logging
- SQLite via better-sqlite3 for instance/account metadata

### Project Structure (structure.md)
New code follows the existing monorepo pattern:
- Backend services: `packages/backend/src/services/`
- Backend models: `packages/backend/src/models/`
- Backend routes: `packages/backend/src/routes/`
- Rust modules: `packages/desktop/src-tauri/src/`
- Frontend pages: `packages/frontend/src/pages/`
- Frontend components: `packages/frontend/src/components/launcher/`
- Shared types: `shared/src/index.ts`

## Code Reuse Analysis

### Existing Components to Leverage
- **`packages/backend/src/services/java.ts`**: Already detects Java installations. The Rust `java.rs` module provides the same capability natively for the Tauri context, but the backend service can still be used for server-side Java detection.
- **`packages/backend/src/services/versions.ts`**: Already fetches Mojang version manifest with caching for server JAR versions. The new `VersionService` extends this pattern for client versions.
- **`packages/backend/src/services/download.ts`**: Existing download service with progress tracking and SHA1 verification. Pattern reused for asset/library downloads.
- **`packages/backend/src/models/server.ts`**: Existing model pattern (prepared statements, snake_case mapping) reused for instance model.
- **`packages/frontend/src/pages/CreateServer.tsx`**: Multi-step wizard pattern reused for instance creation wizard.
- **`packages/backend/src/utils/errors.ts`**: Custom error classes (NotFoundError, etc.) reused in launcher routes.

### Integration Points
- **Tauri IPC**: Frontend calls Rust commands via `@tauri-apps/api/core` for auth (`ms_auth_start`, `ms_auth_poll`) and launching (`launch_game`). These are new integration points.
- **Express REST API**: Frontend calls backend for instance CRUD, version listing, download orchestration -- same HTTP pattern as existing server management.
- **SQLite**: New tables (`launcher_instances`, `launcher_accounts`) alongside existing `servers` and `settings` tables.
- **OS Keychain**: Rust core uses `tauri-plugin-keychain` for token storage -- completely new integration, no existing equivalent.

## Architecture

### Three-Layer Split

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React)                                        │
│  ├── LauncherPage         → Instance grid, play button   │
│  ├── CreateInstanceWizard → Version/loader/config steps  │
│  ├── AccountManager       → MS auth UI, account list     │
│  └── DownloadProgress     → File download progress       │
│       │                         │                        │
│       │ Tauri IPC               │ HTTP/REST              │
│       ▼                         ▼                        │
│  ┌─────────────┐   ┌──────────────────────────────┐     │
│  │ Rust Core   │   │ Express Backend               │     │
│  │ (Tauri)     │   │                               │     │
│  │ ┌─────────┐ │   │ ┌────────────────────────┐   │     │
│  │ │ auth.rs │ │   │ │ instance-service.ts    │   │     │
│  │ │ java.rs │ │   │ │ version-service.ts     │   │     │
│  │ │launcher │ │   │ │ asset-service.ts       │   │     │
│  │ │  .rs    │ │   │ │ library-service.ts     │   │     │
│  │ └─────────┘ │   │ └────────────────────────┘   │     │
│  │      │      │   │            │                  │     │
│  │  OS Keychain│   │        SQLite DB              │     │
│  └─────────────┘   └──────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

### Authentication Architecture

The MS authentication chain runs entirely in Rust for security. The frontend only receives non-sensitive data (device code, username, UUID).

```
Frontend                    Rust Core                    External APIs
   │                           │                              │
   ├─ invoke(ms_auth_start) ──►│                              │
   │                           ├─ POST /devicecode ──────────►│ Microsoft
   │◄── device_code, url ──────┤◄── device_code ─────────────┤
   │                           │                              │
   │  (user visits URL)        │                              │
   │                           │                              │
   ├─ invoke(ms_auth_poll) ───►│                              │
   │                           ├─ POST /token ───────────────►│ Microsoft
   │                           ├─ POST /user/authenticate ───►│ Xbox Live
   │                           ├─ POST /xsts/authorize ──────►│ XSTS
   │                           ├─ POST /login_with_xbox ─────►│ MC Services
   │                           ├─ GET /minecraft/profile ────►│ MC Services
   │                           ├─ keychain.set(tokens) ──────►│ OS Keychain
   │◄── account info ──────────┤                              │
```

### Game Launch Sequence

```
1. Frontend: invoke(launch_game, { instanceId, accountId })
2. Rust: Verify/refresh MC access token (keychain)
3. Rust: Call backend GET /api/launcher/instances/:id
4. Rust: Call backend POST /api/launcher/prepare/:id
   → Backend downloads: version JSON, game JAR, libraries, assets
   → Backend returns: classpath, mainClass, assetIndex, paths
5. Rust: Extract native libraries to temp dir
6. Rust: Build JVM args + game args
7. Rust: Spawn java process with full command line
8. Rust: Track process, monitor exit
9. Rust: On exit → call backend PATCH /api/launcher/instances/:id (update playtime)
```

### Directory Structure (Data)

```
{appDataDir}/
└── launcher/
    ├── instances/                  # Per-instance (isolated)
    │   └── {nanoid}/
    │       ├── saves/
    │       ├── mods/
    │       ├── resourcepacks/
    │       ├── shaderpacks/
    │       ├── options.txt
    │       └── servers.dat
    ├── versions/                   # Shared game JARs
    │   └── {version}/
    │       ├── {version}.json
    │       └── {version}.jar
    ├── libraries/                  # Shared libraries
    │   └── {group}/{artifact}/{ver}/{artifact}-{ver}.jar
    ├── assets/                     # Shared assets
    │   ├── indexes/{assetIndex}.json
    │   └── objects/{hash[:2]}/{hash}
    ├── runtime/                    # Downloaded JVMs
    │   └── java-{major}/
    └── natives/                    # Temp native extraction
        └── {instanceId}-{timestamp}/
```

### Modular Design Principles
- **Single File Responsibility**: Each Rust module (`auth.rs`, `java.rs`, `launcher.rs`) handles one concern. Each backend service (`version-service.ts`, `asset-service.ts`, `library-service.ts`, `instance-service.ts`) handles one domain.
- **Component Isolation**: Frontend launcher components are in their own `components/launcher/` directory, not mixed with server management components.
- **Service Layer Separation**: Backend services handle business logic and file I/O. Rust core handles OS-level operations (keychain, process spawn). Routes are thin HTTP adapters.
- **Utility Modularity**: Version inference (`mcVersion -> javaVersion`) is a pure function reusable across backend and Rust.

## Components and Interfaces

### Component 1: Auth Module (`packages/desktop/src-tauri/src/auth.rs`)
- **Purpose**: Microsoft OAuth2 device code flow, Xbox Live/XSTS auth chain, Minecraft token management, OS keychain storage
- **Interfaces**:
  - `ms_auth_start() -> DeviceCodeResponse` -- initiate device code flow
  - `ms_auth_poll() -> MSAuthStatus` -- poll for auth completion
  - `ms_auth_refresh(account_uuid) -> ()` -- refresh expired tokens
  - `get_mc_access_token(account_uuid) -> String` -- retrieve token from keychain
  - `remove_account(account_uuid) -> ()` -- delete tokens from keychain
- **Dependencies**: `reqwest`, `tauri-plugin-keychain`, `serde_json`
- **Reuses**: Pattern from `packages/electron/src/main.ts` (but auth was not implemented in Electron)

### Component 2: Java Manager (`packages/desktop/src-tauri/src/java.rs`)
- **Purpose**: Detect installed Java versions, download from Adoptium
- **Interfaces**:
  - `get_java_installations() -> Vec<JavaInstallation>` -- scan system for JVMs
  - `download_java(version: u32) -> JavaInstallation` -- download from Adoptium API
- **Dependencies**: `reqwest`, `std::process::Command`
- **Reuses**: Detection logic from `packages/backend/src/services/java.ts`

### Component 3: Game Launcher (`packages/desktop/src-tauri/src/launcher.rs`)
- **Purpose**: Construct and spawn Minecraft game process
- **Interfaces**:
  - `launch_game(instance_id, account_id) -> GameProcess` -- full launch sequence
  - `get_running_games() -> Vec<GameProcess>` -- list active processes
  - `kill_game(instance_id) -> ()` -- force-stop a running game
- **Dependencies**: `std::process::Command`, auth module, java module
- **Reuses**: Process spawning pattern from `packages/backend/src/services/process.ts` (but for Java game client instead of Java server)

### Component 4: Version Service (`packages/backend/src/services/version-service.ts`)
- **Purpose**: Fetch Mojang version manifest, download/cache version JSONs and client JARs
- **Interfaces**:
  - `getManifest() -> VersionManifest` -- cached manifest
  - `getVersions(type?) -> MinecraftVersion[]` -- filtered version list
  - `downloadVersionJson(versionId) -> VersionJson` -- download + verify
  - `downloadGameJar(versionId) -> string` -- download client JAR
- **Dependencies**: `fetch`, `crypto` (SHA1), `fs`
- **Reuses**: Caching pattern from existing `packages/backend/src/services/versions.ts`

### Component 5: Asset Service (`packages/backend/src/services/asset-service.ts`)
- **Purpose**: Download Minecraft assets (textures, sounds, etc.)
- **Interfaces**:
  - `downloadAssetIndex(versionJson) -> AssetIndex` -- download index JSON
  - `downloadAssets(versionJson, onProgress?) -> void` -- download all assets with progress
- **Dependencies**: `fetch`, `crypto`, `fs`
- **Reuses**: Download pattern from `packages/backend/src/services/download.ts`

### Component 6: Library Service (`packages/backend/src/services/library-service.ts`)
- **Purpose**: Download Java libraries, filter by platform rules, extract natives
- **Interfaces**:
  - `downloadLibraries(versionJson, onProgress?) -> string[]` -- download + return classpath
  - `extractNatives(versionJson, nativesDir) -> void` -- extract native libs
- **Dependencies**: `fetch`, `crypto`, `fs`, `adm-zip`
- **Reuses**: Platform detection from `os` module

### Component 7: Instance Service (`packages/backend/src/services/instance-service.ts`)
- **Purpose**: CRUD for game instances, directory management
- **Interfaces**:
  - `listInstances() -> LauncherInstance[]`
  - `createInstance(request) -> LauncherInstance`
  - `updateInstance(id, updates) -> LauncherInstance`
  - `deleteInstance(id) -> void`
- **Dependencies**: Instance model, Version service
- **Reuses**: Pattern from existing server CRUD service

### Component 8: Instance Model (`packages/backend/src/models/instance.ts`)
- **Purpose**: SQLite CRUD for `launcher_instances` table
- **Interfaces**: `getAll()`, `getById()`, `create()`, `update()`, `delete()`
- **Dependencies**: `better-sqlite3`, `nanoid`
- **Reuses**: Pattern from `packages/backend/src/models/server.ts`

## Data Models

### launcher_instances (SQLite)
```sql
CREATE TABLE launcher_instances (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  mc_version      TEXT NOT NULL,
  version_type    TEXT NOT NULL DEFAULT 'release',
  loader          TEXT,
  loader_version  TEXT,
  java_version    INTEGER NOT NULL,
  java_path       TEXT,
  ram_min         INTEGER NOT NULL DEFAULT 2,
  ram_max         INTEGER NOT NULL DEFAULT 4,
  resolution_width  INTEGER,
  resolution_height INTEGER,
  jvm_args        TEXT,          -- JSON array
  game_args       TEXT,          -- JSON array
  icon            TEXT,
  last_played     TEXT,
  total_playtime  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### launcher_accounts (SQLite -- metadata only, tokens in keychain)
```sql
CREATE TABLE launcher_accounts (
  id              TEXT PRIMARY KEY,
  uuid            TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL,
  account_type    TEXT NOT NULL DEFAULT 'msa',
  last_used       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Error Handling

### Error Scenarios

1. **Microsoft auth timeout / user cancels**
   - **Handling**: Device code expires after 15 minutes. Rust returns `MSAuthStatus { status: "expired" }`.
   - **User Impact**: "Authentication expired. Please try again." with retry button.

2. **User doesn't own Minecraft**
   - **Handling**: GET `/minecraft/profile` returns 404. Rust returns error status.
   - **User Impact**: "This Microsoft account does not own Minecraft Java Edition."

3. **Token refresh fails (revoked/expired refresh token)**
   - **Handling**: Rust deletes stale tokens, returns error. Frontend prompts re-authentication.
   - **User Impact**: "Session expired. Please sign in again."

4. **Asset/library download fails**
   - **Handling**: Retry once. If still fails, report specific failed files. Partial downloads are cleaned up.
   - **User Impact**: "Failed to download 3 files. [Retry] [Details]"

5. **Wrong Java version / Java not found**
   - **Handling**: Rust checks Java version before launch. If wrong or missing, returns error with required version.
   - **User Impact**: "Minecraft 1.21.4 requires Java 21. [Download Java 21] [Select Java Path]"

6. **Game crashes on launch**
   - **Handling**: Rust monitors process exit code. Non-zero exit logged. Playtime still updated.
   - **User Impact**: "Minecraft exited unexpectedly." with link to game logs.

7. **OS keychain unavailable**
   - **Handling**: Rust falls back to encrypted file in app data dir. Warning logged.
   - **User Impact**: Yellow banner: "Secure storage unavailable. Tokens stored with reduced security."

## File Structure

### New Files
```
packages/desktop/src-tauri/src/
├── auth.rs                        # MS OAuth2 + Xbox + MC auth chain
├── java.rs                        # Java detection + Adoptium download
└── launcher.rs                    # Game process construction + spawning

packages/backend/src/services/
├── version-service.ts             # Mojang manifest + version JSON/JAR
├── asset-service.ts               # Asset index + objects download
├── library-service.ts             # Library download + native extraction
└── instance-service.ts            # Instance CRUD + directory management

packages/backend/src/models/
└── instance.ts                    # launcher_instances SQLite model

packages/backend/src/routes/
└── launcher.ts                    # /api/launcher/* routes

packages/backend/migrations/
├── 00X_launcher_instances.sql
└── 00X_launcher_accounts.sql

packages/frontend/src/pages/
└── Launcher.tsx                   # Main launcher page

packages/frontend/src/components/launcher/
├── InstanceGrid.tsx               # Instance card grid
├── InstanceCard.tsx               # Single instance card
├── CreateInstanceWizard.tsx       # Multi-step instance creation
├── AccountManager.tsx             # MS auth + account list
├── DownloadProgress.tsx           # File download progress overlay
└── LaunchButton.tsx               # Play button with status states

shared/src/index.ts                # LauncherInstance, LauncherAccount, etc. types
```

### Modified Files
```
packages/desktop/src-tauri/src/lib.rs     # Register auth, java, launcher commands
packages/desktop/src-tauri/Cargo.toml     # Add reqwest, keychain plugin, chrono
packages/backend/src/app.ts               # Mount /api/launcher routes
shared/src/index.ts                       # Add launcher types
```

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual testing is the current approach.
- Auth chain can be tested by running the device code flow manually.
- Java detection can be tested by running on machines with different Java setups.
- Version/asset/library services can be tested by downloading a known version.

### Integration Testing
- **Auth flow**: Sign in with MS account -> verify account appears in list -> verify tokens in keychain
- **Instance lifecycle**: Create instance -> verify directory created -> update settings -> delete -> verify cleanup
- **Version downloads**: Create instance with 1.21.4 -> verify version JSON, JAR, libraries, assets downloaded -> verify hashes
- **Java management**: Detect installed Java -> download Java 21 from Adoptium -> verify installation

### End-to-End Testing
- **Full launch**: Sign in -> create instance (1.21.4 vanilla) -> click Play -> Minecraft launches -> play briefly -> quit -> verify playtime updated
- **Mod loader instance**: Create Fabric instance -> verify Fabric loader installed -> launch -> verify Fabric loads
- **Multi-account**: Sign in with two accounts -> switch between them -> launch with each
- **Missing Java**: Create instance requiring Java 21 (not installed) -> system offers download -> download -> launch succeeds
- **Offline resilience**: Launch previously-downloaded version without internet -> game starts (assets cached)
