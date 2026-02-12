# Design Document -- Tauri Desktop App Migration

## Overview

Replace the current Electron desktop shell (`packages/electron/`) with a Tauri 2.0 desktop application (`packages/desktop/`). The Express backend becomes a sidecar binary (packaged via `@yao-pkg/pkg`) instead of being loaded in-process via dynamic import as Electron does today. The React frontend continues loading in a WebView. This migration yields a ~10x smaller installer, a stronger security sandbox, and a Rust core that will host future performance-critical features (game launching, file I/O).

**Note:** The existing Electron implementation already solves the same user-facing problems (desktop window, tray icon, backend lifecycle). This spec is an architectural migration from Electron to Tauri, not a greenfield feature.

## Steering Document Alignment

### Technical Standards (tech.md)
No steering docs exist. This design follows established project conventions:
- TypeScript strict mode for all new TS code
- Rust (stable edition 2021) for the Tauri core
- ES modules throughout
- Existing backend/frontend packages remain unchanged in their core logic

### Project Structure (structure.md)
New `packages/desktop/` workspace follows the same monorepo pattern as `packages/electron/`, `packages/backend/`, and `packages/frontend/`. The workspace is self-contained with its own `package.json`, build scripts, and Tauri-specific configuration.

## Code Reuse Analysis

### Existing Components to Leverage
- **`packages/backend/` (entire package)**: Runs as-is inside the sidecar binary. Only `config.ts` needs a small patch for Tauri-specific env vars (`TAURI_DATA_DIR`, `TAURI_RESOURCE_DIR`) alongside the existing `MC_DATA_DIR` support.
- **`packages/frontend/` (entire package)**: Loads unchanged in the WebView. Only `api/ws.ts` needs Tauri environment detection to use direct URLs instead of `window.location`-based URLs.
- **`packages/electron/src/main.ts` patterns**: The `setElectronEnv()`, `waitForServer()`, `createWindow()`, and `createTray()` patterns will be reimplemented in Rust. The logic is identical; the language changes.
- **Backend graceful shutdown**: The existing SIGTERM handler in `packages/backend/src/index.ts` handles stopping all MC servers. The Tauri layer just needs to send the kill signal -- same as Electron's `before-quit` handler.

### Integration Points
- **Backend config.ts**: Add `TAURI_DATA_DIR` as another env var option (alongside existing `DATA_DIR` and `MC_DATA_DIR`)
- **Frontend ws.ts**: Add Tauri environment detection to `getUrl()` method so it returns `ws://localhost:3001/ws` when running in Tauri's WebView
- **Frontend main.tsx**: Add optional `waitForBackend()` call gated on Tauri detection
- **Root package.json**: Add `dev:desktop` and `build:desktop` scripts (alongside existing `dev:electron` and `build:electron`)

## Architecture

The architecture replaces Electron's Node.js main process with Tauri's Rust core. The backend shifts from an in-process dynamic import to an external sidecar binary.

### Current Architecture (Electron)
```
┌─────────────────────────────────────┐
│  Electron Main Process (Node.js)    │
│  ├── dynamic import(@backend)       │  ← Backend runs IN the Electron process
│  ├── BrowserWindow (Chromium)       │
│  ├── Tray icon                      │
│  └── Graceful shutdown              │
│       ┌─────────────────────┐       │
│       │ Renderer (React SPA)│       │
│       │ loads from backend  │       │
│       │ or Vite dev server  │       │
│       └─────────────────────┘       │
└─────────────────────────────────────┘
```

