# AGENTS.md -- MC Server Manager

## Project Overview

MC Server Manager is a self-hosted web application for managing Minecraft Java Edition servers. It provides a browser-based dashboard to create, configure, start/stop, and monitor Minecraft servers running on the local machine.

**Current state:** Phase 1 MVP is implemented (single/multi-server management). No Phase 2+ features (backup, plugins, scheduled tasks) exist yet.

## Architecture

**Monorepo** using npm workspaces with three packages:

```
packages/backend/   -- Express + WebSocket API server (Node.js)
packages/frontend/  -- React SPA (Vite)
shared/             -- TypeScript type definitions shared by both
```

### Core Architecture Pattern

```
Routes (HTTP) --> Services (business logic) --> Models (SQLite)
                        |
                        +---> ServerManager --> ServerProcess (child_process.spawn)
                        +---> File I/O (server.properties, JARs)

WebSocket Server ---> Same services, different transport
```

- **Backend**: Express HTTP server + `ws` WebSocket server on port 3001
- **Frontend**: React SPA served by Vite dev server on port 5173 (proxies to backend)
- **Database**: SQLite via `better-sqlite3` (synchronous API, WAL mode)
- **Process management**: Java child processes spawned via `child_process.spawn`, managed by singleton `ServerManager` orchestrator

### Key Design Decisions

- **stdin for commands** (not RCON) -- universal across all server types
- **Ring buffer** (1000 lines) for console output -- avoids unbounded memory
- **Virtualized rendering** (@tanstack/react-virtual) for console UI
- **Zustand** for frontend state -- WebSocket events write directly to store
- **No ORM** -- raw SQL with prepared statements in a thin model layer
- **No test framework** -- automated tests do not exist yet

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | ES2022 target |
| Language | TypeScript | 5.7+ (strict mode) |
| Backend framework | Express | 4.x |
| WebSocket | ws | 8.x |
| Database | better-sqlite3 | 12.x |
| Validation | Zod | 3.x |
| Logging | Pino | 9.x |
| Frontend framework | React | 19.x |
| Build tool | Vite | 6.x |
| Styling | Tailwind CSS | 4.x |
| State management | Zustand | 5.x |
| Routing | React Router | 7.x |
| Icons | lucide-react | 0.563.x |
| Toasts | sonner | 2.x |
| IDs | nanoid | 5.x |

## Build & Run

```bash
# Install dependencies
npm install

# Development (both servers concurrently)
npm run dev

# Build (order matters: shared -> backend -> frontend)
npm run build

# Individual packages
npm run dev -w backend     # tsx watch on port 3001
npm run dev -w frontend    # vite on port 5173
npm run build -w shared    # tsc (must build first)
```

Build order is enforced via TypeScript project references: `shared` must be built before `backend`.

## Project Structure

```
package.json              -- Root workspace config, dev/build/lint scripts
tsconfig.base.json        -- Shared TS config (ES2022, strict, bundler resolution)
PLAN.md                   -- 621-line architecture document and phased build plan
packages/
  backend/                -- Express API server
  frontend/               -- React SPA
shared/                   -- Shared types package (@mc-server-manager/shared)
data/                     -- Runtime data directory (gitignored)
  servers/                -- Individual MC server directories (nanoid-named)
  mc-manager.db           -- SQLite database
```

## Conventions

### Code Style
- TypeScript strict mode everywhere
- ES modules (`.js` extensions in imports for backend)
- No default exports except React pages
- Interfaces over type aliases for object shapes
- Zod schemas for all request validation in routes

### Naming
- Files: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Variables/functions: `camelCase`
- Database columns: `snake_case`
- API routes: `kebab-case` (e.g., `/api/servers/:id/properties`)

### Error Handling
- Custom error classes in `packages/backend/src/utils/errors.ts` (AppError, NotFoundError, ConflictError, etc.)
- Express error middleware catches and formats these
- Frontend uses toast notifications (sonner) for user-facing errors

### State Management Pattern
- Backend: Singleton `ServerManager` holds `Map<serverId, ServerProcess>`
- Frontend: Single Zustand store (`serverStore.ts`) is the source of truth
- WebSocket events are wired to store mutations at module initialization
- The `useConsole` hook manages per-server WS subscription lifecycle

## Database

SQLite with 2 tables:
- `servers` -- CRUD for Minecraft server configurations (id, name, type, version, paths, port, JVM args)
- `settings` -- Key-value store for app-level settings

Migrations live in `packages/backend/migrations/` as numbered SQL files. A custom migration runner tracks applied migrations.

## WebSocket Protocol

Single endpoint: `ws://localhost:3001/ws`

Client -> Server: `subscribe`, `unsubscribe`, `command` (all with `serverId`)
Server -> Client: `console`, `console:history`, `status`, `stats`, `error`

All messages are JSON with a `type` discriminator field.

## Server Lifecycle State Machine

```
[stopped] --(start)--> [starting] --(Done line detected)--> [running]
[running] --(stop)---> [stopping] --(process exits)-------> [stopped]
[running] --(unexpected exit)----> [crashed]
```

Detection of "running" state: parses stdout for the `Done (X.XXXs)!` log line. Fallback timeout after 120s.

## API Routes

```
GET/POST          /api/servers           -- List / Create
GET/PATCH/DELETE  /api/servers/:id       -- Read / Update / Delete
POST              /api/servers/:id/start|stop|restart|kill
POST              /api/servers/:id/command
GET               /api/servers/:id/console
GET/PUT           /api/servers/:id/properties
GET               /api/system/java
GET               /api/system/info
GET               /api/system/settings
PUT               /api/system/settings
GET               /api/versions/vanilla
POST              /api/downloads
GET               /api/downloads/:jobId
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/backend/src/services/server-manager.ts` | Singleton orchestrator -- the core of the application |
| `packages/backend/src/services/process.ts` | ServerProcess class -- Java child process lifecycle |
| `packages/backend/src/services/console-buffer.ts` | Ring buffer for console output |
| `shared/src/index.ts` | All shared types, interfaces, constants, utilities |
| `packages/frontend/src/stores/serverStore.ts` | Zustand store + WS event wiring |
| `packages/frontend/src/api/ws.ts` | WebSocket client singleton with auto-reconnect |
| `PLAN.md` | Complete architecture document and build plan |

## Risk Areas

1. **Process lifecycle reliability** -- Servers can get into inconsistent states if process exit events are missed. The `ServerProcess` class is the most critical code.
2. **Console output volume** -- Minecraft can emit hundreds of lines/sec during world generation. Ring buffer + virtualized rendering mitigate this.
3. **Graceful shutdown** -- On SIGINT/SIGTERM, all running MC servers must be stopped. Orphan processes are possible if the manager crashes.
4. **No automated tests** -- All testing is currently manual. This is a significant gap.
