# Project Structure

## Directory Organization

```
mc-server-manager/
├── package.json                 # Root workspace config, dev/build/lint scripts
├── tsconfig.base.json           # Shared TS config (ES2022, strict, bundler resolution)
├── AGENTS.md                    # AI agent instructions (project overview, conventions)
├── PLAN.md                      # Architecture document and phased build plan
│
├── packages/
│   ├── backend/                 # Express + WebSocket API server
│   │   ├── package.json
│   │   ├── tsconfig.json        # References shared/
│   │   ├── AGENTS.md            # Backend-specific AI instructions
│   │   ├── migrations/          # Numbered SQL files (001-009)
│   │   │   ├── 001_initial.sql          # servers table
│   │   │   ├── 002_settings.sql         # settings key-value store
│   │   │   ├── 003_mods.sql             # installed_mods table
│   │   │   ├── 004_mod_side.sql         # mod side field
│   │   │   ├── 005_modpacks.sql         # modpack tracking
│   │   │   ├── 006_launcher_instances.sql  # game instances
│   │   │   ├── 007_launcher_accounts.sql   # Microsoft accounts
│   │   │   ├── 008_client_mods.sql      # client mod support (instance_id)
│   │   │   └── 009_multi_user.sql       # users, invitations, refresh_tokens, server_permissions
│   │   └── src/
│   │       ├── index.ts         # HTTP/HTTPS server creation, WS setup, startup
│   │       ├── app.ts           # Express app: middleware + route mounting
│   │       ├── config.ts        # Environment config (port, host, TLS, data dir)
│   │       ├── db.ts            # Database singleton (better-sqlite3 init + migrations)
│   │       ├── routes/          # Express routers (one file per domain)
│   │       │   ├── servers.ts           # /api/servers/* CRUD + start/stop/command
│   │       │   ├── auth.ts              # /api/auth/* setup/register/login/refresh/logout
│   │       │   ├── users.ts             # /api/users/* profile + admin management
│   │       │   ├── invitations.ts       # /api/invitations/* CRUD
│   │       │   ├── launcher.ts          # /api/launcher/* instances/prepare/java
│   │       │   ├── mods.ts              # /api/servers/:id/mods/* server mod management
│   │       │   ├── instance-mods.ts     # /api/launcher/instances/:id/mods/* client mods
│   │       │   ├── modpacks.ts          # /api/modpacks/* import/export
│   │       │   ├── versions.ts          # /api/versions/* Mojang version manifest
│   │       │   ├── downloads.ts         # /api/downloads/* JAR download jobs
│   │       │   ├── system.ts            # /api/system/* Java, info, settings
│   │       │   ├── acme.ts              # /api/acme/* Let's Encrypt challenges
│   │       │   ├── logs.ts              # /api/servers/:id/logs
│   │       │   ├── client-logs.ts       # POST /api/log (frontend log ingestion)
│   │       │   └── validation.ts        # Shared Zod schemas
│   │       ├── services/        # Business logic singletons
│   │       │   ├── server-manager.ts    # Core: ServerProcess orchestrator
│   │       │   ├── process.ts           # ServerProcess class (child_process.spawn)
│   │       │   ├── console-buffer.ts    # Ring buffer (1000 lines)
│   │       │   ├── auth.ts              # Password hashing (argon2id)
│   │       │   ├── jwt.ts              # JWT generation/verification
│   │       │   ├── session.ts           # Refresh token lifecycle
│   │       │   ├── brute-force.ts       # Login attempt tracking
│   │       │   ├── database.ts          # DB init + migration runner
│   │       │   ├── settings.ts          # App settings service
│   │       │   ├── java.ts              # Java detection + Adoptium download
│   │       │   ├── tls.ts              # TLS/HTTPS (Let's Encrypt, self-signed)
│   │       │   ├── upnp.ts             # UPnP port forwarding
│   │       │   ├── mod-manager.ts       # Mod CRUD + Modrinth API
│   │       │   ├── mod-loader-service.ts # Fabric/Forge loader installation
│   │       │   ├── mod-jar-inspector.ts # JAR metadata extraction (fabric.mod.json, etc.)
│   │       │   ├── modpack-manager.ts   # .mrpack import/export
│   │       │   ├── modpack-parser.ts    # Modpack format parsing
│   │       │   ├── modpack-update-checker.ts # Modpack version checking
│   │       │   ├── search-orchestrator.ts # Modrinth search coordination
│   │       │   ├── instance-service.ts  # Game instance management
│   │       │   ├── version-service.ts   # Minecraft version resolution
│   │       │   ├── library-service.ts   # Game library downloads
│   │       │   ├── asset-service.ts     # Game asset downloads
│   │       │   ├── download.ts          # JAR download with progress
│   │       │   ├── event-bus.ts         # Internal event bus
│   │       │   ├── server-setup.ts      # Server directory initialization
│   │       │   ├── properties.ts        # server.properties parser/writer
│   │       │   └── versions.ts          # Mojang version manifest cache
│   │       ├── models/          # Raw SQL data access (prepared statements)
│   │       │   ├── server.ts            # servers table CRUD
│   │       │   ├── user.ts              # users table CRUD
│   │       │   ├── invitation.ts        # invitations table CRUD
│   │       │   ├── server-permission.ts # server_permissions table CRUD
│   │       │   ├── mod.ts               # installed_mods table CRUD
│   │       │   ├── modpack.ts           # modpack tracking
│   │       │   ├── instance.ts          # launcher instances table CRUD
│   │       │   └── account.ts           # launcher accounts table CRUD
│   │       ├── middleware/      # Express middleware
│   │       │   ├── auth.ts              # requireAuth, requireRole, requireServerPermission
│   │       │   ├── rate-limit.ts        # Rate limiting rules
│   │       │   ├── cors-config.ts       # CORS configuration
│   │       │   └── security.ts          # Helmet security headers
│   │       ├── utils/           # Utilities
│   │       │   ├── errors.ts            # AppError, NotFoundError, ConflictError, etc.
│   │       │   └── logger.ts            # Pino logger (stdout + file via pino-roll)
│   │       └── ws/              # WebSocket handlers
│   │
│   ├── frontend/                # React SPA
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── AGENTS.md            # Frontend-specific AI instructions
│   │   ├── vite.config.ts       # Proxy /api and /ws to backend port 3001
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx         # Entry: providers (AuthProvider), render
│   │       ├── App.tsx          # Routing: React Router, ProtectedRoute wrapping
│   │       ├── index.css        # Single line: @import "tailwindcss"
│   │       ├── pages/           # Page components (default exports)
│   │       │   ├── Dashboard.tsx        # Server grid with status cards
│   │       │   ├── ServerDetail.tsx     # Tabbed: Console, Settings, Mods
│   │       │   ├── CreateServer.tsx     # 4-step creation wizard
│   │       │   ├── Mods.tsx             # Mod search/browse (Modrinth)
│   │       │   ├── Launcher.tsx         # Game instances overview
│   │       │   ├── InstanceDetail.tsx   # Instance config + launch
│   │       │   ├── Login.tsx            # Login form
│   │       │   ├── Register.tsx         # Invite code registration
│   │       │   ├── Setup.tsx            # First-run owner account creation
│   │       │   ├── Admin.tsx            # User/invitation management
│   │       │   └── AppSettings.tsx      # App configuration
│   │       ├── components/      # Reusable components (named exports)
│   │       │   ├── Layout.tsx           # Sidebar + main content shell
│   │       │   ├── Console.tsx          # Virtualized terminal + command input
│   │       │   ├── ServerCard.tsx       # Dashboard status card
│   │       │   ├── ServerControls.tsx   # Start/Stop/Restart/Kill buttons
│   │       │   ├── ServerStats.tsx      # Real-time stats display
│   │       │   ├── StatusBadge.tsx      # Colored status indicator
│   │       │   ├── PropertiesForm.tsx   # server.properties grouped editor
│   │       │   ├── ModList.tsx          # Mod listing component
│   │       │   ├── ModFilterBar.tsx     # Mod search/filter controls
│   │       │   ├── mod-badges.tsx       # Mod status badges
│   │       │   ├── LogViewer.tsx        # Log display component
│   │       │   ├── DeleteServerDialog.tsx # Confirmation dialog
│   │       │   ├── ErrorBoundary.tsx    # Global error boundary
│   │       │   ├── ProtectedRoute.tsx   # Auth guard for routes
│   │       │   └── launcher/            # Game launcher components
│   │       │       ├── AccountManager.tsx       # Microsoft account management
│   │       │       ├── LaunchButton.tsx          # Game launch button
│   │       │       ├── InstanceCard.tsx          # Instance preview card
│   │       │       ├── InstanceGrid.tsx          # Instance grid layout
│   │       │       ├── CreateInstanceWizard.tsx  # Instance creation flow
│   │       │       └── DownloadProgress.tsx      # Download progress bar
│   │       ├── stores/          # Zustand stores
│   │       │   └── serverStore.ts       # Server state + WS event wiring
│   │       ├── api/             # API clients + WebSocket
│   │       │   ├── client.ts            # Fetch wrapper (BASE_URL, auth headers)
│   │       │   ├── ws.ts               # WebSocket singleton + auto-reconnect
│   │       │   ├── auth.ts             # Auth API (setup, login, register, refresh)
│   │       │   ├── users.ts            # User management API
│   │       │   └── invitations.ts      # Invitation API
│   │       ├── contexts/        # React contexts
│   │       │   └── AuthContext.tsx       # Auth state, token refresh, login/logout
│   │       ├── utils/           # Utility functions
│   │       │   ├── desktop.ts           # isDesktop(), getBackendBaseUrl() (Electron detection)
│   │       │   ├── logger.ts            # Browser logger (console + batch POST to /api/log)
│   │       │   └── ...
│   │       ├── types/           # Ambient type declarations
│   │       │   └── electron.d.ts        # window.electronAPI interface
│   │       ├── hooks/           # Custom React hooks
│   │       │   └── useConsole.ts        # Per-server WS subscription lifecycle
│   │       └── lib/
│   │           └── utils.ts             # cn() utility (clsx + tailwind-merge)
│   │
│   └── electron/                # Electron desktop app
│       ├── package.json         # electron-builder config embedded
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts          # Window creation, tray, backend lifecycle, shutdown
│           ├── preload.ts       # contextBridge: exposes electronAPI to renderer
│           ├── ipc.ts           # ipcMain.handle registration for all channels
│           ├── tray.ts          # System tray setup
│           ├── auth.ts          # Microsoft OAuth device code flow (ported from Rust)
│           ├── launcher.ts      # Minecraft game process spawning + tracking
│           └── secure-storage.ts # safeStorage encryption for credentials
│
├── shared/                      # Shared TypeScript types
│   ├── package.json             # @mc-server-manager/shared
│   ├── tsconfig.json
│   └── src/
│       └── index.ts             # ALL shared types, interfaces, constants, utilities
│
├── data/                        # Runtime data (gitignored)
│   ├── mc-manager.db            # SQLite database
│   ├── logs/                    # Application log files
│   │   ├── app.log              # Current log (backend + frontend, JSON format)
│   │   └── app.{1-7}.log       # Rotated daily, 7-day retention
│   └── servers/                 # Individual MC server directories (nanoid-named)
│
├── plans/                       # Architecture planning documents
│   └── EPIC-*.md
│
└── .spec-workflow/              # Spec workflow system
    ├── templates/               # Default templates (auto-managed)
    ├── user-templates/          # Custom project-specific templates
    ├── steering/                # Product/tech/structure steering docs
    │   ├── product.md
    │   ├── tech.md
    │   └── structure.md
    └── specs/                   # Feature specifications
        └── {spec-name}/
            ├── requirements.md
            ├── design.md
            ├── tasks.md
            └── Implementation Logs/
```

