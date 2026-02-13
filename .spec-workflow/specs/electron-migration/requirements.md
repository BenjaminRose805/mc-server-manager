# Requirements Document -- Electron Migration (Remove Rust/Tauri)

## Introduction

Migrate all Rust/Tauri functionality into the existing Electron desktop shell and TypeScript backend, then remove the Tauri `packages/desktop/` package entirely. The project currently has **dual desktop implementations** -- a Tauri app (Rust) and an Electron app (TypeScript). The Tauri layer provides Microsoft OAuth authentication (with OS keychain storage), Java detection/download, and Minecraft client launching. These features need to be reimplemented in TypeScript within the Electron package and backend, so the entire codebase is maintainable in a single language.

The Electron package (`packages/electron/`) already handles window management, system tray, backend lifecycle, and close-to-tray behavior. This migration adds the three missing capabilities (auth, Java, game launching) and rewires the frontend to use Electron IPC instead of Tauri `invoke()`.

## Alignment with Product Vision

MC Server Manager is a self-hosted community platform for Minecraft. All 4 pending specs (friends-text-chat, mod-sync, shared-minecraft-servers, voice-communication) are pure TypeScript (Express + React) with zero Rust dependencies. Eliminating Rust:

- Makes the codebase maintainable by a TypeScript-proficient developer
- Removes the Rust toolchain requirement for all contributors
- Simplifies CI (no cross-compilation of Rust binaries)
- Consolidates two desktop packages into one
- All future features build on the same TypeScript foundation

---

## Requirements

### REQ-1: Microsoft OAuth Authentication in Electron

**User Story:** As a player, I want to sign in with my Microsoft account from the Electron desktop app, so that I can launch Minecraft with my purchased license -- without requiring Rust/Tauri.

#### Acceptance Criteria

1. WHEN the user initiates sign-in from the Electron app THEN the system SHALL perform the Microsoft OAuth2 device code flow via the Electron main process, returning a device code and verification URL to the frontend.
2. WHEN the user completes authentication on the Microsoft website THEN the Electron main process SHALL execute the full authentication chain: Microsoft OAuth2 token exchange -> Xbox Live authentication -> XSTS authorization -> Minecraft Services login -> Minecraft profile retrieval.
3. WHEN authentication completes THEN the system SHALL store the Minecraft access token and Microsoft refresh token securely using Electron's `safeStorage` API (OS-level encryption), NOT in SQLite or unencrypted files.
4. WHEN a stored access token expires THEN the system SHALL automatically refresh it using the stored Microsoft refresh token before launching.
5. WHEN the user removes an account THEN the system SHALL delete all associated encrypted tokens from disk.
6. WHEN the frontend calls authentication functions THEN it SHALL use Electron IPC (`window.electronAPI.*`) instead of Tauri `invoke()`.
7. WHEN running in browser mode (no Electron) THEN authentication functions SHALL be unavailable with a clear message, identical to current behavior.

---

### REQ-2: Java Detection and Download in TypeScript

**User Story:** As a player, I want the launcher to detect and download Java automatically, so that I don't need to manage Java installations manually -- using TypeScript instead of Rust.

#### Acceptance Criteria

1. WHEN the launcher queries Java installations THEN the backend SHALL scan the same locations currently scanned by Rust: `JAVA_HOME`, system PATH, and platform-specific directories (Windows: `C:\Program Files\Java`, `C:\Program Files\Eclipse Adoptium`; macOS: `/Library/Java/JavaVirtualMachines`, `/opt/homebrew/opt`; Linux: `/usr/lib/jvm`).
2. WHEN a Java installation is found THEN the system SHALL execute `java -version` and parse the output to extract major version, full version string, and vendor name, using the same parsing logic as the Rust implementation.
3. WHEN the user requests a Java download THEN the system SHALL download from the Eclipse Adoptium API (`https://api.adoptium.net/v3/binary/latest/{version}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse`).
4. WHEN a Java archive is downloaded THEN the system SHALL extract it (`.tar.gz` on macOS/Linux, `.zip` on Windows) to `{appDataDir}/launcher/runtime/java-{version}/`.
5. WHEN Java detection is called THEN results SHALL be deduplicated by canonical path to avoid listing the same installation twice.
6. IF the backend already has a partial Java detection service (`packages/backend/src/services/java.ts`) THEN the migration SHALL extend it rather than create a duplicate.

---

### REQ-3: Game Launching in Electron

**User Story:** As a player, I want to click "Play" and have Minecraft launch from the Electron app, so that I get the same game launching experience without requiring Rust.

#### Acceptance Criteria

1. WHEN the user clicks launch THEN the Electron main process SHALL: retrieve the Minecraft access token from encrypted storage, fetch instance data from the backend, call the backend's prepare endpoint (download missing files), resolve the Java path, construct the JVM and game arguments, and spawn the Java child process.
2. WHEN the game launches THEN the system SHALL pass the same arguments as the Rust implementation: classpath, main class, authentication tokens (username, UUID, access token), game directory, assets directory, asset index, version name, and resolution if configured.
3. WHEN a game process is spawned THEN the Electron main process SHALL track it with instance ID, PID, and start time, and expose `getRunningGames()` and `killGame()` via IPC.
4. WHEN a game process exits THEN the system SHALL clean up the tracked process state.
5. WHEN a game is already running for an instance THEN the system SHALL prevent launching a duplicate.
6. WHEN the frontend calls launch/game management functions THEN it SHALL use Electron IPC instead of Tauri `invoke()`.