### Target Architecture (Tauri)
```
┌──────────────────────────────────────────────┐
│  Tauri App                                   │
│  ┌────────────────────────────────────────┐  │
│  │ WebView (React SPA)                    │  │
│  │  • Loads from Vite dev server (dev)    │  │
│  │  • Loads from bundled dist/ (prod)     │  │
│  │  • HTTP/WS to localhost:3001           │  │
│  └─────────────┬──────────────────────────┘  │
│                │                             │
│  ┌─────────────▼──────────────────────────┐  │
│  │ Rust Core                              │  │
│  │  • Spawns/manages backend sidecar      │  │
│  │  • Window management, tray icon        │  │
│  │  • (Future: game launching, file I/O)  │  │
│  └─────────────┬──────────────────────────┘  │
│                │ child_process               │
│  ┌─────────────▼──────────────────────────┐  │
│  │ Backend Sidecar (standalone binary)    │  │
│  │  • Express HTTP + WS on :3001          │  │
│  │  • SQLite, Java process management     │  │
│  │  • Identical code to current backend   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Key Architectural Differences from Electron

| Aspect | Electron (current) | Tauri (target) |
|--------|-------------------|----------------|
| Backend hosting | In-process dynamic import | External sidecar binary |
| Backend packaging | Ships as JS files in `extraResources` | Compiled to standalone binary via `@yao-pkg/pkg` |
| Native module (`better-sqlite3`) | Electron-rebuilt `.node` addon | Shipped alongside sidecar as separate file |
| Window engine | Chromium (bundled, ~150MB) | OS WebView (0MB overhead) |
| Core language | JavaScript (Node.js) | Rust |
| Security model | `contextIsolation` + preload script | Capabilities-based permissions |
| IPC | Electron IPC bridge | Not used in this phase (HTTP/WS only) |
| App size | ~150-200MB installer | ~10-20MB + sidecar (~50-80MB) |

### Modular Design Principles
- **Single File Responsibility**: `lib.rs` handles Tauri setup + sidecar management. Tray logic is extracted if it grows beyond ~50 lines.
- **Component Isolation**: Frontend Tauri utilities (`isTauri()`, `waitForBackend()`) are isolated in `utils/` and don't affect non-Tauri code paths.
- **Service Layer Separation**: The Rust core only manages process lifecycle. All business logic stays in the Express backend.
- **Utility Modularity**: Backend path resolution (`config.ts`) uses a chain of env var checks -- each desktop shell adds its own env var without disturbing others.

## Components and Interfaces

### Component 1: Rust Core (`packages/desktop/src-tauri/src/lib.rs`)
- **Purpose**: Tauri application setup, sidecar lifecycle management, system tray, window management
- **Interfaces**:
  - `spawn_backend(app: &AppHandle) -> Result<()>` -- Spawns the sidecar with appropriate env vars
  - `AppState { backend_child: Mutex<Option<CommandChild>> }` -- Managed state for sidecar handle
  - `on_window_event` -- Close-to-tray behavior
  - `on_menu_event` -- Tray menu actions (Show, Quit)
- **Dependencies**: `tauri`, `tauri-plugin-shell`, `tauri-plugin-process`
- **Reuses**: Same lifecycle pattern as `packages/electron/src/main.ts` (`startBackend` -> `waitForServer` -> `createWindow` -> `createTray`)

### Component 2: Backend Packaging Script (`packages/desktop/scripts/package-backend.ts`)
- **Purpose**: Compile the Express backend into a standalone binary using `@yao-pkg/pkg`
- **Interfaces**: CLI script, no API. Run via `npm run package-backend -w desktop`
- **Dependencies**: `@yao-pkg/pkg`, `child_process`, `fs`
- **Reuses**: Existing backend build output (`packages/backend/dist/`)

### Component 3: Tauri Environment Detection (`packages/frontend/src/utils/tauri.ts`)
- **Purpose**: Detect if running inside Tauri WebView, provide environment-appropriate URLs
- **Interfaces**:
  - `isTauri(): boolean` -- Checks for `__TAURI_INTERNALS__` on window
- **Dependencies**: None
- **Reuses**: Pattern similar to how `packages/electron/src/main.ts` checks `app.isPackaged`

### Component 4: Backend Readiness Poller (`packages/frontend/src/utils/wait-for-backend.ts`)
- **Purpose**: Poll the backend health endpoint before rendering the app (Tauri mode only)
- **Interfaces**:
  - `waitForBackend(url?: string, maxAttempts?: number, intervalMs?: number): Promise<void>`
- **Dependencies**: `fetch`
- **Reuses**: Same logic as `waitForServer()` in `packages/electron/src/main.ts`, but runs in the frontend instead of the main process

### Component 5: Backend Config Enhancement (`packages/backend/src/config.ts`)
- **Purpose**: Add Tauri-specific environment variable support for data directory resolution
- **Interfaces**: Existing `config` object, no API change
- **Dependencies**: None new
- **Reuses**: Extends existing `resolveDataDir()` function which already checks `DATA_DIR` and `MC_DATA_DIR`

## Data Models

No new data models. The migration is purely an application shell change. The SQLite database schema, server model, and settings model are unchanged.

## Error Handling

### Error Scenarios

1. **Backend sidecar fails to start**
   - **Handling**: Rust core logs the error from sidecar stdout/stderr. Frontend's `waitForBackend()` times out after 15 seconds.
   - **User Impact**: Loading screen shows for 15s, then an error message: "Backend failed to start within timeout."

2. **Backend sidecar crashes during operation**
   - **Handling**: Rust core receives `CommandEvent::Terminated` and logs exit code/signal. Frontend's existing WebSocket auto-reconnect detects disconnection.
   - **User Impact**: Existing connection-lost UI appears (from WebSocket disconnect handlers in `serverStore.ts`). No automatic restart in this phase.

3. **Port 3001 already in use**
   - **Handling**: Backend's `listen()` call fails with EADDRINUSE. Error surfaces in sidecar stderr, logged by Rust core.
   - **User Impact**: `waitForBackend()` times out. User sees startup failure message. Future enhancement: configurable port.

4. **`better-sqlite3` native module not found**
   - **Handling**: Backend crashes immediately on startup with a module load error. Logged by Rust core.
   - **User Impact**: Same as scenario 1 (startup timeout).

5. **WebView CSP blocks backend connection**
   - **Handling**: Fetch/WebSocket calls fail. Frontend error handling shows toast errors.
   - **User Impact**: App loads but shows connection errors. Fix requires updating CSP in `tauri.conf.json`.

## File Structure

### New Files
```
packages/desktop/
├── package.json                           # Workspace package with Tauri deps
├── scripts/
│   └── package-backend.ts                 # pkg binary packaging script
└── src-tauri/
    ├── tauri.conf.json                    # Tauri configuration (window, CSP, sidecar)
    ├── Cargo.toml                         # Rust dependencies
    ├── capabilities/
    │   └── default.json                   # Security permissions (shell, process)
    ├── icons/                             # Platform icons (generated)
    │   ├── 32x32.png
    │   ├── 128x128.png
    │   ├── 128x128@2x.png
    │   ├── icon.icns
    │   ├── icon.ico
    │   └── icon.png
    ├── binaries/                          # Packaged backend binary (build artifact)
    └── src/
        ├── main.rs                        # Entry point (#[cfg] delegates to lib)
        └── lib.rs                         # Sidecar mgmt, tray, window events

