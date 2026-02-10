# AGENTS.md -- Backend Package

Express + WebSocket API server for MC Server Manager. This is the core of the application -- it manages Minecraft server processes, exposes REST/WebSocket APIs, and persists configuration in SQLite.

## Package Info

- **Name**: `@mc-server-manager/backend`
- **Entry**: `src/index.ts`
- **Dev**: `tsx watch src/index.ts` (port 3001)
- **Build**: `tsc` -> `dist/`
- **Runtime deps**: express, ws, better-sqlite3, zod, pino, nanoid, cors

## Directory Structure

```
src/
  index.ts              -- Entry: starts HTTP+WS server, graceful shutdown (SIGINT/SIGTERM)
  app.ts                -- Express app: middleware, route mounting, error handler
  config.ts             -- Configuration (port, host, data paths, log level)
  routes/               -- HTTP route handlers (request validation, response formatting)
  services/             -- Business logic layer (process management, file I/O, DB init)
  ws/                   -- WebSocket server setup and message handlers
  models/               -- Database access layer (prepared statements, CRUD)
  utils/                -- Logging (Pino) and custom error classes
migrations/             -- Numbered SQL migration files (001_initial.sql, 002_settings.sql)
```

## Layered Architecture

```
routes/ (HTTP)  -->  services/ (business logic)  -->  models/ (SQLite)
                           |
                           +---> ServerManager --> ServerProcess (child_process.spawn)
                           +---> File I/O (server.properties, eula.txt, JARs)

ws/ (WebSocket) -->  services/ (same services, different transport)
```

Routes handle request validation (Zod) and HTTP concerns. Services contain all business logic. Models are a thin layer of prepared SQL statements. The WebSocket layer consumes the same services but via event-driven broadcasts.

## Critical Files

### `services/server-manager.ts` (Singleton Orchestrator)
- Holds `Map<serverId, ServerProcess>` for all active server processes
- Provides `start()`, `stop()`, `restart()`, `forceKill()`, `sendCommand()`
- Port conflict pre-check before starting (OS-level `net.createServer` probe)
- Wires `ServerProcess` events to broadcast listeners (consumed by WS layer)
- `shutdownAll()` for graceful app shutdown -- stops all running MC servers with 45s timeout per server
- Event registration: `onConsole()`, `onStatus()`, `onPlayers()` for external consumers

### `services/process.ts` (ServerProcess Class)
- **THE most critical code in the entire application** -- manages Java child process lifecycle
- Extends `EventEmitter`, emits typed events: `console`, `status`, `players`
- State machine: stopped -> starting -> running -> stopping -> stopped (or crashed)
- Detects "running" via regex on stdout: `/\]: Done \(\d+[\.,]\d+s\)!/`
- Fallback timeout (120s) if Done line never appears
- Graceful stop: `stop` command via stdin -> 30s grace -> SIGTERM -> 10s -> SIGKILL
- Player tracking: parses `joined the game` / `left the game` from stdout
- Ring buffer integration via `ConsoleBuffer` (1000 lines)

### `services/console-buffer.ts`
- Fixed-capacity ring buffer (default 1000 lines)
- O(1) push, O(n) getLines (returns in chronological order)
- Each entry has `{ line, timestamp }` shape

### `services/database.ts`
- SQLite via `better-sqlite3` (synchronous API)
- WAL mode enabled for concurrent read performance
- Custom migration runner: reads `migrations/*.sql`, tracks in `_migrations` table
- Must be initialized before any route handlers run

### `services/properties.ts`
- Parses/writes `server.properties` (Java properties format)
- Contains `PROPERTY_GROUPS` constant: metadata for all known MC server properties grouped by category (gameplay, network, world, advanced)
- Merge strategy: updates are merged over existing properties to preserve unknown/mod-added keys

### `services/download.ts`
- JAR download service with progress tracking (bytes downloaded, total, percentage)
- SHA1 verification after download
- Jobs stored in-memory Map keyed by job ID (not persisted)
- Async download with streaming

### `services/java.ts`
- Detects Java installations by scanning JAVA_HOME, PATH, common system locations
- Parses `java -version` output for version string

### `services/versions.ts`
- Fetches Mojang version manifest (https://launchermeta.mojang.com)
- 10-minute in-memory cache to avoid repeated API calls

## Routes

### `routes/servers.ts` (main route file)
- `GET /api/servers` -- list all (enriched with runtime status from ServerManager)
- `POST /api/servers` -- create (validates with Zod, generates nanoid, sets up directory)
- `GET /api/servers/:id` -- single server
- `PATCH /api/servers/:id` -- update config
- `DELETE /api/servers/:id` -- delete (optional `?deleteFiles=true` to rm directory)
- `POST /api/servers/:id/start|stop|restart|kill` -- lifecycle actions
- `POST /api/servers/:id/command` -- send stdin command
- `GET /api/servers/:id/console` -- console history (HTTP fallback)
- `GET/PUT /api/servers/:id/properties` -- read/write server.properties

### `routes/validation.ts`
- Zod schemas: `createServerSchema`, `updateServerSchema`, `updatePropertiesSchema`
- Shared validation logic used by route handlers

### `routes/system.ts`
- `GET /api/system/java` -- Java detection info
- `GET /api/system/info` -- Platform, RAM, CPUs
- `GET /api/system/settings` / `PUT /api/system/settings` -- App settings

### `routes/versions.ts`
- `GET /api/versions/vanilla` -- Proxied Mojang version list

### `routes/downloads.ts`
- `POST /api/downloads` -- Start a JAR download job
- `GET /api/downloads/:jobId` -- Poll download progress

## WebSocket

### `ws/index.ts`
- Creates `WebSocketServer` on `/ws` path, attached to HTTP server
- Wires ServerManager events (console, status, players) to broadcast to subscribed clients
- Runs a periodic stats interval (every 10s) for subscribed servers
- `broadcast()` helper sends to all clients subscribed to a specific serverId

### `ws/handlers.ts`
- `handleMessage()` routes incoming JSON by `type` field: subscribe, unsubscribe, command
- Maintains `WeakMap<WebSocket, Set<serverId>>` for subscription tracking
- `subscribe` sends console history buffer immediately, then streams new lines
- `handleDisconnect()` cleans up subscriptions

## Models

### `models/server.ts`
- All database operations for the `servers` table
- Uses prepared statements (better-sqlite3 synchronous API)
- Functions: `getAllServers`, `getServerById`, `createServerWithId`, `updateServer`, `deleteServer`, `isPortInUse`
- Maps `snake_case` DB columns to `camelCase` TypeScript interfaces

## Error Handling

### `utils/errors.ts`
- `AppError` base class (message, statusCode, code)
- Subclasses: `NotFoundError` (404), `ConflictError` (409), `ValidationError` (400)
- Express error middleware in `app.ts` catches these and returns structured JSON

## Configuration

### `config.ts`
- `PORT` = 3001 (env: `PORT`)
- `HOST` = localhost (env: `HOST`)
- `DATA_DIR` = `<project-root>/data` (env: `DATA_DIR`)
- `SERVERS_DIR` = `<DATA_DIR>/servers`
- `DB_PATH` = `<DATA_DIR>/mc-manager.db`
- `LOG_LEVEL` = info (env: `LOG_LEVEL`)

## Conventions Specific to Backend

- `.js` extensions in all import paths (required for ESM with tsc output)
- Services are singletons exported at module level (e.g., `export const serverManager = new ServerManager()`)
- All async route handlers must call `next(err)` for error propagation
- Database operations are synchronous (better-sqlite3) -- no async/await needed for DB calls
- TypeScript project reference to `../../shared` -- shared must be built first
