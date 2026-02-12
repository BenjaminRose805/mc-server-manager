# Epic 1 — Tauri Desktop App Migration

> **Prerequisite for**: All subsequent epics
> **Standalone value**: Native desktop app experience — tray icon, window management, local file access, foundation for client launching
> **Dependencies**: None (first epic)

---

## Executive Summary

Migrate MC Server Manager from a browser-based SPA to a Tauri 2.0 desktop application. The existing Express backend becomes a **sidecar process** that Tauri spawns and manages. The existing React frontend loads in Tauri's WebView. This preserves all existing functionality while enabling future capabilities that require native OS access (launching Minecraft, file management, voice chat via WebRTC).

### Key Decisions

- **Tauri 2.0** over Electron: Smaller bundles (~10MB vs ~150MB), better security model, Rust core for performance-critical operations
- **Backend as sidecar**: The Express backend is packaged into a standalone binary via `@yao-pkg/pkg` and bundled with the Tauri app. This preserves the entire existing backend and allows it to later serve as the community server (Epic 5)
- **No backend rewrite**: The Express server stays as-is. Tauri's Rust core handles only local OS operations (future: game launching, file I/O). HTTP/WS communication between frontend and backend continues as before

---

## Architecture

### Current Architecture
```
Browser ──HTTP/WS──► Express Backend (localhost:3001) ──► SQLite + Java processes
   │
   └── Vite dev server (localhost:5173, proxies to backend)
```