packages/frontend/src/utils/
├── tauri.ts                               # isTauri() detection
└── wait-for-backend.ts                    # Health check poller
```

### Modified Files
```
package.json                               # Add desktop workspace, dev:desktop, build:desktop
packages/backend/src/config.ts             # Add TAURI_DATA_DIR env var check
packages/frontend/src/api/ws.ts            # Tauri-aware URL in getUrl()
packages/frontend/src/main.tsx             # waitForBackend() before render in Tauri mode
packages/frontend/index.html               # Loading screen placeholder in #root
```

### Files NOT Modified
```
packages/electron/                         # Left intact -- can coexist during migration
packages/backend/src/                      # No changes except config.ts
packages/frontend/src/api/client.ts        # Already uses relative URLs (works with proxy & direct)
shared/                                    # No changes
```

## Testing Strategy

### Unit Testing
- No automated test framework exists in the project yet. Manual testing is the current approach.
- The `waitForBackend()` utility is simple enough to verify via manual browser testing.
- The `isTauri()` detection can be verified by checking behavior in browser vs. Tauri WebView.

### Integration Testing
- **Dev workflow**: Verify `npm run dev:desktop` starts Tauri window with frontend loading from Vite
- **Backend sidecar**: Verify backend auto-starts, API responds, WebSocket connects from within Tauri
- **External backend mode**: Verify `TAURI_DEV_BACKEND_EXTERNAL=1` skips sidecar spawn
- **Coexistence**: Verify `npm run dev` (browser) and `npm run dev:electron` still work unchanged

### End-to-End Testing
- **Full lifecycle**: Launch app -> create MC server -> start server -> verify console output -> stop server -> quit app (via tray) -> verify all processes terminated
- **Close-to-tray**: Close window -> verify tray icon present -> verify MC server still running -> restore window -> verify console still streaming
- **Production build**: `npm run build:desktop` produces working installer -> install -> launch -> verify all features
- **Cross-platform**: Build and test on Windows, macOS, and Linux (via CI matrix)
- **Backend crash**: Kill sidecar process externally -> verify frontend shows disconnect -> verify no orphan Java processes
