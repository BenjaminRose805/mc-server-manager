# Design Document -- Electron Migration (Remove Rust/Tauri)

## Overview

Replace all Rust/Tauri functionality (~1,320 lines across 7 `.rs` files) with TypeScript in the existing Electron package and backend. The Tauri layer provides three native capabilities not yet in Electron: Microsoft OAuth authentication with OS keychain storage, Java detection/download, and Minecraft client launching. After migration, `packages/desktop/` is deleted and Electron becomes the sole desktop implementation.

The migration follows a "strangle fig" pattern: build the replacements alongside the existing code, rewire the frontend, verify parity, then remove the old code.

## Steering Document Alignment

No steering docs exist. This design follows the conventions established in AGENTS.md and the existing codebase.

### Technical Standards
- TypeScript strict mode, ES modules with `.js` extensions in backend imports
- Express services as singletons, Electron modules as separate files
- Zod for validation, Pino for logging, `better-sqlite3` for persistence
- `contextBridge` + `contextIsolation` for secure Electron IPC

### Project Structure
- Electron code in `packages/electron/src/` (existing pattern)
- Backend services in `packages/backend/src/services/` (existing pattern)
- Frontend utilities in `packages/frontend/src/utils/` (existing pattern)

## Code Reuse Analysis

### Existing Components to Leverage

- **`packages/electron/src/main.ts`**: Already handles window creation, backend lifecycle, tray setup, graceful shutdown. New IPC handlers register into this existing setup.
- **`packages/electron/src/preload.ts`**: Currently exposes `{ platform }`. Will be extended with auth, launcher, and Java APIs.
- **`packages/electron/src/tray.ts`**: System tray implementation — no changes needed.
- **`packages/backend/src/services/java.ts`**: Existing Java detection (`detectJava`, `probeJava`, `parseJavaVersion`, `getJavaMajorVersion`). Will be extended with multi-installation scanning and Adoptium download.
- **`packages/frontend/src/utils/tauri.ts`**: Contains `isTauri()`, `tauriInvoke()`, `getBackendBaseUrl()`. Will be replaced with `isElectron()` and `window.electronAPI.*` calls.
- **`packages/frontend/src/api/client.ts`**: Uses `getBackendBaseUrlSync()` for URL resolution — will switch to Electron-aware detection.

### Integration Points

- **Electron IPC** replaces Tauri `invoke()` — same request/response pattern, different transport
- **Backend REST API** unchanged — launcher routes (`/api/launcher/*`) stay as-is
- **Shared types** unchanged — `MSAuthDeviceCode`, `MSAuthStatus`, `LauncherAccount`, `JavaInstallation`, `GameProcess` already defined
- **SQLite database** — no schema changes needed

## Architecture

### Current Architecture (Dual Desktop)

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ Tauri App (Rust)            │    │ Electron App (TypeScript)    │
│  - MS Auth (keyring crate)  │    │  - Window management         │
│  - Java detect/download     │    │  - System tray               │
│  - Game launching           │    │  - Backend lifecycle          │
│  - System tray              │    │  - Preload (platform only)   │
│  - Window management        │    │                              │
│  - Backend sidecar          │    │                              │
└──────────┬──────────────────┘    └──────────┬──────────────────┘
           │ Tauri invoke()                   │ loadURL()
           ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React) — uses isTauri() + tauriInvoke()           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/WS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend (Express + WebSocket)                                │
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture (Electron Only)

```
┌─────────────────────────────────────────────┐
│ Electron App (TypeScript)                    │
│  ┌────────────────────────────────────────┐  │
│  │ Main Process                           │  │
│  │  - Window management (existing)        │  │
│  │  - System tray (existing)              │  │
│  │  - Backend lifecycle (existing)        │  │
│  │  - MS Auth + safeStorage (NEW)         │  │
│  │  - Game launcher (NEW)                 │  │
│  └──────────┬─────────────────────────────┘  │
│             │ contextBridge IPC              │
│  ┌──────────▼─────────────────────────────┐  │
│  │ Renderer (React SPA)                   │  │
│  │  - Uses window.electronAPI.*           │  │
│  │  - isElectron() detection              │  │
│  └──────────┬─────────────────────────────┘  │
└─────────────┼────────────────────────────────┘
              │ HTTP/WS (same as before)
              ▼
┌─────────────────────────────────────────────┐
│ Backend (Express + WebSocket)                │
│  - Java detection + download (EXTENDED)      │
│  - All existing services unchanged           │
└─────────────────────────────────────────────┘
```

### Design Principles