### Target Architecture
```
┌──────────────────────────────────────────────┐
│  Tauri App                                   │
│  ┌────────────────────────────────────────┐  │
│  │ WebView (React SPA)                    │  │
│  │  • Loads from Vite dev server (dev)    │  │
│  │  • Loads from bundled dist/ (prod)     │  │
│  │  • Communicates with backend via       │  │
│  │    HTTP/WS (same as before)            │  │
│  └─────────────┬──────────────────────────┘  │
│                │ Tauri IPC (future use)       │
│  ┌─────────────▼──────────────────────────┐  │
│  │ Rust Core                              │  │
│  │  • Spawns/manages backend sidecar      │  │
│  │  • Window management, tray icon        │  │
│  │  • System tray, auto-launch            │  │
│  │  • (Future: game launching, file I/O)  │  │
│  └─────────────┬──────────────────────────┘  │
│                │ child_process                │
│  ┌─────────────▼──────────────────────────┐  │
│  │ Backend Sidecar (Node.js binary)       │  │
│  │  • Express HTTP + WS server            │  │
│  │  • SQLite, Java process management     │  │
│  │  • Identical to current backend        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Project Structure Changes

```
mc-server-manager/
├── package.json                    # Root workspace — add "desktop" workspace
├── packages/
│   ├── backend/                    # Existing — unchanged
│   ├── frontend/                   # Existing — minor changes for Tauri integration
│   └── desktop/                    # NEW — Tauri desktop shell
│       ├── package.json
│       ├── src-tauri/
│       │   ├── tauri.conf.json     # Tauri configuration
│       │   ├── Cargo.toml          # Rust dependencies
│       │   ├── capabilities/
│       │   │   └── default.json    # Security permissions
│       │   ├── binaries/           # Packaged backend sidecar binaries
│       │   ├── icons/              # App icons (all sizes)
│       │   └── src/
│       │       ├── lib.rs          # Tauri setup, commands, sidecar management
│       │       └── main.rs         # Entry point
│       └── scripts/
│           └── package-backend.ts  # Script to package backend with pkg
├── shared/                         # Existing — unchanged
└── data/                           # Existing — unchanged
```

---

## Phase 1A: Tauri Project Scaffolding

### 1A.1: Add `desktop` workspace package

Create `packages/desktop/package.json`:
```json
{
  "name": "@mc-server-manager/desktop",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "package-backend": "tsx scripts/package-backend.ts"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-process": "^2.0.0",
    "@tauri-apps/plugin-updater": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

Update root `package.json` workspaces:
```json
{
  "workspaces": [
    "packages/backend",
    "packages/frontend",
    "packages/desktop",
    "shared"
  ]
}
```

### 1A.2: Initialize Tauri in `packages/desktop`

Run `npx @tauri-apps/cli init` inside `packages/desktop/` to generate the `src-tauri/` directory.

### 1A.3: Configure `tauri.conf.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/schema.json",
  "productName": "MC Server Manager",
  "version": "0.1.0",
  "identifier": "com.mc-server-manager.app",
  "build": {
    "beforeDevCommand": "npm run dev -w frontend",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build -w shared && npm run build -w frontend",
    "frontendDist": "../../frontend/dist"
  },
  "app": {
    "title": "MC Server Manager",
    "windows": [
      {
        "title": "MC Server Manager",
        "width": 1280,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://localhost:3001 ws://localhost:3001; img-src 'self' https://cdn.modrinth.com data:; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": ["binaries/mc-server-backend"],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

**Key points:**
- `beforeDevCommand` starts the Vite dev server for the frontend
- `devUrl` points the WebView at the Vite dev server during development
- `frontendDist` points to the built frontend for production
- `externalBin` declares the backend sidecar binary
- CSP allows connections to the backend on localhost:3001

### 1A.4: Security capabilities

Create `src-tauri/capabilities/default.json`:
```json
{
  "identifier": "default",
  "description": "Default capabilities for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/mc-server-backend",
          "sidecar": true,
          "args": true
        }
      ]
    },
    "shell:allow-open",
    "process:default"
  ]
}
```

**Files created**: `packages/desktop/package.json`, `packages/desktop/src-tauri/` (via `tauri init`), `packages/desktop/src-tauri/capabilities/default.json`
**Files modified**: `package.json` (root, add desktop workspace)

---

## Phase 1B: Backend Sidecar Packaging

### 1B.1: Backend packaging script

The Express backend must be compiled into a standalone binary so Tauri can bundle it. Use `@yao-pkg/pkg` (actively maintained fork of `vercel/pkg`).

Create `packages/desktop/scripts/package-backend.ts`:

```typescript
import { execSync } from 'child_process';
import { cpSync, mkdirSync } from 'fs';
import { join } from 'path';

const TARGETS = {
  'x86_64-unknown-linux-gnu': 'node22-linux-x64',
  'aarch64-unknown-linux-gnu': 'node22-linux-arm64',
  'x86_64-apple-darwin': 'node22-macos-x64',
  'aarch64-apple-darwin': 'node22-macos-arm64',
  'x86_64-pc-windows-msvc': 'node22-win-x64',
} as const;

// Detect current platform's target triple
const rustTarget = execSync('rustc -Vv')
  .toString()
  .match(/host: (.+)/)?.[1]
  ?.trim() ?? '';

const pkgTarget = TARGETS[rustTarget as keyof typeof TARGETS];
if (!pkgTarget) {
  throw new Error(`Unsupported target: ${rustTarget}`);
}

const backendDir = join(__dirname, '../../../backend');
const binariesDir = join(__dirname, '../src-tauri/binaries');
const ext = process.platform === 'win32' ? '.exe' : '';
const outputName = `mc-server-backend-${rustTarget}${ext}`;

// Build shared types first
console.log('Building shared types...');
execSync('npm run build -w shared', { cwd: join(__dirname, '../../..'), stdio: 'inherit' });

// Build backend
console.log('Building backend...');
execSync('npm run build', { cwd: backendDir, stdio: 'inherit' });

// Package with pkg
console.log(`Packaging backend for ${pkgTarget}...`);
mkdirSync(binariesDir, { recursive: true });
execSync(
  `npx @yao-pkg/pkg dist/index.js --target ${pkgTarget} --output "${join(binariesDir, outputName)}"`,
  { cwd: backendDir, stdio: 'inherit' }
);

// Copy SQLite native addon (pkg can't bundle native modules)
// better-sqlite3 needs to be handled separately
console.log('Copying native modules...');
cpSync(
  join(backendDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  join(binariesDir, 'better_sqlite3.node')
);

console.log(`Backend packaged: ${outputName}`);
```

**Note on `better-sqlite3`:** Native Node.js addons (`.node` files) cannot be bundled into the `pkg` binary. They must be shipped alongside the sidecar. The backend's `database.ts` may need a small patch to resolve the native module path relative to the binary location in production mode.

### 1B.2: Backend production path resolution

The backend needs to know where its data directory, migrations, and native modules are when running as a sidecar vs. in development. Add an environment-based resolver:

Modify `packages/backend/src/config.ts`:

```typescript
// Add sidecar-aware path resolution
function resolveDataDir(): string {
  // When running as sidecar, TAURI_DATA_DIR is set by the Rust host
  if (process.env.TAURI_DATA_DIR) {
    return process.env.TAURI_DATA_DIR;
  }
  // Development: use project root data/
  return path.resolve(__dirname, '../../data');
}

function resolveMigrationsDir(): string {
  if (process.env.TAURI_RESOURCE_DIR) {
    return path.join(process.env.TAURI_RESOURCE_DIR, 'migrations');
  }
  return path.resolve(__dirname, '../migrations');
}
```

### 1B.3: Add `@yao-pkg/pkg` dev dependency

Add to `packages/desktop/package.json` devDependencies:
```json
{
  "devDependencies": {
    "@yao-pkg/pkg": "^6.0.0",
    "@tauri-apps/cli": "^2.0.0",
    "tsx": "^4.0.0"
  }
}
```

**Files created**: `packages/desktop/scripts/package-backend.ts`
**Files modified**: `packages/backend/src/config.ts`, `packages/desktop/package.json`

---

## Phase 1C: Rust Core — Sidecar Management

### 1C.1: Cargo dependencies

`packages/desktop/src-tauri/Cargo.toml`:
```toml
[package]
name = "mc-server-manager"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-process = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
log = "0.4"
```

### 1C.2: Sidecar lifecycle management

`packages/desktop/src-tauri/src/lib.rs`:

```rust
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::sync::Mutex;

struct AppState {
    backend_child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();

    // Resolve data directory (platform-appropriate app data location)
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data dir");
    std::fs::create_dir_all(&data_dir)?;

    let sidecar = shell
        .sidecar("binaries/mc-server-backend")
        .expect("Failed to create sidecar command")
        .env("TAURI_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("NODE_ENV", "production")
        .env("PORT", "3001");

    let (mut rx, child) = sidecar.spawn()?;

    // Store child handle for cleanup
    let state = app.state::<AppState>();
    *state.backend_child.lock().unwrap() = Some(child);

    // Forward sidecar stdout/stderr to Tauri logs
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(
                        "Backend process terminated: code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                    // TODO: Auto-restart logic or notify frontend
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            backend_child: Mutex::new(None),
        })
        .setup(|app| {
            spawn_backend(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // On close request: minimize to system tray instead of quitting
            // (implement in Phase 1E)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 1C.3: Graceful shutdown

The backend must shut down cleanly when the Tauri app exits. This is critical because the backend manages Minecraft server child processes — orphaned processes are a known risk (see PLAN.md Risk #3).

Add to `lib.rs`:

```rust
// In the Builder chain:
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle();
        let state = app.state::<AppState>();

        if let Some(child) = state.backend_child.lock().unwrap().take() {
            log::info!("Shutting down backend sidecar...");
            // Send SIGTERM (Unix) or taskkill (Windows)
            let _ = child.kill();
        }
    }
})
```

**Note**: The Express backend already handles SIGTERM by gracefully stopping all MC servers (implemented in current codebase). The sidecar kill signal triggers that existing shutdown path.

**Files created**: `packages/desktop/src-tauri/src/lib.rs`, `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src-tauri/Cargo.toml`

---

## Phase 1D: Frontend Tauri Integration

### 1D.1: Tauri API detection

The frontend should work both in a browser (for development without Tauri) and inside the Tauri WebView. Add a detection utility:

Create `packages/frontend/src/utils/tauri.ts`:

```typescript
/**
 * Returns true if running inside a Tauri WebView.
 */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
```

### 1D.2: API client base URL

Currently the frontend assumes the backend is at the same origin (Vite proxy). In Tauri, the WebView loads from `tauri://localhost` (production) or `http://localhost:5173` (dev), but the backend is always at `http://localhost:3001`.

Modify `packages/frontend/src/api/client.ts`:

```typescript
import { isTauri } from '../utils/tauri';

function getBaseUrl(): string {
  if (isTauri()) {
    // In Tauri, always connect directly to the backend sidecar
    return 'http://localhost:3001';
  }
  // In browser dev mode, use Vite proxy (relative URLs)
  return '';
}

export const BASE_URL = getBaseUrl();
```

Update all fetch calls and WebSocket URLs to use `BASE_URL`.

### 1D.3: WebSocket URL update

Modify `packages/frontend/src/api/ws.ts`:

```typescript
import { isTauri } from '../utils/tauri';

function getWsUrl(): string {
  if (isTauri()) {
    return 'ws://localhost:3001/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
```

### 1D.4: Backend readiness check

When Tauri launches, the backend sidecar takes a moment to start. The frontend should wait for the backend to be ready before rendering.

Create `packages/frontend/src/utils/wait-for-backend.ts`:

```typescript
export async function waitForBackend(
  url: string = 'http://localhost:3001/api/system/info',
  maxAttempts: number = 30,
  intervalMs: number = 500
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Backend not ready yet
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Backend failed to start within timeout');
}
```

Wire this into `main.tsx`:

```typescript
import { isTauri } from './utils/tauri';
import { waitForBackend } from './utils/wait-for-backend';

async function init() {
  if (isTauri()) {
    // Show splash/loading state while backend starts
    await waitForBackend();
  }
  // Render React app
  createRoot(document.getElementById('root')!).render(<App />);
}

init();
```

**Files created**: `packages/frontend/src/utils/tauri.ts`, `packages/frontend/src/utils/wait-for-backend.ts`
**Files modified**: `packages/frontend/src/api/client.ts`, `packages/frontend/src/api/ws.ts`, `packages/frontend/src/main.tsx`

---

## Phase 1E: System Tray & Window Management

### 1E.1: System tray icon

The app should minimize to the system tray rather than closing when the user clicks the window close button. MC servers may be running in the background.

Add to `lib.rs` setup:

```rust
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Manager,
};

// In setup():
let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

let menu = MenuBuilder::new(app)
    .item(&show_item)
    .separator()
    .item(&quit_item)
    .build()?;

let _tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .tooltip("MC Server Manager")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "quit" => {
            // Gracefully shutdown backend before quitting
            let state = app.state::<AppState>();
            if let Some(child) = state.backend_child.lock().unwrap().take() {
                let _ = child.kill();
            }
            app.exit(0);
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    })
    .build(app)?;
```

### 1E.2: Close-to-tray behavior

```rust
// In Builder chain, replace the on_window_event from 1C.3:
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Hide window instead of closing (minimize to tray)
        let _ = window.hide();
        api.prevent_close();
    }
})
```

**Files modified**: `packages/desktop/src-tauri/src/lib.rs`

---

## Phase 1F: Development Workflow

### 1F.1: Root dev scripts

Update root `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev -w backend\" \"npm run dev -w frontend\"",
    "dev:desktop": "concurrently \"npm run dev -w backend\" \"npm run dev -w desktop\"",
    "build": "npm run build -w shared && npm run build -w backend && npm run build -w frontend",
    "build:desktop": "npm run build -w shared && npm run package-backend -w desktop && npm run build -w desktop"
  }
}
```

**Development workflows:**
- `npm run dev` — Browser-only development (existing workflow, unchanged)
- `npm run dev:desktop` — Tauri desktop development (backend + Tauri/WebView)

### 1F.2: Tauri dev configuration

During `tauri dev`, the flow is:
1. `beforeDevCommand` starts Vite dev server (`npm run dev -w frontend`)
2. Tauri compiles the Rust code
3. Tauri spawns the sidecar (backend) — but in dev mode, we run it separately via `concurrently`
4. WebView loads from `devUrl` (Vite at localhost:5173)

For development, the backend sidecar spawn should be **optional** — the developer may already have `npm run dev -w backend` running. Add a dev-mode check:

```rust
// In setup():
if std::env::var("TAURI_DEV_BACKEND_EXTERNAL").is_err() {
    spawn_backend(app.handle())?;
}
```

Set `TAURI_DEV_BACKEND_EXTERNAL=1` when running backend separately.

**Files modified**: `package.json` (root)

---

## Phase 1G: App Icons & Branding

### 1G.1: Generate app icons

Tauri requires icons in multiple sizes and formats. Use `@tauri-apps/cli`'s icon generator:

```bash
npx @tauri-apps/cli icon path/to/source-icon.png
```

This generates:
- `icons/32x32.png`
- `icons/128x128.png`
- `icons/128x128@2x.png`
- `icons/icon.icns` (macOS)
- `icons/icon.ico` (Windows)
- `icons/icon.png` (Linux)

Place in `packages/desktop/src-tauri/icons/`.

### 1G.2: Loading screen

While the backend sidecar starts, show a lightweight loading indicator. The frontend already has a `waitForBackend()` call — add a simple loading UI in `index.html` that gets replaced when React mounts:

```html
<!-- In packages/frontend/index.html -->
<div id="root">
  <div id="app-loading" style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:system-ui;">
    <div style="text-align:center">
      <div style="font-size:24px;font-weight:600;margin-bottom:8px">MC Server Manager</div>
      <div style="font-size:14px;opacity:0.6">Starting...</div>
    </div>
  </div>
</div>
```

React's `createRoot().render()` replaces the loading div automatically.

**Files created**: `packages/desktop/src-tauri/icons/` (generated)
**Files modified**: `packages/frontend/index.html`

---

## Phase 1H: Production Build & Distribution

### 1H.1: Build pipeline

The production build order is:

1. Build shared types: `npm run build -w shared`
2. Build backend: `npm run build -w backend`
3. Package backend into binary: `npm run package-backend -w desktop`
4. Build frontend: `npm run build -w frontend`
5. Build Tauri app: `npm run build -w desktop`

Step 5 (`tauri build`) handles:
- Compiling the Rust core
- Bundling the frontend dist
- Including the backend sidecar binary
- Generating platform installers

### 1H.2: Output artifacts

Tauri generates platform-specific installers:

| Platform | Artifact | Location |
|----------|----------|----------|
| Windows | `.msi`, `.exe` (NSIS) | `src-tauri/target/release/bundle/msi/` |
| macOS | `.dmg`, `.app` | `src-tauri/target/release/bundle/dmg/` |
| Linux | `.deb`, `.AppImage` | `src-tauri/target/release/bundle/deb/`, `appimage/` |

### 1H.3: GitHub Actions CI (initial, not fully wired)

A basic CI config for building on all platforms. This can be refined later but is worth setting up early:

Create `.github/workflows/build-desktop.yml`:

```yaml
name: Build Desktop App
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev
      - run: npm ci
      - run: npm run build:desktop
      - uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.target }}
          path: packages/desktop/src-tauri/target/release/bundle/**/*
```

**Files created**: `.github/workflows/build-desktop.yml`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **1A** (scaffolding) | ~2h | Tauri project structure, config, Rust skeleton |
| 2 | **1B** (sidecar packaging) | ~3h | Backend packaged as binary, path resolution |
| 3 | **1C** (Rust core) | ~3h | Sidecar spawn/kill, lifecycle management |
| 4 | **1D** (frontend integration) | ~2h | Tauri detection, direct API URLs, backend readiness |
| 5 | **1E** (tray & window) | ~2h | System tray, minimize-to-tray, quit handling |
| 6 | **1F** (dev workflow) | ~1h | Dev scripts, external backend mode |
| 7 | **1G** (icons & branding) | ~1h | App icons, loading screen |
| 8 | **1H** (production build) | ~3h | Build pipeline, CI, installers |

**Total: ~17 hours**

---

## Complete File Change Summary

### New Files (10+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/desktop/package.json` | 1A | Desktop workspace package |
| `packages/desktop/src-tauri/tauri.conf.json` | 1A | Tauri configuration |
| `packages/desktop/src-tauri/Cargo.toml` | 1A | Rust dependencies |
| `packages/desktop/src-tauri/capabilities/default.json` | 1A | Security permissions |
| `packages/desktop/src-tauri/src/lib.rs` | 1C | Sidecar management, tray, commands |
| `packages/desktop/src-tauri/src/main.rs` | 1C | Entry point |
| `packages/desktop/scripts/package-backend.ts` | 1B | Backend binary packaging |
| `packages/frontend/src/utils/tauri.ts` | 1D | Tauri environment detection |
| `packages/frontend/src/utils/wait-for-backend.ts` | 1D | Backend readiness polling |
| `.github/workflows/build-desktop.yml` | 1H | CI build for all platforms |

### Modified Files (5)

| File | Phase | Changes |
|------|-------|---------|
| `package.json` (root) | 1A, 1F | Add desktop workspace, dev:desktop and build:desktop scripts |
| `packages/backend/src/config.ts` | 1B | Sidecar-aware path resolution (TAURI_DATA_DIR, TAURI_RESOURCE_DIR) |
| `packages/frontend/src/api/client.ts` | 1D | Use BASE_URL from Tauri detection |
| `packages/frontend/src/api/ws.ts` | 1D | Direct WS URL in Tauri mode |
| `packages/frontend/src/main.tsx` | 1D | Wait for backend before render |
| `packages/frontend/index.html` | 1G | Loading screen placeholder |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| `better-sqlite3` native addon won't bundle with `pkg` | Ship `.node` file alongside sidecar. Patch require path. Test on all 3 platforms. Consider `sql.js` (WASM) as fallback if native module issues are intractable. |
| Backend sidecar crashes silently | Log all stdout/stderr from sidecar in Rust. Implement health check ping. Show error in frontend if backend becomes unreachable. |
| WebView CSP blocks backend connections | Explicit CSP in `tauri.conf.json` allows `localhost:3001`. Test thoroughly in production build (dev mode is more permissive). |

### Medium

| Risk | Mitigation |
|------|------------|
| Different `better-sqlite3` binary needed per platform/arch | Build matrix in CI. Pre-built binaries available from `prebuild-install`. |
| Port 3001 already in use on user's machine | Add port conflict detection at startup. Allow configurable port via settings. |
| Backend startup too slow (>15s) | `waitForBackend` has 30 attempts × 500ms = 15s timeout. If slow: show progress, optimize backend startup (lazy-load modules). |
| Linux WebKitGTK version varies | Document minimum WebKitGTK version requirement. Tauri handles gracefully with clear error. |

### Low

| Risk | Mitigation |
|------|------------|
| Auto-update not yet wired | `createUpdaterArtifacts: true` is set but endpoints aren't configured. This is future work (Phase B distribution). |
| App size with bundled Node.js binary | `pkg` output is ~50-80MB. Tauri's compression helps. Acceptable for a desktop app. |

---

## Testing Checklist

1. **Dev workflow**: `npm run dev:desktop` starts Tauri window with live-reload frontend
2. **Backend sidecar**: Backend auto-starts, API responds, WebSocket connects
3. **Graceful shutdown**: Closing app stops backend, which stops any running MC servers
4. **System tray**: Close button minimizes to tray, tray click restores, "Quit" exits fully
5. **Production build**: `npm run build:desktop` produces working installer for current platform
6. **Cross-platform**: Build and run on Windows, macOS, Linux (via CI or manual)
7. **Backend crash recovery**: Kill the sidecar process — frontend shows error, doesn't crash
8. **Port conflict**: Start two instances — second should show clear error
