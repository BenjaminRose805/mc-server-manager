# Technology Stack

<!--
  MC Server Manager -- Tech Steering Template
  
  This template is pre-seeded with the actual tech stack.
  When creating the steering doc, verify versions are current and
  update any decisions that have changed.
-->

## Project Type

Self-hosted web + desktop application. Monorepo with 4 npm workspace packages: backend (API server), frontend (React SPA), electron (desktop wrapper), shared (TypeScript types).

## Core Technologies

### Primary Language
- **Language**: TypeScript 5.7+ (strict mode everywhere)
- **Runtime**: Node.js (ES2022 target)
- **Module System**: ES Modules (`.js` extensions required in backend imports)

### Backend (`packages/backend/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| Express | 4.x | HTTP API server |
| ws | 8.x | WebSocket server (single endpoint: `/ws`) |
| better-sqlite3 | 12.x | SQLite database (synchronous API, WAL mode) |
| Zod | 3.x | Request validation (all route handlers) |
| Pino | 9.x | Structured logging |
| nanoid | 5.x | ID generation |
| argon2 | - | Password hashing (argon2id) |
| jsonwebtoken | - | JWT access tokens (HS256, 15min expiry) |
| express-rate-limit | - | Rate limiting |
| helmet | - | Security headers |
| cors | - | CORS configuration |

### Frontend (`packages/frontend/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.x | UI framework |
| Vite | 6.x | Build tool + dev server (port 5173, proxies to backend) |
| Tailwind CSS | 4.x | Styling (dark theme: slate-800/900) |
| Zustand | 5.x | State management (stores write directly from WS events) |
| React Router | 7.x | Client-side routing |
| @tanstack/react-virtual | - | Virtualized list rendering (console, message lists) |
| lucide-react | 0.563.x | Icons |
| sonner | 2.x | Toast notifications |

### Electron (`packages/electron/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| Electron | 33.x | Desktop shell (window, tray, backend lifecycle) |
| electron-builder | 25.x | Desktop packaging (Windows, macOS, Linux) |
| safeStorage API | built-in | OS-level credential encryption |
| contextBridge | built-in | Secure IPC (contextIsolation: true, nodeIntegration: false) |

### Shared (`shared/`)

| Technology | Purpose |
|-----------|---------|
| TypeScript | Shared type definitions consumed by all packages |

[Update versions as dependencies are upgraded]

## Application Architecture

### Core Pattern

```
Routes (HTTP) --> Services (business logic) --> Models (SQLite)
                        |
                        +---> ServerManager --> ServerProcess (child_process.spawn)
                        +---> File I/O (server.properties, JARs)

WebSocket Server ---> Same services, different transport
```

- **Routes**: Express routers with Zod validation. Thin -- delegate to services.
- **Services**: Business logic singletons. The only layer that touches models.
- **Models**: Raw SQL with prepared statements via better-sqlite3. Map snake_case DB columns to camelCase TypeScript.
- **No ORM**: Intentional. Raw SQL is preferred for this project's complexity level.
- **No DI container**: Services are singletons imported directly. No IoC framework.

### State Management

- **Backend**: Singleton `ServerManager` holds `Map<serverId, ServerProcess>`. In-memory presence via `PresenceManager` EventEmitter.
- **Frontend**: Zustand stores are the source of truth. WebSocket events write directly to store at module initialization.

### Real-time Communication

- Single WebSocket endpoint: `ws://localhost:3001/ws`
- Auth via first message: `{ type: 'auth', token: '...' }` (NOT query params)
- Client -> Server: `subscribe`, `unsubscribe`, `command`, `chat:send`, `chat:typing`
- Server -> Client: `console`, `console:history`, `status`, `stats`, `error`, `chat:message`, `chat:typing`, `presence:update`, `friend:*`
- All messages JSON with `type` discriminator field

### Authentication Flow

```
Setup (first user) or Register (invite code) or Login
  --> JWT access token (15min, HS256) + refresh token (30 days, SHA-256 hashed in DB)
  --> Access token in Authorization header for REST
  --> Access token sent as first WS message for WebSocket
  --> Auto-refresh 1 minute before expiry via React AuthContext
  --> Single-user mode: skip all auth if no users exist in DB
```

## Data Storage

- **Primary**: SQLite via better-sqlite3 (file: `data/mc-manager.db`)
- **Mode**: WAL (Write-Ahead Logging) for concurrent read/write
- **Migrations**: Numbered SQL files in `packages/backend/migrations/` (001-NNN)
- **Credentials**: Encrypted via Electron safeStorage in `{userData}/secure-storage.json`
- **Server files**: `data/servers/{nanoid}/` (server.properties, JARs, world data)

## Development Environment

### Build & Dev

```bash
npm install                    # Install all workspace dependencies
npm run dev                    # Both servers concurrently
npm run dev -w backend         # tsx watch on port 3001
npm run dev -w frontend        # Vite on port 5173
npm run build                  # shared -> backend -> frontend (order matters)
npm run build -w shared        # Must build first (TypeScript project references)
```

### Code Quality

- **TypeScript**: Strict mode, `tsconfig.base.json` shared config
- **No linter configured**: (consider adding ESLint in future)
- **No formatter configured**: (consider adding Prettier in future)
- **No automated tests**: All testing is manual. This is a known gap.

### Version Control
- **VCS**: Git
- **Branching**: Feature branches off main
- **Commit style**: Conventional-ish (no strict enforcement)

## Technical Decisions & Rationale

### Decision Log

1. **stdin for MC commands (not RCON)**: Universal across all server types. RCON requires additional setup and doesn't work with all server JARs.

2. **Ring buffer (1000 lines) for console**: Avoids unbounded memory. Minecraft can emit hundreds of lines/sec during world generation. Combined with @tanstack/react-virtual for efficient rendering.

3. **better-sqlite3 (synchronous) over async alternatives**: Simplicity. WAL mode handles concurrent reads. The app is single-process Node.js, not a distributed system.

4. **Zustand over Redux/Context**: Minimal boilerplate. Direct store mutations from WS events at module level (no React tree dependency). Perfect for the event-driven architecture.

5. **No ORM**: Raw SQL is simpler for this project's scale. Prepared statements + thin model functions provide enough abstraction.

6. **Electron over Tauri**: Single language (TypeScript). Tauri was removed because maintaining Rust alongside TypeScript doubled the toolchain complexity. Electron's safeStorage provides equivalent OS-level encryption.

7. **JWT + refresh tokens over sessions-only**: Stateless access tokens reduce DB lookups on every request. Refresh tokens in DB allow revocation. 15-minute access token expiry limits exposure from token theft.

8. **No external auth providers (yet)**: Self-hosted philosophy. Microsoft auth is only for Minecraft account linking (game launching), not for app login.

[Update as new architectural decisions are made]

## Known Limitations

- **No automated tests**: All verification is manual or build-based. High-risk area.
- **Single-node only**: The app assumes one machine. No clustering, no distributed state.
- **SQLite concurrency**: WAL mode helps but won't scale to hundreds of concurrent writers.
- **No hot reload for Electron**: Changes to main process require restart.
- **Console buffer is volatile**: 1000-line ring buffer is lost on server restart. No persistent logging.

[Update as limitations are addressed or new ones discovered]
