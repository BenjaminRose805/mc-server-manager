# Minecraft Server Manager — Architecture & Build Plan

## 1. Feature List (Prioritized)

### Phase 1 — MVP: Single Server Management
The absolute minimum to be useful: create one server, start it, stop it, see what's happening.

1. **Server Creation Wizard** — User points to an existing server JAR or downloads a vanilla JAR (version picker). Creates a server directory with `eula.txt` auto-accepted, default `server.properties`.
2. **Start / Stop / Restart** — Spawn the Java process, gracefully stop via RCON or `stop` command piped to stdin, force-kill as fallback.
3. **Live Console** — Stream stdout/stderr to the browser in real-time via WebSocket. Send commands from a text input (piped to stdin).
4. **Server Status Dashboard** — Show running/stopped state, player count, uptime, memory usage, server version.
5. **server.properties Editor** — Parse and present `server.properties` as a form with labels, descriptions, and validation. Save writes the file back.
6. **Basic Settings** — Configure JVM arguments (min/max heap), server port, MOTD — the most common settings surfaced prominently.
7. **System Requirements Check** — Detect Java installation, version, and available RAM on startup.

### Phase 2 — Enhanced: Multi-Server & Operations
8. **Multi-Server Support** — Manage N servers, each with independent state, port, and directory. Dashboard shows all servers at a glance.
9. **Backup & Restore** — Create timestamped zip backups of the world folder. Restore from a backup. Configurable backup directory.
10. **Player Management** — View online players, whitelist management (add/remove), ban/pardon, op/deop. Parsed from server output + files.
11. **Mod/Plugin Management** — List installed mods/plugins (scan `mods/` or `plugins/` directory). Upload new JARs. Delete existing ones. Basic metadata display.
12. **Server Type Support** — Support creating Paper, Fabric, and Forge servers in addition to Vanilla. Download the correct installer/JAR per type.
13. **Log Viewer** — Browse and search historical `logs/latest.log` and archived logs with filtering.
14. **Import Existing Server** — Point to an existing server directory and import it (detect type, version, settings).

### Phase 3 — Nice-to-Have
15. **Scheduled Tasks** — Cron-like scheduler: auto-restart, auto-backup, run commands on a schedule.
16. **Performance Graphs** — Track and chart TPS, memory usage, player count over time. Stored in SQLite.
17. **Auto-Update** — Detect new server JAR versions and offer one-click update (with backup first).
18. **World Management** — Switch between worlds, upload worlds, reset/delete worlds.
19. **Notifications** — Desktop/browser notifications for server crashes, player joins, low TPS.
20. **Remote Access** — Optional HTTPS + auth so you can manage from outside the LAN.
21. **Docker Deployment** — Dockerfile for running the manager itself (servers still run on host or via volume mounts).

---

## 2. Architecture

### 2.1 Project Structure (Monorepo with Workspaces)

