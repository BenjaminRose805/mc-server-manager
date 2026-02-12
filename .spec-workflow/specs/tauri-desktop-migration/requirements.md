# Requirements Document -- Tauri Desktop App Migration

## Introduction

Migrate MC Server Manager from a browser-based SPA into a native Tauri 2.0 desktop application. The existing Express backend becomes a sidecar process that Tauri spawns and manages, and the existing React frontend loads inside Tauri's WebView. This preserves all current functionality while enabling future capabilities that require native OS access (game launching, file management, voice chat).

This is the foundational epic -- all subsequent epics (mod management, client launcher, multi-user, voice, etc.) depend on the desktop shell being in place.

## Alignment with Product Vision

MC Server Manager is evolving from a local browser tool into a self-hosted community platform. A desktop application is the prerequisite for:
- Launching Minecraft client instances (Epic 3)
- Native file system access for mod management (Epics 2, 4)
- System tray presence while servers run in the background
- Auto-update distribution to end users
- Future multi-user community features (Epics 5-9)

Tauri 2.0 was chosen over Electron for smaller bundle size (~10MB vs ~150MB), stronger security model, and Rust core for performance-critical operations.

---

## Requirements

### REQ-1: Tauri Desktop Shell

**User Story:** As a server administrator, I want MC Server Manager to run as a native desktop application, so that I get a proper window with OS-level integration instead of relying on a browser tab.

#### Acceptance Criteria

1. WHEN the user launches the desktop application THEN the system SHALL display the existing React SPA inside a native window with a minimum size of 900x600 and default size of 1280x800.
2. WHEN running inside Tauri THEN the application SHALL behave identically to the current browser-based version for all existing server management features.
3. WHEN the user runs `npm run dev:desktop` THEN the system SHALL start both the backend and Tauri with hot-reload enabled for frontend development.
4. WHEN the user runs `npm run dev` (without `:desktop`) THEN the existing browser-only development workflow SHALL continue to work unchanged.

---

### REQ-2: Backend Sidecar Lifecycle

**User Story:** As a server administrator, I want the backend to start automatically when I launch the desktop app, so that I don't need to manually start a separate server process.

#### Acceptance Criteria

1. WHEN the Tauri application starts THEN the Rust core SHALL spawn the packaged Express backend as a sidecar child process.
2. WHEN the backend sidecar is starting THEN the frontend SHALL display a loading indicator until the backend responds to health checks.
3. IF the backend health check does not succeed within 15 seconds THEN the system SHALL display an error message to the user.
4. WHEN the backend sidecar process terminates unexpectedly THEN the Rust core SHALL log the termination details (exit code, signal) for debugging.
5. WHEN the Tauri application exits (via Quit) THEN the Rust core SHALL send a termination signal to the backend sidecar, which triggers the existing graceful shutdown of all running Minecraft servers.
6. WHEN running in development mode with `TAURI_DEV_BACKEND_EXTERNAL=1` THEN the Rust core SHALL skip spawning the sidecar, allowing the developer to run the backend separately.

---

### REQ-3: Backend Binary Packaging

**User Story:** As a developer, I want the Express backend to be compiled into a standalone binary, so that it can be bundled inside the Tauri application without requiring Node.js on the user's machine.

#### Acceptance Criteria

1. WHEN the build pipeline runs THEN the system SHALL package the Express backend into a standalone Node.js binary using `@yao-pkg/pkg`.
2. WHEN the backend runs as a packaged binary THEN it SHALL resolve data directories, migration files, and native modules from environment variables (`TAURI_DATA_DIR`, `TAURI_RESOURCE_DIR`) set by the Tauri host.
3. WHEN running in development mode (no `TAURI_DATA_DIR` set) THEN the backend SHALL continue to resolve paths relative to the project root as it does today.
4. WHEN the backend binary is packaged THEN the `better-sqlite3` native addon (`.node` file) SHALL be shipped alongside the binary since native addons cannot be embedded inside `pkg` binaries.
5. WHEN building for a target platform THEN the packaging script SHALL produce a correctly-named binary with the Rust target triple suffix (e.g., `mc-server-backend-x86_64-unknown-linux-gnu`).

---

### REQ-4: Frontend Tauri Integration

**User Story:** As a user, I want the frontend to seamlessly work inside the Tauri desktop app while still being usable in a regular browser for development.

#### Acceptance Criteria