## Naming Conventions

### Files
- **All source files**: `kebab-case.ts` / `kebab-case.tsx` (e.g., `server-manager.ts`, `console-buffer.ts`)
- **React pages**: `PascalCase.tsx` (e.g., `Dashboard.tsx`, `ServerDetail.tsx`) -- default exports
- **React components**: `PascalCase.tsx` (e.g., `AccountManager.tsx`) -- named exports
- **Exception**: `mod-badges.tsx` uses kebab-case (lowercase component file)
- **Migrations**: `NNN_description.sql` (e.g., `001_initial.sql`, `009_multi_user.sql`)
- **Types**: Declared in `shared/src/index.ts`, not in separate `.d.ts` files (except `electron.d.ts` for ambient window types)

### Code
- **Interfaces/Types**: `PascalCase` (e.g., `ServerProcess`, `LauncherAccount`)
- **Functions/Variables**: `camelCase` (e.g., `detectJava`, `serverManager`)
- **Constants**: `UPPER_SNAKE_CASE` for true constants (e.g., `MS_CLIENT_ID`), `camelCase` for configured values
- **Database columns**: `snake_case` (e.g., `created_at`, `server_id`, `is_active`)
- **API routes**: `kebab-case` (e.g., `/api/servers/:id/properties`, `/api/auth/logout-all`)
- **WebSocket message types**: `colon:separated` (e.g., `chat:send`, `presence:update`)
- **IPC channels**: `kebab-case` (e.g., `ms-auth-start`, `launch-game`)