---

### REQ-4: Frontend Migration from Tauri IPC to Electron IPC

**User Story:** As a developer, I want the frontend to use Electron IPC for all native features, so that there are no remaining Tauri dependencies in the codebase.

#### Acceptance Criteria

1. WHEN the frontend needs to call native features (auth, launch, Java) THEN it SHALL use `window.electronAPI.*` methods exposed via Electron's `contextBridge` preload script.
2. WHEN running inside Electron THEN the frontend SHALL detect the environment via `window.electronAPI` presence (replacing the current `__TAURI_INTERNALS__` check).
3. WHEN running in browser mode THEN all Electron-specific features SHALL gracefully degrade with user-facing messages, identical to current Tauri behavior.
4. WHEN the migration is complete THEN no file in `packages/frontend/` SHALL import from `@tauri-apps/api` or reference `__TAURI_INTERNALS__`.
5. WHEN the backend base URL is resolved THEN the frontend SHALL use Electron IPC to get the port (if Electron provides a dynamic port) OR use the existing relative URL / Vite proxy pattern.

---

### REQ-5: Remove Tauri Package

**User Story:** As a developer, I want the Tauri/Rust code completely removed from the repository, so that there is a single desktop implementation and no Rust toolchain requirement.

#### Acceptance Criteria

1. WHEN the migration is complete THEN the `packages/desktop/` directory SHALL be deleted entirely (all Rust source, Cargo.toml, Cargo.lock, tauri.conf.json, icons, scripts).
2. WHEN `packages/desktop/` is removed THEN the root `package.json` SHALL be updated to remove the desktop workspace entry.
3. WHEN the desktop workspace is removed THEN the `dev:desktop` and `build:desktop` scripts in root `package.json` SHALL be removed.
4. WHEN Tauri dependencies are removed THEN `packages/frontend/package.json` SHALL have no `@tauri-apps/*` dependencies (if any were added).
5. WHEN the GitHub Actions CI workflow for Tauri builds (`.github/workflows/build-desktop.yml`) exists THEN it SHALL be deleted.
6. WHEN the migration plan `plans/EPIC-1-tauri-desktop.md` exists THEN it SHALL be archived or deleted.

---

### REQ-6: Parity Verification

**User Story:** As a user, I want all features that worked with Tauri to work identically with Electron, so that the migration doesn't break anything.

#### Acceptance Criteria

1. WHEN the migration is complete THEN the Microsoft OAuth device code flow SHALL produce the same `MSAuthDeviceCode` and `MSAuthStatus` response shapes as the Tauri implementation.
2. WHEN the migration is complete THEN Java detection SHALL find the same installations and return the same `JavaInstallation` data shape.
3. WHEN the migration is complete THEN game launching SHALL construct the same JVM arguments, game arguments, and classpath as the Rust implementation.
4. WHEN the migration is complete THEN the system tray behavior SHALL remain identical: close-to-tray, Show Window, Quit with graceful shutdown.
5. WHEN the migration is complete THEN the Electron app SHALL start the backend, wait for readiness, and load the frontend -- the same lifecycle as today.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Authentication (`electron/src/auth.ts`), Java management (extend backend service), and game launching (`electron/src/launcher.ts`) SHALL each be separate modules.
- **Modular Design**: Electron IPC handlers SHALL be registered in a dedicated module, not inlined in `main.ts`.
- **Dependency Management**: The frontend SHALL not import Electron-specific modules directly -- all native features flow through the `contextBridge` preload script.
- **Clear Interfaces**: The preload script SHALL expose a typed `electronAPI` object that the frontend consumes. TypeScript interfaces for this API SHALL be shared (e.g., in a `.d.ts` file).

### Performance
- The Microsoft OAuth authentication chain SHALL complete within 10 seconds (excluding user interaction time).
- Java detection SHALL complete within 5 seconds on a system with up to 10 installed JDKs.
- Java download and extraction SHALL report progress and not block the Electron main process.
- Game launch time (from click to process spawn, excluding downloads) SHALL be under 5 seconds.

### Security
- Authentication tokens SHALL be encrypted at rest using Electron's `safeStorage` API, which delegates to the OS credential store (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
- The Microsoft OAuth2 client ID SHALL use the same value as the current Rust implementation.
- The Electron preload script SHALL use `contextIsolation: true` and `nodeIntegration: false` (already configured).
- IPC channels SHALL be explicitly whitelisted -- no wildcard IPC handlers.

### Reliability
- IF `safeStorage` is not available on the platform THEN the system SHALL fall back to encrypted file storage with a warning, matching the Rust keyring fallback behavior.
- IF a Java download fails mid-stream THEN the system SHALL clean up partial files and allow retry.
- IF the game process crashes THEN the tracked process state SHALL still be cleaned up.
- The migration SHALL NOT affect existing server management functionality.

### Usability
- The authentication flow SHALL present the same device code UI as the current Tauri implementation.
- There SHALL be no visible difference to the user between the Tauri and Electron versions of any feature.
- The loading screen on startup SHALL continue to work as-is.