```
mc-server-manager/
├── package.json              # Root — workspace config, shared scripts
├── tsconfig.base.json        # Shared TS config
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point — starts HTTP + WS server
│   │   │   ├── app.ts                # Express app setup, middleware
│   │   │   ├── config.ts             # App configuration (ports, paths, defaults)
│   │   │   ├── routes/
│   │   │   │   ├── servers.ts        # CRUD for server definitions
│   │   │   │   ├── console.ts        # Send commands to server stdin
│   │   │   │   ├── settings.ts       # server.properties + JVM args
│   │   │   │   ├── system.ts         # Java detection, system info
│   │   │   │   └── files.ts          # File browsing (Phase 2)
│   │   │   ├── services/
│   │   │   │   ├── server-manager.ts # Orchestrates server lifecycle
│   │   │   │   ├── process.ts        # Java process spawn/kill/stdio
│   │   │   │   ├── console-buffer.ts # Ring buffer for console output
│   │   │   │   ├── properties.ts     # Parse/write server.properties
│   │   │   │   ├── java.ts           # Detect Java, validate version
│   │   │   │   ├── download.ts       # Download server JARs
│   │   │   │   └── database.ts       # SQLite connection + migrations
│   │   │   ├── ws/
│   │   │   │   ├── index.ts          # WebSocket server setup
│   │   │   │   └── handlers.ts       # Event handlers (subscribe, command)
│   │   │   ├── models/
│   │   │   │   └── server.ts         # DB queries for servers table
│   │   │   └── utils/
│   │   │       ├── logger.ts         # Structured logging (pino)
│   │   │       └── errors.ts         # Custom error classes
│   │   └── migrations/
│   │       └── 001_initial.sql
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx              # React entry
│           ├── App.tsx               # Router setup
│           ├── api/
│           │   ├── client.ts         # Fetch wrapper for REST API
│           │   └── ws.ts             # WebSocket client singleton
│           ├── hooks/
│           │   ├── useServer.ts      # Server state + actions
│           │   ├── useConsole.ts     # Console log stream
│           │   └── useSystem.ts      # System info
│           ├── pages/
│           │   ├── Dashboard.tsx     # Server overview / home
│           │   ├── ServerDetail.tsx  # Single server view (tabs)
│           │   ├── CreateServer.tsx  # Server creation wizard
│           │   └── Settings.tsx      # App-level settings
│           ├── components/
│           │   ├── Console.tsx       # Terminal-like console display
│           │   ├── ServerCard.tsx    # Server summary card
│           │   ├── StatusBadge.tsx   # Running/Stopped indicator
│           │   ├── PropertiesForm.tsx# server.properties editor
│           │   ├── PlayerList.tsx    # Online players
│           │   └── Layout.tsx        # Shell: sidebar + content
│           ├── stores/
│           │   └── serverStore.ts    # Zustand store
│           └── types/
│               └── index.ts          # Shared types (mirrored from backend)
├── shared/
│   └── types.ts                      # Types used by both frontend and backend
└── data/                             # Default data directory (gitignored)
    └── servers/                      # Individual server directories live here
```

**Why monorepo with npm workspaces (not pnpm/turborepo)?** Keeps it simple. npm workspaces are built-in, zero extra tooling. The project isn't large enough to benefit from Turborepo's caching. We can always add it later.

### 2.2 Backend Architecture

**Framework: Express** — Not Fastify. Rationale:
- Middleware ecosystem is massive and battle-tested.
- The app is I/O-light (most work is process management, not high-throughput HTTP).
- Fastify's performance advantage is irrelevant at this scale (one user, tens of requests/minute).
- Express has better community examples for WebSocket integration patterns.

**Layers:**

```
Routes (HTTP handlers) ──→ Services (business logic) ──→ Models (DB access)
                                    │
                                    ├──→ Process Manager (Java child processes)
                                    └──→ File System (server.properties, JARs, worlds)

WebSocket Server ──→ Services (same services, different transport)
```

**Process Management (the core complexity):**

```typescript
// Simplified mental model
class ServerProcess {
  private proc: ChildProcess | null;
  private consoleBuffer: RingBuffer;  // Last 1000 lines

  start(javaPath: string, jarPath: string, jvmArgs: string[], cwd: string): void {
    this.proc = spawn(javaPath, [...jvmArgs, '-jar', jarPath, 'nogui'], { cwd });
    this.proc.stdout.on('data', (data) => {
      this.consoleBuffer.push(data.toString());
      this.emit('console', data.toString());  // Forwarded to WS subscribers
    });
    this.proc.on('exit', (code) => {
      this.emit('status', 'stopped');
      // If unexpected exit (crash), emit crash event
    });
  }

  sendCommand(command: string): void {
    this.proc?.stdin.write(command + '\n');
  }

  stop(): void {
    this.sendCommand('stop');       // Graceful
    setTimeout(() => {
      if (this.proc) this.proc.kill('SIGTERM');  // Fallback
    }, 15000);
  }
}
```

Key design decisions for process management:
- **One `ServerProcess` instance per server**, held in a `Map<serverId, ServerProcess>` in the `ServerManager` service.
- **Console output uses a ring buffer** (1000 lines). When a client connects, they get the buffer contents immediately, then stream new lines.
- **Crash detection**: If the process exits with a non-zero code and wasn't explicitly stopped, it's a crash. We record it and optionally auto-restart (Phase 3).
- **stdin for commands**, not RCON. RCON requires additional setup and isn't enabled by default. Piping to stdin works universally for all server types.
- **`nogui` flag** is always passed since we're headless.