## Import Patterns

### Import Order (all packages)
1. Node.js built-ins (`node:fs`, `node:path`, `node:crypto`)
2. External dependencies (`express`, `zod`, `pino`)
3. Workspace packages (`@mc-server-manager/shared`)
4. Internal absolute imports (`@/utils/...` in frontend via Vite alias)
5. Relative imports (`./errors.js`, `../models/user.js`)

### Backend-specific
- **`.js` extensions required** in all relative imports (ES module resolution)
- Example: `import { db } from '../db.js'` NOT `import { db } from '../db'`

### Frontend-specific
- **`@/` alias** maps to `src/` (configured in Vite)
- Example: `import { isDesktop } from '@/utils/desktop'`
- No `.js` extensions needed (Vite handles resolution)

### Shared package
- Import as: `import type { ServerProcess } from '@mc-server-manager/shared'`
- Use `import type` when importing only types (tree-shaking friendly)

## Code Structure Patterns

### Backend Route File
```typescript
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireAdminOrOwner } from '../middleware/auth.js'
import { someService } from '../services/some-service.js'

const router = Router()

const createSchema = z.object({
  name: z.string().min(1).max(100),
})

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body)
    const result = someService.create(data)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

export default router
```

### Backend Model File
```typescript
import { db } from '../db.js'
import { nanoid } from 'nanoid'
import type { SomeType } from '@mc-server-manager/shared'

export function createSomething(data: CreateInput): SomeType {
  const id = nanoid()
  const stmt = db.prepare(`INSERT INTO table_name (id, field) VALUES (?, ?)`)
  stmt.run(id, data.field)
  return getSomethingById(id)!
}

export function getSomethingById(id: string): SomeType | null {
  const stmt = db.prepare(`SELECT * FROM table_name WHERE id = ?`)
  const row = stmt.get(id) as any
  if (!row) return null
  return {
    id: row.id,
    fieldName: row.field_name,  // snake_case -> camelCase mapping
    createdAt: row.created_at,
  }
}
```