1. WHEN the frontend is running inside a Tauri WebView THEN it SHALL detect the Tauri environment and connect directly to the backend at `http://localhost:3001` and `ws://localhost:3001/ws`.
2. WHEN the frontend is running in a regular browser THEN it SHALL use relative URLs and the Vite proxy as it does today.
3. WHEN the Tauri WebView loads THEN the Content Security Policy SHALL allow connections to `localhost:3001` for both HTTP and WebSocket, image loading from Modrinth CDN, and inline styles required by the framework.
4. WHEN the frontend starts inside Tauri THEN it SHALL poll the backend health endpoint before rendering the main application, showing a loading screen during the wait.

---

### REQ-5: System Tray Integration

**User Story:** As a server administrator, I want the application to minimize to the system tray when I close the window, so that my Minecraft servers keep running in the background without the app taking up taskbar space.

#### Acceptance Criteria

1. WHEN the user clicks the window close button THEN the application SHALL hide the window and minimize to the system tray instead of quitting.
2. WHEN the application is in the system tray THEN the tray icon SHALL display a context menu with "Show Window" and "Quit" options.
3. WHEN the user clicks "Show Window" or left-clicks the tray icon THEN the application window SHALL restore and receive focus.
4. WHEN the user clicks "Quit" from the tray menu THEN the application SHALL gracefully shut down the backend sidecar (including all running Minecraft servers) and exit.
5. WHEN the application is in the system tray THEN the tray icon SHALL display a tooltip reading "MC Server Manager".

---

### REQ-6: App Icons and Branding

**User Story:** As a user, I want the desktop application to have proper icons and branding, so that it looks professional in the OS taskbar, dock, and system tray.

#### Acceptance Criteria

1. WHEN the application is installed THEN it SHALL have platform-appropriate icons: `.ico` for Windows, `.icns` for macOS, and `.png` for Linux.
2. WHEN the application is loading (backend sidecar starting) THEN the system SHALL display a branded loading screen with the application name and a "Starting..." indicator.
3. WHEN the React application mounts THEN the loading screen SHALL be automatically replaced by the full application UI.

---

### REQ-7: Production Build and Distribution

**User Story:** As a developer, I want a single build command that produces platform-specific installers, so that I can distribute the desktop application to users.

#### Acceptance Criteria

1. WHEN `npm run build:desktop` is executed THEN the system SHALL build shared types, backend, package the backend binary, build the frontend, and compile the Tauri application in the correct order.
2. WHEN the build completes THEN it SHALL produce platform-specific installers: `.msi`/`.exe` for Windows, `.dmg` for macOS, `.deb`/`.AppImage` for Linux.
3. WHEN a git tag matching `v*` is pushed THEN the GitHub Actions CI pipeline SHALL build the desktop application for Linux (x86_64), macOS (aarch64), and Windows (x86_64).
4. WHEN the Tauri build bundles the application THEN the backend sidecar binary SHALL be included via the `externalBin` configuration.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: The Tauri desktop package (`packages/desktop/`) SHALL be a standalone workspace that does not modify the core backend or frontend logic beyond environment detection and URL resolution.
- **Modular Design**: Tauri-specific frontend utilities (`isTauri()`, `waitForBackend()`) SHALL be isolated in a `utils/` directory and imported only where needed.
- **Dependency Management**: The frontend SHALL not import `@tauri-apps/api` in code paths that execute in browser mode -- Tauri detection must gate all Tauri-specific imports.
- **Clear Interfaces**: The backend sidecar communicates with the Rust core only through environment variables and process signals -- no custom IPC protocol in this phase.

### Performance
- The backend sidecar SHALL start and respond to health checks within 15 seconds under normal conditions.
- The Tauri application binary (excluding the backend sidecar) SHALL be under 20MB.
- The total application installer size SHALL be under 100MB.

### Security
- The Tauri security capabilities SHALL follow the principle of least privilege -- only `shell:allow-execute` for the sidecar binary, `shell:allow-open` for external links, and `process:default`.
- The Content Security Policy SHALL restrict connections to `self` and `localhost:3001` only.
- No Tauri IPC commands beyond sidecar management SHALL be exposed in this phase.

### Reliability
- IF the backend sidecar crashes THEN the frontend SHALL detect the disconnection (via existing WebSocket reconnect logic) and show a connection error.
- The backend's existing SIGTERM handler SHALL be the single path for graceful Minecraft server shutdown -- the Tauri layer SHALL NOT implement its own server stop logic.
- IF port 3001 is already in use THEN the backend SHALL fail with a clear error that surfaces in the Tauri logs.

### Usability
- The transition to a desktop app SHALL be invisible to the user -- all existing features work identically.
- The system tray icon SHALL provide intuitive show/quit options without requiring documentation.
- The loading screen SHALL give clear feedback that the application is starting, not hung.