### 2.3 Frontend Architecture

**State Management: Zustand** — Not Redux, not React Context alone.
- Tiny API surface, almost no boilerplate.
- Works great with WebSocket-driven updates (just call `setState` from the WS handler).
- No provider wrapping needed.

**Routing: React Router v7** — Standard choice, nothing exotic needed.

**Styling: Tailwind CSS** — Fast to iterate on, no CSS-in-JS runtime cost. Good for building a dashboard UI quickly.

**UI Component Foundation: shadcn/ui** — Not a component library dependency. It's copy-pasted components built on Radix primitives + Tailwind. Gives us accessible, well-styled form controls, dialogs, tabs, etc. without locking into a library version.

**Page structure:**

```
Dashboard (/)
  └── List of ServerCards, "Create Server" button

CreateServer (/servers/new)
  └── Wizard: Pick type → Pick version → Configure name/port/memory → Create

ServerDetail (/servers/:id)
  └── Tabs:
      ├── Console (default) — live terminal + command input
      ├── Settings — server.properties form + JVM args
      ├── Players — online players, whitelist, bans (Phase 2)
      └── Files — file browser for server directory (Phase 2)

Settings (/settings)
  └── Java path, default data directory, theme
```

**WebSocket integration pattern:**

```typescript
// ws.ts — singleton
const ws = new WebSocket(`ws://${location.host}/ws`);

// On mount of ServerDetail page:
ws.send(JSON.stringify({ type: 'subscribe', serverId: '...' }));