### Frontend Zustand Store
```typescript
import { create } from 'zustand'
import type { SomeType } from '@mc-server-manager/shared'

interface SomeStore {
  items: SomeType[]
  activeId: string | null
  setItems: (items: SomeType[]) => void
  addItem: (item: SomeType) => void
  setActive: (id: string | null) => void
}

export const useSomeStore = create<SomeStore>((set) => ({
  items: [],
  activeId: null,
  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  setActive: (activeId) => set({ activeId }),
}))
```

### Frontend Page
```typescript
import { useEffect, useState } from 'react'
import { SomeComponent } from '@/components/some/SomeComponent'
import { fetchItems } from '@/api/some'

export default function SomePage() {
  const [items, setItems] = useState([])

  useEffect(() => {
    fetchItems().then(setItems)
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-4">Page Title</h1>
      <SomeComponent items={items} />
    </div>
  )
}
```

### Electron IPC Pattern
```typescript
// Main process (ipc.ts): register handler
ipcMain.handle('some-action', async (event, arg1: string) => {
  return await doSomething(arg1)
})

// Preload (preload.ts): expose via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  someAction: (arg1: string) => ipcRenderer.invoke('some-action', arg1),
})

// Renderer (component): call via window.electronAPI
const result = await window.electronAPI.someAction('value')
```

## Module Boundaries

### Dependency Direction (strict)
```
shared/          <-- imported by all packages (types only, no runtime code)
  ^
packages/backend/   <-- never imports from frontend or electron
  ^
packages/frontend/  <-- never imports from backend or electron directly
  ^                     (communicates via HTTP/WS only)
packages/electron/  <-- imports from shared; calls backend via HTTP
                        exposes API to frontend via contextBridge
```

### Key Boundaries
- **Frontend -- Backend**: HTTP REST + WebSocket only. No shared runtime code.
- **Frontend -- Electron**: `window.electronAPI` via contextBridge only. No direct `require('electron')`.
- **Electron -- Backend**: HTTP fetch from main process. Backend doesn't know about Electron.
- **Services -- Routes**: Routes are thin; business logic lives in services.
- **Models -- Services**: Models are pure data access; no business logic in models.

## Code Size Guidelines

- **File size**: Aim for under 300 lines. Split if exceeding 500.
- **Function size**: Aim for under 50 lines. Extract helpers if exceeding 80.
- **Component size**: One component per file. Split into sub-components if the JSX exceeds 150 lines.
- **Route files**: One domain per file (servers.ts, auth.ts, users.ts). Split CRUD from specialized endpoints if the file gets large.

## Documentation Standards

- **No JSDoc required** on internal functions (TypeScript types serve as docs)
- **JSDoc on public/exported functions** that have non-obvious behavior
- **Inline comments** for "why", not "what" (the code says what, comments say why)
- **AGENTS.md** files are the primary documentation for AI agents (root + per-package)
- **No README.md files per package** -- AGENTS.md covers the whole project