- **Single File Responsibility**: Each new file handles one domain — `auth.ts` for OAuth, `launcher.ts` for game launching, `secure-storage.ts` for credential encryption.
- **Component Isolation**: Electron main-process modules don't import from each other (except `secure-storage` which is a utility). They register IPC handlers independently.
- **Service Layer Separation**: Java detection/download lives in the backend (where it logically belongs as a service). Auth and game launching live in Electron main process (where they need OS-level access).
- **Minimal Preload Surface**: The preload script exposes only the specific methods needed — no generic `invoke()` passthrough.

## Components and Interfaces

### Component 1: Secure Storage (`packages/electron/src/secure-storage.ts`)

- **Purpose**: Encrypt/decrypt arbitrary strings using Electron's `safeStorage` API. Replaces Rust `keyring` crate.
- **Interfaces**:
  ```typescript
  export function saveSecret(key: string, value: string): void
  export function getSecret(key: string): string | null
  export function deleteSecret(key: string): void
  export function isEncryptionAvailable(): boolean
  ```
- **Dependencies**: `electron` (`safeStorage`, `app`), `node:fs`, `node:path`
- **Storage mechanism**: Encrypted buffers stored as base64 strings in a JSON file at `{userData}/secure-storage.json`. The `safeStorage.encryptString()` API uses OS-level encryption (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
- **Reuses**: Electron's built-in `safeStorage` API — no additional dependencies.

### Component 2: Microsoft Auth (`packages/electron/src/auth.ts`)

- **Purpose**: Full Microsoft OAuth device code flow → Xbox Live → XSTS → Minecraft Services. Direct TypeScript port of `auth.rs` (360 lines of Rust).
- **Interfaces**:
  ```typescript
  export async function msAuthStart(): Promise<MSAuthDeviceCode>
  export async function msAuthPoll(): Promise<MSAuthStatus>
  export async function msAuthRefresh(accountUuid: string): Promise<LauncherAccount>
  export async function getMcAccessToken(accountUuid: string): Promise<string>
  export async function removeAccount(accountUuid: string): Promise<void>
  ```
- **Dependencies**: `secure-storage.ts` (for token persistence), `node:fetch` (HTTP calls)
- **State**: Module-level `pendingAuth: DeviceCodeResponse | null` (same as Rust's `AuthState`)
- **Constants**: `MS_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb"` (same as Rust), `MS_TENANT = "consumers"`, `MS_SCOPE = "XboxLive.signin offline_access"`
- **Reuses**: Shared types `MSAuthDeviceCode`, `MSAuthStatus`, `LauncherAccount` from `@mc-server-manager/shared`

### Component 3: Game Launcher (`packages/electron/src/launcher.ts`)

- **Purpose**: Spawn Minecraft as a Java child process with correct classpath and arguments. Direct TypeScript port of `launcher.rs` (279 lines of Rust).
- **Interfaces**:
  ```typescript
  export async function launchGame(instanceId: string, accountId: string): Promise<GameProcess>
  export function getRunningGames(): GameProcess[]
  export async function killGame(instanceId: string): Promise<void>
  ```
- **Dependencies**: `auth.ts` (for `getMcAccessToken`), `node:child_process` (`spawn`), `node:fetch` (backend API calls)
- **State**: Module-level `runningGames: GameProcess[]`
- **Process**: Fetches instance from backend → gets MC token → calls backend `/api/launcher/prepare/:id` → resolves Java → builds JVM args (`-Xms`, `-Xmx`, `-Djava.library.path`, `-cp`) → builds game args (`--username`, `--uuid`, `--accessToken`, `--gameDir`, `--assetsDir`, `--assetIndex`, `--version`) → `spawn(java, args)` → tracks PID → monitors exit
- **Reuses**: Shared type `GameProcess` from `@mc-server-manager/shared`. Backend's existing `/api/launcher/prepare/:id` endpoint for file download orchestration.

### Component 4: IPC Registration (`packages/electron/src/ipc.ts`)

- **Purpose**: Register all Electron IPC handlers in one place, keeping `main.ts` clean.
- **Interfaces**:
  ```typescript
  export function registerIpcHandlers(): void
  ```
- **IPC Channels** (all via `ipcMain.handle` for async request/response):
  | Channel | Maps to | Return type |
  |---------|---------|-------------|
  | `ms-auth-start` | `auth.msAuthStart()` | `MSAuthDeviceCode` |
  | `ms-auth-poll` | `auth.msAuthPoll()` | `MSAuthStatus` |
  | `ms-auth-refresh` | `auth.msAuthRefresh(uuid)` | `LauncherAccount` |
  | `get-mc-access-token` | `auth.getMcAccessToken(uuid)` | `string` |
  | `remove-account` | `auth.removeAccount(uuid)` | `void` |
  | `get-java-installations` | backend `GET /api/launcher/java` | `JavaInstallation[]` |
  | `download-java` | backend `POST /api/launcher/java/download` | `JavaInstallation` |
  | `launch-game` | `launcher.launchGame(iId, aId)` | `GameProcess` |
  | `get-running-games` | `launcher.getRunningGames()` | `GameProcess[]` |
  | `kill-game` | `launcher.killGame(iId)` | `void` |
- **Dependencies**: `auth.ts`, `launcher.ts`, `electron` (`ipcMain`)
- **Reuses**: Existing IPC registration pattern from Electron's `contextBridge`

### Component 5: Extended Preload (`packages/electron/src/preload.ts`)

- **Purpose**: Expose typed `electronAPI` to the renderer process via `contextBridge`.
- **Current state**: Only exposes `{ platform: process.platform }`.
- **Extended API**:
  ```typescript
  contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    // Auth
    msAuthStart: () => ipcRenderer.invoke('ms-auth-start'),
    msAuthPoll: () => ipcRenderer.invoke('ms-auth-poll'),
    msAuthRefresh: (uuid: string) => ipcRenderer.invoke('ms-auth-refresh', uuid),
    getMcAccessToken: (uuid: string) => ipcRenderer.invoke('get-mc-access-token', uuid),
    removeAccount: (uuid: string) => ipcRenderer.invoke('remove-account', uuid),
    // Java
    getJavaInstallations: () => ipcRenderer.invoke('get-java-installations'),
    downloadJava: (version: number) => ipcRenderer.invoke('download-java', version),
    // Launcher
    launchGame: (instanceId: string, accountId: string) => ipcRenderer.invoke('launch-game', instanceId, accountId),
    getRunningGames: () => ipcRenderer.invoke('get-running-games'),
    killGame: (instanceId: string) => ipcRenderer.invoke('kill-game', instanceId),
  })
  ```
- **Type definition**: A `global.d.ts` in the frontend will declare `window.electronAPI` with proper types.

### Component 6: Extended Java Service (`packages/backend/src/services/java.ts`)

- **Purpose**: Extend existing Java detection to match Rust's capabilities: multi-installation scanning (not just first-found) and Adoptium download with archive extraction.
- **New interfaces** (added to existing file):
  ```typescript
  export async function detectAllJavaInstallations(): Promise<JavaInstallation[]>
  export async function downloadJava(version: number, dataDir: string): Promise<JavaInstallation>
  ```
- **Dependencies**: `node:child_process`, `node:crypto` (SHA verification), `node:fs`, `node:path`, `tar` (existing dep for tar.gz extraction on Linux/macOS), `adm-zip` (existing dep for zip on Windows)
- **Reuses**: Existing `probeJava()`, `parseJavaVersion()`, `getJavaMajorVersion()`, `findJavaOnPath()`, `getCommonJavaLocations()` functions. Extends them with directory-scanning logic matching `java.rs`.

### Component 7: Frontend Environment Detection (`packages/frontend/src/utils/desktop.ts`)

- **Purpose**: Replace `tauri.ts` with Electron-aware environment detection.
- **Interfaces**:
  ```typescript
  export function isDesktop(): boolean  // true when running in Electron
  export function getBackendBaseUrl(): string
  export function getBackendBaseUrlSync(): string
  ```
- **Detection**: `'electronAPI' in window` instead of `'__TAURI_INTERNALS__' in window`
- **Reuses**: Same pattern as current `tauri.ts`, just different detection key

### Component 8: Frontend Component Updates

- **`AccountManager.tsx`**: Replace `tauriInvoke('ms_auth_start')` → `window.electronAPI.msAuthStart()`, etc.
- **`LaunchButton.tsx`**: Replace `tauriInvoke('launch_game', {...})` → `window.electronAPI.launchGame(instanceId, accountId)`
- **`api/client.ts`**: Replace `getBackendBaseUrlSync()` import from `tauri.ts` → from `desktop.ts`
- **`api/ws.ts`**: Replace `isTauri()` → `isDesktop()` for WebSocket URL resolution
- **`api/auth.ts`**: Replace `getBackendBaseUrlSync()` import
- **`main.tsx`**: Replace `isTauri()` → `isDesktop()` for backend readiness check
- **Delete**: `packages/frontend/src/utils/tauri.ts`, `packages/frontend/src/utils/wait-for-backend.ts` (merge into `desktop.ts`)

## Data Models

No new data models. All existing shared types are reused as-is:

- `MSAuthDeviceCode` — device code + verification URI (from `shared/src/index.ts`)
- `MSAuthStatus` — auth polling result (pending/complete/error)
- `LauncherAccount` — authenticated Minecraft account
- `JavaInstallation` — detected Java with version/path/vendor
- `GameProcess` — running game with instance ID, PID, start time
- `PrepareResponse` — classpath + mainClass + assets metadata from backend

### Secure Storage Schema

A new file `{userData}/secure-storage.json`:
```json
{
  "mc_access_token_{uuid}": "<base64-encoded encrypted buffer>",
  "ms_refresh_token_{uuid}": "<base64-encoded encrypted buffer>"
}
```

This mirrors the Rust keyring key naming convention exactly (`mc_access_token_{uuid}`, `ms_refresh_token_{uuid}`), just stored in an encrypted JSON file instead of the OS keyring.

## Error Handling

### Error Scenarios

1. **safeStorage unavailable (Linux without secret store)**
   - **Handling**: `isEncryptionAvailable()` check before any credential operation. If false, log a warning and refuse to store credentials.
   - **User Impact**: "Secure storage is not available on this system. Authentication requires a desktop environment with a secret store (GNOME Keyring, KWallet)."

2. **Microsoft auth token expired during poll**
   - **Handling**: Return `{ status: 'expired', error: 'Device code expired' }` — same as Rust implementation.
   - **User Impact**: Device code card shows "Code expired. Please try again." with Retry button.

3. **Java download fails mid-stream**
   - **Handling**: Delete partial file, return error. Caller can retry.
   - **User Impact**: Toast notification with error message and option to retry.

4. **Game process crashes immediately**
   - **Handling**: `child.on('exit', ...)` fires, removes from `runningGames`, logs exit code.
   - **User Impact**: LaunchButton returns to "Play" state. Toast shows crash message.

5. **Backend unreachable during game launch**
   - **Handling**: `fetch` to backend fails, error propagated through IPC to renderer.
   - **User Impact**: Toast shows "Failed to prepare launch: Backend unavailable".

6. **IPC called in browser mode**
   - **Handling**: `isDesktop()` returns false, component shows "Requires desktop app" message.
   - **User Impact**: Same as current Tauri behavior — features gracefully disabled.

## Testing Strategy

### Manual Testing Checklist

Since the project has no automated test framework (per AGENTS.md), verification is manual:

1. **Auth flow**: Add Account → device code appears → complete MS login → account shows in list
2. **Token persistence**: Restart Electron app → previously added accounts still listed → can launch without re-auth
3. **Token refresh**: Wait for token expiry → launch game → auto-refresh succeeds transparently
4. **Account removal**: Delete account → credentials removed from secure storage file
5. **Java detection**: Java installations list matches `java -version` from terminal
6. **Java download**: Download Java 21 → appears in installations list → can be used for launch
7. **Game launch**: Select instance + account → Play → Minecraft starts with correct version/credentials
8. **Kill game**: Running game → Kill → process terminates → Play button re-enabled
9. **Browser mode**: Open `http://localhost:5173` in browser → auth/launch features show "Requires desktop app"
10. **System tray**: Close window → tray icon visible → Show Window restores → Quit shuts down cleanly

### Parity Verification

For each Rust function, verify the TypeScript replacement produces identical behavior:

| Rust Function | TypeScript Replacement | Verify |
|--------------|----------------------|--------|
| `ms_auth_start()` | `auth.msAuthStart()` | Same device code response shape |
| `ms_auth_poll()` | `auth.msAuthPoll()` | Same status/account/error fields |
| `ms_auth_refresh()` | `auth.msAuthRefresh()` | Token refreshes transparently |
| `get_mc_access_token()` | `auth.getMcAccessToken()` | Returns valid token string |
| `remove_account()` | `auth.removeAccount()` | Credentials fully deleted |
| `get_java_installations()` | `detectAllJavaInstallations()` | Same installations found |
| `download_java()` | `downloadJava()` | Same Adoptium URL, same extraction |
| `launch_game()` | `launcher.launchGame()` | Identical JVM args, game args, classpath |
| `get_running_games()` | `launcher.getRunningGames()` | Same GameProcess shape |
| `kill_game()` | `launcher.killGame()` | Process terminated, state cleaned |

## Migration Order

The implementation order minimizes risk by building foundations first:

1. **Secure storage** — Foundation for auth (no dependencies)
2. **Auth module** — Depends on secure storage only
3. **Java service extension** — Backend-only, no frontend changes
4. **Game launcher** — Depends on auth module
5. **IPC registration + preload** — Wires everything together
6. **Frontend migration** — Switch from Tauri to Electron APIs
7. **Cleanup** — Delete Tauri package, update configs

Each step can be tested independently before proceeding to the next.