// In zustand store:
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'console':
      useServerStore.getState().appendConsole(msg.serverId, msg.line);
      break;
    case 'status':
      useServerStore.getState().setStatus(msg.serverId, msg.status);
      break;
    case 'stats':
      useServerStore.getState().setStats(msg.serverId, msg.stats);
      break;
  }
};
```

### 2.4 Database Schema (SQLite via better-sqlite3)

```sql
-- The core entity. One row per managed Minecraft server.
CREATE TABLE servers (
  id            TEXT PRIMARY KEY,          -- nanoid
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'vanilla',  -- vanilla | paper | fabric | forge
  mc_version    TEXT NOT NULL,             -- e.g. "1.21.4"
  jar_path      TEXT NOT NULL,             -- Absolute path to server JAR
  directory     TEXT NOT NULL UNIQUE,      -- Absolute path to server directory
  java_path     TEXT NOT NULL DEFAULT 'java',  -- Path to java binary
  jvm_args      TEXT NOT NULL DEFAULT '-Xmx2G -Xms1G',
  port          INTEGER NOT NULL DEFAULT 25565,
  auto_start    INTEGER NOT NULL DEFAULT 0,  -- boolean
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 2: Backup records
CREATE TABLE backups (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 3: Scheduled tasks
CREATE TABLE scheduled_tasks (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  task_type     TEXT NOT NULL,             -- backup | restart | command
  cron_expr     TEXT NOT NULL,             -- cron expression
  payload       TEXT,                      -- JSON (e.g. command to run)
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 3: Performance metrics (time-series)
CREATE TABLE metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  tps           REAL,
  memory_mb     INTEGER,
  player_count  INTEGER
);
CREATE INDEX idx_metrics_server_time ON metrics(server_id, timestamp);
```

**Why better-sqlite3 over Drizzle/Prisma/Knex?**
- Synchronous API is actually an advantage here — no async overhead for simple queries on a local SQLite file.
- Zero ORM magic. The queries are simple enough that raw SQL with a thin helper is clearer.
- We'll wrap it in a small `database.ts` service with prepared statements. Type safety comes from our own TypeScript interfaces, not an ORM.
- Drizzle could be added later if the schema grows complex, but for 3-4 tables it's overkill.

### 2.5 WebSocket Event Design

**Client → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ serverId: string }` | Start receiving console + status for this server |
| `unsubscribe` | `{ serverId: string }` | Stop receiving events for this server |
| `command` | `{ serverId: string, command: string }` | Send command to server stdin |

**Server → Client:**

| Event | Payload | Description |
|-------|---------|-------------|
| `console` | `{ serverId: string, line: string, timestamp: string }` | New console output line |
| `console:history` | `{ serverId: string, lines: Array<{line, timestamp}> }` | Buffer dump on subscribe |
| `status` | `{ serverId: string, status: 'starting'│'running'│'stopping'│'stopped'│'crashed' }` | Server state change |
| `stats` | `{ serverId: string, playerCount: number, players: string[], uptime: number }` | Periodic stats update (every 10s) |
| `error` | `{ message: string, code?: string }` | Error message |

**Protocol:** All messages are JSON with a `type` field discriminator:
```json
{ "type": "console", "serverId": "abc123", "line": "[Server] Done (3.2s)!", "timestamp": "..." }
```

### 2.6 Process Management Deep Dive

**Server Lifecycle State Machine:**

```
         create()          start()
[none] ──────────→ [stopped] ──────────→ [starting]
                      ↑                      │
                      │                      │ (detects "Done" in stdout)
                  stop()                     ↓
                      │                  [running]
                      │                      │
                  [stopping] ←───────────────┘
                      │                 stop()
                      │
                      │ (process exits cleanly)
                      ↓
                   [stopped]

                   [running] ──→ (unexpected exit) ──→ [crashed] ──→ [stopped]
```

**Detecting "running" state:** Parse stdout for the line `Done (X.XXXs)! For help, type "help"`. This is emitted by all vanilla-derived servers. For modded servers, we also accept a timeout-based fallback (if process is alive after 60s with no crash, assume running).

**Player tracking (Phase 1, basic):** Parse stdout for:
- `<player> joined the game` → add to player set
- `<player> left the game` → remove from player set
- Player count regex from server output

**Port conflict detection:** Before starting, check if the configured port is already in use (`net.createServer().listen()` test). Prevents confusing Java errors.

---

## 3. API Design (MVP)

### REST Endpoints

```
# Server CRUD
GET    /api/servers                    → Server[]           # List all servers
POST   /api/servers                    → Server             # Create new server
GET    /api/servers/:id                → Server             # Get server details
PATCH  /api/servers/:id                → Server             # Update server config
DELETE /api/servers/:id                → void               # Delete server (optionally delete files)

# Server Lifecycle
POST   /api/servers/:id/start          → { status }         # Start the server
POST   /api/servers/:id/stop           → { status }         # Stop the server (graceful)
POST   /api/servers/:id/restart        → { status }         # Stop then start
POST   /api/servers/:id/kill           → { status }         # Force kill (SIGKILL)

# Server Configuration
GET    /api/servers/:id/properties     → Record<string,string>  # Read server.properties
PUT    /api/servers/:id/properties     → void                   # Write server.properties (server must be stopped)

# Console (fallback for non-WS clients, but WS is primary)
POST   /api/servers/:id/command        → void               # Send command to stdin

# System
GET    /api/system/java                → { path, version, found }  # Java detection
GET    /api/system/info                → { platform, ram, cpus }   # System resources

# Downloads (for server creation wizard)
GET    /api/versions/:type             → Version[]          # Available versions for server type
POST   /api/downloads                  → { jobId }          # Start downloading a server JAR
GET    /api/downloads/:jobId           → { status, progress }  # Download progress
```

### WebSocket

Single endpoint: `ws://localhost:3000/ws`

All communication over one connection, multiplexed by `serverId`. See event table in Section 2.5.

---

## 4. Phased Build Order

Each step produces something testable. Estimated effort in parentheses.

### Step 1: Project Scaffolding (1 session)
- Initialize npm workspaces (root `package.json`)
- Create `packages/backend` and `packages/frontend` with their own `package.json` and `tsconfig.json`
- Set up `shared/types.ts` with initial type definitions
- Install dependencies for both packages
- Configure Vite for frontend with proxy to backend
- Backend: bare Express server that returns `{ status: "ok" }` on `GET /api/health`
- Frontend: bare React app with Vite that shows "MC Server Manager" heading
- Add `dev` script that starts both concurrently
- **Testable:** `npm run dev` starts both servers, frontend loads, health check works

### Step 2: Database + Server CRUD (1 session)
- Set up better-sqlite3 with WAL mode
- Create migration runner (simple: read SQL files, track applied migrations in a `_migrations` table)
- Write `001_initial.sql` migration (servers table)
- Implement server model (create, read, update, delete with prepared statements)
- Implement REST routes: `GET /api/servers`, `POST /api/servers`, `GET /api/servers/:id`, `PATCH /api/servers/:id`, `DELETE /api/servers/:id`
- Add input validation (zod for request body parsing)
- **Testable:** curl the endpoints, create/list/update/delete server records

### Step 3: Java Detection + Server JAR Download (1 session)
- Implement Java detection service: scan PATH, common locations (`/usr/bin/java`, `JAVA_HOME`), parse `java -version` output
- Implement `GET /api/system/java` and `GET /api/system/info`
- Implement Mojang version manifest fetcher (https://launchermeta.mojang.com/mc/game/version_manifest_v2.json)
- Implement JAR download service with progress tracking
- Implement `GET /api/versions/vanilla` and `POST /api/downloads`
- Write `eula.txt` and default `server.properties` into server directory on creation
- **Testable:** Hit endpoints, see Java info, list MC versions, download a server JAR

### Step 4: Process Management — Start/Stop (1 session)
- Implement `ServerProcess` class (spawn, stdin pipe, stdout/stderr capture, kill)
- Implement `ServerManager` singleton (holds process map, orchestrates lifecycle)
- Implement ring buffer for console output (configurable size, default 1000 lines)
- Implement `POST /api/servers/:id/start`, `stop`, `restart`, `kill`
- Parse stdout for "Done" line to detect running state
- Parse stdout for player join/leave
- Port conflict pre-check before start
- **Testable:** Create a server via API, start it, see it running (`ps aux`), stop it via API

### Step 5: WebSocket Server (1 session)
- Set up `ws` library on the Express HTTP server
- Implement subscribe/unsubscribe/command message handlers
- Wire up ServerProcess events → broadcast to subscribed clients
- Send console history buffer on subscribe
- Send status change events
- Send periodic stats (player count, uptime) every 10 seconds
- **Testable:** Connect with `wscat`, subscribe, start server, see console output stream

### Step 6: Frontend Shell + Dashboard (1 session)
- Set up React Router with layout component
- Build the sidebar/navigation (servers list + create button)
- Build Dashboard page with ServerCard components
- Fetch servers from API on load
- Display server status (stopped/running) with status badges
- "Create Server" button links to creation page
- **Testable:** Open browser, see dashboard with any created servers

### Step 7: Server Creation Wizard (1 session)
- Build multi-step form: type selection → version picker → name/port/memory config → confirm
- Fetch available versions from API
- Submit creation request
- Show download progress (poll download status endpoint)
- Redirect to server detail page on completion
- **Testable:** Walk through wizard, create a server, see it appear on dashboard

### Step 8: Live Console (1 session)
- Build Console component with terminal-like styling (monospace, dark background, auto-scroll)
- Connect WebSocket, subscribe to server on mount, unsubscribe on unmount
- Render console history on connect, then append new lines
- Command input at the bottom — sends via WebSocket `command` event
- Handle reconnection if WebSocket drops
- **Testable:** Start a server, see live output in browser, send commands, see responses

### Step 9: Server Controls + Status (1 session)
- Build ServerDetail page with tab navigation
- Console tab (built in Step 8)
- Control bar: Start/Stop/Restart buttons with loading states
- Status display: running state, player count, uptime, memory
- Wire up status WebSocket events to update UI in real-time
- Disable controls contextually (can't start if running, can't stop if stopped)
- **Testable:** Full lifecycle from browser: create → start → interact → stop

### Step 10: Settings Editor (1 session)
- Build PropertiesForm component
- Fetch `GET /api/servers/:id/properties` → render as form fields
- Group properties logically (gameplay, network, world, advanced)
- Add descriptions and validation per known property
- Save sends `PUT /api/servers/:id/properties`
- JVM arguments editor (textarea with presets: 2GB, 4GB, 8GB)
- Warn if server is running (properties require restart)
- **Testable:** Edit server.properties from browser, verify file changes on disk

### Step 11: Polish + Error Handling (1 session)
- Global error boundary in React
- Toast notifications for actions (server started, command sent, error occurred)
- Loading skeletons for initial data fetches
- Handle edge cases: server deleted while viewing, process crash during operation
- Responsive layout (works on tablet widths too)
- App-level settings page (Java path override, data directory)
- **Testable:** Full MVP is usable end-to-end with good error feedback

---

## 5. Key Technical Decisions

### Library Choices

| Choice | Pick | Reasoning |
|--------|------|-----------|
| HTTP framework | **Express** | Ecosystem maturity. Performance is irrelevant for a single-user local app. |
| WebSocket | **ws** (not socket.io) | `ws` is a pure WebSocket implementation — no custom protocol, no fallback polling, no bloat. Socket.io adds ~50KB to the client bundle and its features (rooms, namespaces, auto-reconnect) are trivially implemented in 50 lines. For a local app with one user, the reliability guarantees of socket.io are unnecessary. |
| Database | **better-sqlite3** | Synchronous API is a feature — simpler code, no connection pooling, no async overhead. Perfect for a local single-user app. WAL mode handles concurrent reads. |
| Schema/migration | **Manual SQL files** | 3-4 tables don't need an ORM or migration framework. A 30-line migration runner is sufficient. |
| Validation | **zod** | Type-safe request validation with excellent TypeScript inference. Define the schema once, get the type for free. |
| Frontend state | **Zustand** | Minimal boilerplate, works naturally with imperative WebSocket callbacks (`getState().doThing()`). No provider nesting, no action types, no reducers. |
| Routing | **React Router v7** | The standard. TanStack Router is great but overkill for 4 pages. |
| Styling | **Tailwind CSS v4** | Utility-first is ideal for dashboard UIs. No context-switching between CSS files. |
| UI primitives | **shadcn/ui** | Accessible components (Radix), but owned in your codebase. Not a dependency you upgrade — it's copied code you control. |
| Logging | **pino** | Structured JSON logging, extremely fast, great for piping server output. |
| IDs | **nanoid** | Short, URL-safe, no dependency on crypto.randomUUID (which is fine too, but nanoid IDs are more ergonomic in URLs). |
| Process management | **Node.js `child_process.spawn`** | Built-in, no wrapper needed. `spawn` (not `exec`) gives us streaming stdio. |
| Build/dev | **tsx** for backend, **Vite** for frontend | `tsx` is esbuild-powered, instant TypeScript execution for dev. Vite is the standard frontend dev server. |
| Concurrency | **concurrently** | Run backend + frontend dev servers with one command. |

### Server JAR Discovery & Download Strategy

**The user does NOT manually hunt for JARs.** The creation wizard handles it:

1. **Vanilla**: Fetch Mojang's version manifest (`https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`), let user pick a version, download the server JAR from the official URL in the manifest.

2. **Paper** (Phase 2): Use Paper's download API (`https://api.papermc.io/v2/projects/paper`). Pick version → pick build → download.

3. **Fabric** (Phase 2): Use Fabric's meta API (`https://meta.fabricmc.net/`) to get installer, then run the installer JAR to generate the server launch JAR.

4. **Forge** (Phase 2): Use Forge's promotion API. Download the installer, run it with `--installServer`. This is the trickiest because Forge's installer needs to run first.

5. **Existing JAR**: Advanced option — user points to a JAR path. We detect the type by inspecting the JAR contents (look for `paper.yml`, `fabric-server-launch.jar`, `forge` in manifest).

**Each server gets its own directory** under `data/servers/<server-id>/`. The JAR is copied/downloaded into this directory. This isolation prevents cross-contamination and makes backups trivial (zip the directory).

### Handling Different Server Types

Create a `ServerType` interface:

```typescript
interface ServerType {
  id: 'vanilla' | 'paper' | 'fabric' | 'forge';
  getVersions(): Promise<Version[]>;
  download(version: string, destDir: string): Promise<string>;  // Returns JAR filename
  getLaunchArgs(serverDir: string): string[];  // Type-specific JVM/launch args
  detectType(serverDir: string): boolean;  // Can this type claim this directory?
}
```

MVP only implements `VanillaServerType`. Phase 2 adds the others as implementations of the same interface. This is the key abstraction to get right early — but the interface is simple enough that it doesn't need to be over-designed.

---

## 6. Risk Areas

### High Risk — Design Carefully Upfront

**1. Process lifecycle reliability**
The #1 thing that will make this app feel broken is if servers get into inconsistent states (UI says "running" but process is dead, or process is running but app lost track of it). Mitigations:
- Store PID in the database when starting. On app startup, check if any PIDs from previous session are still alive.
- Always update DB status on process exit events.
- Implement a periodic health check (every 5s: is the PID still alive?).
- Never trust in-memory state alone — verify against the OS process table.

**2. Console output volume**
A Minecraft server can emit hundreds of lines per second during world generation. If we naively push every line over WebSocket and render every line in React, the browser will choke. Mitigations:
- **Server-side**: Batch console output — aggregate lines over 100ms windows before sending.
- **Client-side**: Virtualized list rendering (only render visible lines). Use `@tanstack/react-virtual` for the console component.
- **Buffer cap**: Ring buffer (1000 lines in memory). Historical logs go to disk, not memory.

**3. Graceful shutdown — both the manager and the MC servers**
If the manager process (Node.js) is killed, running MC servers become orphans. Mitigations:
- On SIGINT/SIGTERM, send `stop` to all running MC servers and wait (with timeout) for them to exit.
- Store PIDs in DB so a restarted manager can reclaim or detect orphans.
- Provide a "kill orphan" button in the UI if detected.

**4. Cross-platform path handling**
The `.gitignore` mentions Tauri, suggesting potential Windows usage. Java paths, server directories, and file separators differ across platforms. Mitigations:
- Use `path.join()` everywhere, never string concatenation for paths.
- Use `which` (npm package) for finding Java on PATH cross-platform.
- Test with both `/` and `\` path separators in any path validation.

### Medium Risk — Needs Attention

**5. server.properties parsing**
`server.properties` is a Java properties file format. It looks simple but has edge cases: comments, Unicode escapes, multiline values with `\`, BOM characters. Mitigation: Use a proper properties parser (`java-properties` npm package) rather than hand-rolling regex.

**6. Port management**
Users will forget they set two servers to the same port. The creation wizard should suggest the next available port (25565, 25566, 25567...). Validate uniqueness across all configured servers and check OS-level port availability before start.

**7. EULA acceptance**
Minecraft requires `eula=true` in `eula.txt`. We auto-write this during server creation, but we should display a notice explaining what the user is agreeing to. Don't silently accept it.

**8. WebSocket reconnection**
The browser tab might lose connection (laptop sleep, network hiccup). The frontend WebSocket client needs automatic reconnection with exponential backoff, and must re-subscribe to the correct server on reconnect. Missed console output during disconnect is acceptable — the user gets the current buffer on resubscribe.

### Low Risk — But Worth Noting

**9. Java version compatibility**
Different Minecraft versions require different Java versions (1.16 needs Java 8-16, 1.17+ needs Java 17+, 1.21+ needs Java 21+). The creation wizard should warn if the detected Java version is incompatible. A lookup table of MC version → minimum Java version is sufficient.

**10. Disk space**
Server worlds can grow to many GB. Backups multiply this. Consider showing disk usage in the dashboard and warning when space is low. Not MVP, but worth the data model accommodation (store `size_bytes` in server records).

**11. Anti-virus interference**
On Windows, anti-virus software sometimes quarantines or blocks Java processes or downloaded JARs. This is outside our control, but good error messages ("Failed to start: access denied" → "Check your anti-virus settings") help a lot.

---

## Summary: What to Build First

The critical path for a working MVP is:

```
Scaffolding → DB + CRUD → Java Detection + Download → Process Management → WebSocket → Frontend Shell → Creation Wizard → Console → Controls → Settings → Polish
```

This is 11 steps. Each is one focused session. At Step 9 you have a fully functional (if rough) product. Steps 10-11 make it pleasant to use.

**The single most important thing to get right early is the `ServerProcess` class and its lifecycle management.** Everything else — the UI, the API, the database — is straightforward CRUD. The process management is where the real complexity lives, and where bugs will be most painful to fix later.
