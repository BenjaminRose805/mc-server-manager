# MC Server Manager — Product Roadmap

> Consolidated from the original build plan, frontend↔backend audit, and product-level feature gap analysis.
> Last updated: 2025-02-15

## How to Read This Document

- **Section 1** — What's been built. The original phased build plan with completion status.
- **Section 2** — Known gaps in what's built. Wiring issues where the backend supports something the frontend doesn't expose.
- **Section 3** — What hasn't been built. Feature-level gaps organized by priority tier.
- **Section 4** — Risk areas from the original architecture plan that still need attention.
- **Section 5** — Technical decisions and rationale preserved from the original plan (for future reference).

For current architecture details, tech stack, project structure, and conventions, see **AGENTS.md**.

---

## 1. Build Plan Status

### Phase 1 — MVP: Single Server Management ✅ Complete

| # | Feature | Status |
|---|---------|--------|
| 1 | Server Creation Wizard (type picker, version picker, config, download) | ✅ Done |
| 2 | Start / Stop / Restart / Kill | ✅ Done |
| 3 | Live Console (WebSocket, virtualized rendering, command input+history) | ✅ Done |
| 4 | Server Status Dashboard (cards, status, player count, uptime) | ✅ Done |
| 5 | server.properties Editor (grouped form with metadata) | ✅ Done |
| 6 | Basic Settings (JVM args with Aikar's presets, port, auto-start) | ✅ Done |
| 7 | System Requirements Check (Java detection, version, RAM) | ✅ Done |

### Phase 2 — Enhanced: Multi-Server & Operations (Partially Complete)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 8 | Multi-Server Support | ✅ Done | Independent servers with status cards, port conflict detection |
| 9 | Backup & Restore | ❌ Not started | DB schema designed in original plan but never migrated. See gap 3.1. |
| 10 | Player Management (whitelist, ban, op, player history) | ❌ Not started | Player tracking via stdout parsing exists; management UI does not. See gap 3.5. |
| 11 | Mod/Plugin Management | ✅ Done | Modrinth + CurseForge search, version picker, install, enable/disable, uninstall. Modpack search/parse/install with update detection. |
| 12 | Server Type Support (Paper, Fabric, Forge, NeoForge) | ✅ Done | All 5 types: vanilla, paper, fabric, forge, neoforge. |
| 13 | Log Viewer | ✅ Done | Browse historical log files per server. |
| 14 | Import Existing Server | ❌ Not started | `existingJarPath` field exists in shared types but isn't exposed in UI. See gaps 2.15 and 3.6. |

### Phase 3 — Nice-to-Have (Not Started)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 15 | Scheduled Tasks (cron-like: restart, backup, commands) | ❌ Not started | DB schema designed but never migrated. See gap 3.7. |
| 16 | Performance Graphs (TPS, memory, player count over time) | ❌ Not started | DB schema designed but never migrated. See gap 3.8. |
| 17 | Auto-Update (detect new server JAR versions, one-click update) | ❌ Not started | |
| 18 | World Management (switch, upload, reset, delete worlds) | ❌ Not started | See gap 3.9. |
| 19 | Notifications (desktop/browser for crashes, player joins, low TPS) | ❌ Not started | See gap 3.14. |
| 20 | Remote Access (HTTPS + auth) | ✅ Done | JWT auth, TLS/ACME, UPnP, rate limiting, brute-force protection. |
| 21 | Docker Deployment | ❌ Not started | See gap 3.26. |

### Beyond Original Plan (Implemented)

These features weren't in the original phased plan but have been built:

| Feature | Notes |
|---------|-------|
| Electron desktop wrapper | Tray, window management, auto-start |
| Microsoft OAuth device-code auth | Full Minecraft account authentication |
| Client game launcher | Create instances, install mod loaders (Fabric, Forge, NeoForge), launch game |
| Client instance management | CRUD for game instances with mod support |
| Multi-user auth system | JWT, registration via invite codes, role-based (owner/admin/member) |
| Admin panel | User management, invitation system, role assignment |
| Per-server RBAC permissions | Backend complete (canView, canStart, canConsole, canEdit, canJoin) |
| NeoForge server type | 5th server type beyond the original 4 |
| Modpack support | Search, parse, review with client-only warnings, install with overrides |
| CurseForge integration | Dual-source mod search (Modrinth + CurseForge) |
| Secure credential storage | OS-level encryption via Electron safeStorage |
| TLS/ACME support | Let's Encrypt certificate automation |
| UPnP port forwarding | Automatic router port configuration |

---

## 2. Wiring Gaps (Backend Exists, Frontend Doesn't Expose)

These are cases where the backend already supports functionality that users can't access through the UI. Organized by severity.

### Critical

#### 2.1 Server mod toggle broken (active bug)
- **Backend**: `PATCH /api/servers/:id/mods/:modId` toggles enable/disable
- **Frontend**: `client.ts` sends `POST /api/servers/:serverId/mods/:modId/toggle` — wrong HTTP method (POST vs PATCH) and wrong path (`/toggle` suffix doesn't exist)
- **Impact**: Toggling server mods on/off returns 404 every time. Instance mod toggle works fine.
- **Fix**: Change POST to PATCH, remove `/toggle` from path. One line.

### High

#### 2.2 No server permissions management UI
- **Backend**: Full RBAC at `GET/PUT/DELETE /api/servers/:id/permissions/:userId` with `canView`, `canStart`, `canConsole`, `canEdit`, `canJoin`
- **Frontend**: Zero references to permissions. No API method, no UI, no types imported.
- **Impact**: Multi-user RBAC exists in the backend but is invisible. All members have the same access.
- **Fix**: API methods + full permissions management UI per server. High effort.

#### 2.3 No user profile page
- **Backend**: `GET /api/users/me` + `PATCH /api/users/me` for displayName, avatarUrl, password changes
- **Frontend**: `users.ts` defines API methods but they're never imported or called. No profile page exists.
- **Impact**: Users can't change display name, avatar, or password after account creation.
- **Fix**: Profile page/modal. Medium effort. Foundation for gaps 2.4, 2.5, 2.8.

#### 2.4 Mods search excludes launcher instances as install targets
- **Backend**: `POST /api/launcher/instances/:id/mods` installs mods to client instances; full CRUD exists
- **Frontend**: `installInstanceMod()` defined but never called. Mods page only shows servers in the target picker.
- **Impact**: Users can search/browse mods but can only install to servers, not to their game instances.
- **Fix**: Extend ServerPicker to include instances, wire install method. Medium effort.

#### 2.5 Server name, port, javaPath not editable after creation
- **Backend**: `PATCH /api/servers/:id` accepts `name`, `port`, `javaPath`, `jarPath`
- **Frontend**: Only submits `jvmArgs` and `autoStart`. No UI for editing name/port/java path.
- **Impact**: Must delete and recreate server to change its name or port. Loses console history.
- **Fix**: Add editable fields to settings tab. Medium effort.

### Medium

#### 2.6 No Minecraft account linking UI
- **Backend**: `PATCH /api/users/me/minecraft` accepts minecraftUsername + minecraftUuid
- **Frontend**: `updateMinecraftLink()` defined but never called.
- **Impact**: Users can't link their Minecraft identity to their manager account.
- **Fix**: Form in profile page. Low effort.

#### 2.7 No launcher Java management in web UI
- **Backend**: `GET /api/launcher/java` detects installations; `POST /api/launcher/java/download` downloads from Adoptium
- **Frontend**: Only accessible via Electron IPC. Web UI has nothing.
- **Impact**: Web users can't manage Java for the launcher.
- **Fix**: API methods + Java management panel. Medium effort.

#### 2.8 No removeModpack button in UI
- **Backend**: `DELETE /api/servers/:id/modpacks/:modpackId` removes installed modpack
- **Frontend**: `removeModpack()` defined but never called from any component.
- **Impact**: Can't remove an installed modpack through the UI.
- **Fix**: Add delete button to modpack entries. Low effort.

#### 2.9 ModSearchResult rich metadata not displayed
- **Backend**: Returns `categories`, `mcVersions`, `loaders`, `clientSide`, `serverSide`, `lastUpdated`
- **Frontend**: Only renders name, description, icon, source, author, downloads.
- **Impact**: No mod compatibility info visible until expanding version picker.
- **Fix**: Render additional fields in search result cards. Low effort.

#### 2.10 User.minecraftUsername not displayed in admin
- **Backend**: User model includes minecraftUsername, minecraftUuid, lastLoginAt
- **Frontend**: Admin user table doesn't show any of these.
- **Impact**: Admins can't see which Minecraft accounts belong to which users.
- **Fix**: Add columns. Trivial.

#### 2.11 Mod compatibility warnings never surfaced
- **Backend**: `checkCompatibility()` returns `ModCompatibilityWarning[]`
- **Frontend**: Warnings generated during install but never sent to the UI.
- **Impact**: Users install incompatible mods without knowing until runtime failure.
- **Fix**: Add compatibility check endpoint + warning UI before install. Medium effort.

#### 2.12 Frontend doesn't handle 403 Forbidden distinctly
- **Backend**: Returns `ForbiddenError` (403) for permission-denied actions
- **Frontend**: All errors handled generically. No "you don't have permission" messaging.
- **Impact**: Generic error messages instead of clear permission feedback.
- **Fix**: Status-specific error handling. Low effort.

### Low

#### 2.13 No logout-all-sessions UI
- **Backend**: `POST /api/auth/logout-all` revokes all sessions
- **Frontend**: `logoutAll()` defined but never called.
- **Fix**: Button in profile page. Trivial.

#### 2.14 LauncherInstance.icon never displayed or settable
- **Backend**: `UpdateInstanceRequest` accepts `icon`; `LauncherInstance` has `icon` field
- **Frontend**: Never read or set in InstanceCard or InstanceDetail.
- **Fix**: Add icon upload/display. Low effort.

#### 2.15 existingJarPath not exposed in Create Server wizard
- **Backend**: `CreateServerRequest` accepts `existingJarPath` to skip download
- **Frontend**: Wizard always triggers download.
- **Fix**: Add optional file path input to wizard. Low effort.

#### 2.16 LauncherInstance playtime stats not shown
- **Backend**: `lastPlayed` and `totalPlaytime` fields populated
- **Frontend**: Never displayed in InstanceCard or InstanceDetail.
- **Fix**: Render existing data. Trivial.

#### 2.17 getAllDownloadJobs not exposed as route
- **Backend**: `download.ts` exports `getAllDownloadJobs()`; no route calls it.
- **Frontend**: Can only poll individual jobs by ID.
- **Fix**: Add `GET /api/downloads` route + UI. Low effort.

#### 2.18 command:ack WS message unhandled
- **Backend**: Sends `command:ack` after queuing a command
- **Frontend**: No handler. Commands execute but no visual confirmation.
- **Fix**: Toast or inline indicator. Trivial.

#### 2.19 User list filtering not exposed
- **Backend**: `GET /api/users` accepts `?role=admin&active=true`
- **Frontend**: Admin page fetches all users unfiltered.
- **Fix**: Add filter dropdowns. Low effort.

#### 2.20 Form validation doesn't mirror backend Zod rules
- **Backend**: Password min 8/max 128, username regex, UUID format validation
- **Frontend**: Partial validation (min 8 only). Invalid input reaches backend and returns raw Zod errors.
- **Fix**: Mirror Zod constraints in forms. Low effort.

#### 2.21 auth:ok WS message unhandled
- **Backend**: Sends `auth:ok` after JWT verification on WS connection
- **Frontend**: Sends token but never listens for confirmation.
- **Fix**: Optional, helpful for debugging. Trivial.

---

## 3. Feature Gaps (Capabilities That Don't Exist)

Product-level gaps where no implementation exists in backend or frontend. Organized by priority tier.

### Tier 1: Critical (Blocks core workflows or causes data loss risk)

#### 3.1 No Backup & Restore System
- **Current state**: Zero backup functionality. No database tables, no service, no UI. The original plan designed a `backups` table that was never migrated.
- **Gap**: A corrupted chunk, failed modpack install, or accidental deletion destroys world data with no recovery path. Users must manually zip directories.
- **User story**: "As a server owner, I want to create backups before risky changes so that I can roll back if something breaks."
- **Complexity**: Medium
- **Originally planned**: Yes (Phase 2, item 9)

#### 3.2 No Auto-Restart on Crash
- **Current state**: `ServerProcess` detects crashes (non-zero exit, not explicitly stopped) and sets status to `crashed`. No auto-restart logic. The `autoStart` DB column exists but only applies to app boot.
- **Gap**: A server crash at 3 AM stays down until someone manually notices. This is the #1 operational pain point.
- **User story**: "As a server admin, I want my server to auto-restart after a crash so that players can get back online without my intervention."
- **Complexity**: Low (crash detection exists; need retry logic with backoff)
- **Originally planned**: Mentioned as future work, never formally planned

#### 3.3 No Graceful Process Recovery After Manager Restart
- **Current state**: Child processes held in a `Map` in memory. If the Node.js manager restarts or crashes, all running MC servers become orphans. No PID persistence or process reclamation.
- **Gap**: Updating the manager or a manager crash kills all running servers. The original plan identified this risk and recommended PID persistence, but it was never implemented.
- **User story**: "As a server owner, I want my Minecraft servers to keep running if the manager restarts, and for it to reconnect to them."
- **Complexity**: High (PID persistence, process discovery, stdout reattachment)
- **Originally planned**: Risk mitigation documented but not in feature plan

### Tier 2: High-Value Missing Features (Users would expect these)

#### 3.4 No Config File Editor Beyond server.properties
- **Current state**: Only `server.properties` is editable. Paper has `paper.yml`, `paper-global.yml`; Spigot has `spigot.yml`, `bukkit.yml`; Fabric/Forge have per-mod configs. None accessible.
- **Gap**: For modded server users, the most important config files are the loader-specific ones, not `server.properties`. Users need terminal access for basic tuning.
- **User story**: "As a Paper server admin, I want to edit paper.yml and spigot.yml from the UI so I can tune performance without terminal access."
- **Complexity**: Medium (generic YAML/TOML editor or in-browser file browser)
- **Originally planned**: No

#### 3.5 No Player Management UI
- **Current state**: Player tracking works via stdout parsing. Player count and names shown in real-time. But no whitelist/ban/op management, no player history. `PlayerList.tsx` referenced in original plan was never built.
- **Gap**: Managing who can join is a fundamental daily task requiring console commands or direct file edits.
- **User story**: "As a server admin, I want to manage whitelist, bans, and ops from the UI without memorizing commands."
- **Complexity**: Medium
- **Originally planned**: Yes (Phase 2, item 10)

#### 3.6 No Server Import / Migration
- **Current state**: Create Server wizard only supports fresh creation. `existingJarPath` exists in types but isn't exposed (gap 2.15). No "point to existing directory and import" flow.
- **Gap**: Users with existing servers can't adopt this tool without recreating everything. Dealbreaker for migration.
- **User story**: "As a user migrating from manual management, I want to import my existing server directory without losing anything."
- **Complexity**: Medium (detect server type from JAR, parse existing config, register in DB)
- **Originally planned**: Yes (Phase 2, item 14)

#### 3.7 No Scheduled Tasks / Automation
- **Current state**: Zero scheduling capability. A `scheduled_tasks` table was designed in the original plan but never migrated.
- **Gap**: Scheduled restarts, backups, and timed announcements are table-stakes for server management tools.
- **User story**: "As a server admin, I want to schedule nightly restarts and daily backups so the server stays healthy automatically."
- **Complexity**: Medium-High
- **Originally planned**: Yes (Phase 3, item 15)

#### 3.8 No Performance Monitoring / Metrics
- **Current state**: Real-time player count, uptime, and basic info via WebSocket. No TPS, no memory tracking, no historical data. A `metrics` table was designed but never created.
- **Gap**: When players report lag, there's no data to diagnose TPS drops, memory pressure, or trends.
- **User story**: "As a server admin, I want to see TPS, memory, and player count over time to diagnose performance issues."
- **Complexity**: Medium
- **Originally planned**: Yes (Phase 3, item 16)

#### 3.9 No World Management
- **Current state**: Server directories contain world folders but the app provides zero world-level operations.
- **Gap**: Resetting the Nether, uploading custom maps, or switching worlds requires terminal access.
- **User story**: "As a server admin, I want to manage worlds (list, switch, reset, upload) from the UI."
- **Complexity**: Medium
- **Originally planned**: Yes (Phase 3, item 18)

#### 3.10 Client-Server Mod Synchronization
- **Current state**: Mods can be installed on servers and (once wiring gap 2.4 is fixed) on client instances. But there's no concept of "sync client mods to match server."
- **Gap**: Getting the right client mods to match a modded server is the #1 friction point in modded Minecraft. The app manages both sides but has no bridge.
- **User story**: "As a player, I want my client instance to automatically match the server's mod list."
- **Complexity**: High (diff server vs instance mods, handle client/server-only distinctions, download missing)
- **Originally planned**: No

### Tier 3: Quality-of-Life Improvements

#### 3.11 No Dashboard Search/Filter/Sort
- **Current state**: Flat grid of server cards. No search, filter by status, sort by name/player count, or grouping.
- **Gap**: Fine for 2-3 servers, unwieldy at 10+. The app supports multi-server but the dashboard doesn't scale.
- **Complexity**: Low
- **Originally planned**: No

#### 3.12 No Keyboard Shortcuts
- **Current state**: Zero keyboard shortcuts anywhere.
- **Gap**: Power users expect shortcuts for focus console, send command, switch tabs, navigate servers.
- **Complexity**: Low
- **Originally planned**: No

#### 3.13 No Console Command Autocomplete
- **Current state**: Command input has up/down arrow history but no autocomplete for Minecraft commands.
- **Gap**: Every terminal tool has autocomplete. Its absence feels jarring.
- **Complexity**: Medium (command dictionary; optional dynamic completion from `help`)
- **Originally planned**: No

#### 3.14 No Notifications / Alerts
- **Current state**: Toast notifications in the active browser tab for user-initiated actions. No push/desktop/webhook notifications for background events.
- **Gap**: Crashes, disk warnings, and task failures happen silently unless the user is watching.
- **User story**: "As a server admin, I want notifications when my server crashes, even when I'm not looking at the dashboard."
- **Complexity**: Medium (browser notifications + optional webhook/Discord)
- **Originally planned**: Yes (Phase 3, item 19)

#### 3.15 No Log Search / Alert Patterns
- **Current state**: LogViewer browses historical log files. No full-text search, regex filtering, or pattern alerts.
- **Gap**: Troubleshooting means manually scrolling logs. Search turns a 20-minute task into 10 seconds.
- **Complexity**: Low-Medium
- **Originally planned**: Partially (Phase 2 log viewer exists, search does not)

#### 3.16 No Dark/Light Theme Toggle
- **Current state**: Hard-coded dark theme. Toaster explicitly configured with dark styles.
- **Gap**: Some users prefer light themes, especially on mobile or in bright environments.
- **Complexity**: Low
- **Originally planned**: No (original plan mentioned "theme" in settings page but never specified)

#### 3.17 No Mobile Responsive Design for Key Flows
- **Current state**: Basic responsive sidebar. Console, Mods page two-column layout, and modpack review modal don't have mobile-specific layouts.
- **Gap**: Server admins frequently check on servers from phones.
- **Complexity**: Medium
- **Originally planned**: No

#### 3.18 No Audit / Activity Log
- **Current state**: Pino structured logging for backend debugging. No user-facing activity log recording who did what.
- **Gap**: In multi-user deployments, no accountability. Can't trace who changed configs or installed mods.
- **User story**: "As the server owner with multiple admins, I want an activity log of who did what."
- **Complexity**: Medium
- **Originally planned**: No

#### 3.19 No Mod Dependency Resolution
- **Current state**: One-at-a-time mod install. `ModVersion.dependencies` array exists with required/optional/incompatible types but is never acted upon.
- **Gap**: Installing a mod that requires another silently fails at server startup. Users discover dependencies through crash logs.
- **User story**: "As a server admin, I want the tool to warn about missing dependencies and offer to install them."
- **Complexity**: Medium
- **Originally planned**: No (extends wiring gap 2.11)

#### 3.20 No Bulk Mod Updates
- **Current state**: Modpack update detection works. Individual mod update checking does not exist.
- **Gap**: Servers with 50+ mods need bulk update checking, not one-at-a-time management.
- **Complexity**: Medium
- **Originally planned**: No

#### 3.21 No Mod List Export/Import
- **Current state**: `ModpackExportData` interface exists in shared types. No export or import functionality implemented.
- **Gap**: Can't replicate mod setups between servers or share configurations.
- **Complexity**: Low (types already defined)
- **Originally planned**: No

#### 3.22 No Destructive Console Command Confirmation
- **Current state**: Console sends any command directly to stdin. No interception for dangerous commands (`/stop`, `/kill @e`, large `/fill`).
- **Gap**: Accidental commands can disrupt gameplay.
- **Complexity**: Low (dangerous command prefix list + confirmation dialog)
- **Originally planned**: No

### Tier 4: Future Differentiators

#### 3.23 Server Network Support (BungeeCord/Velocity)
- **Current state**: Servers managed independently. No proxy network concept.
- **Gap**: Server networks (hub → survival → creative) are common advanced deployments.
- **Complexity**: Very High
- **Originally planned**: No

#### 3.24 Plugin / Integration API
- **Current state**: REST API designed for the frontend only. No docs, no API keys, no webhooks.
- **Gap**: Advanced users want Discord bot integration, Grafana monitoring, custom automation.
- **Complexity**: Medium
- **Originally planned**: No

#### 3.25 Server Templates / Quick Deploy
- **Current state**: Creation wizard starts from scratch every time.
- **Gap**: Users who frequently create similar servers repeat the same configuration.
- **Complexity**: Low-Medium
- **Originally planned**: No

#### 3.26 Docker Deployment
- **Current state**: Runs directly on host OS. No containerization.
- **Gap**: Docker is the standard deployment method for self-hosted tools.
- **Complexity**: Medium
- **Originally planned**: Yes (Phase 3, item 21)

#### 3.27 Integrated Tunneling / Remote Access
- **Current state**: UPnP + ACME/TLS exist. No tunneling for users behind CGNAT.
- **Gap**: Many home users can't port-forward. Tools like playit.gg or Cloudflare Tunnels solve this but require separate setup.
- **Complexity**: Medium
- **Originally planned**: No

#### 3.28 Resource Pack Management
- **Current state**: `resource-pack` field in server.properties. No upload, hosting, or auto-distribution.
- **Gap**: Resource packs are common for custom servers. Managing them through properties alone is clunky.
- **Complexity**: Medium
- **Originally planned**: No

---

## 4. Risk Areas

Preserved from the original architecture plan. These are design risks that still apply.

### High Risk

**Process lifecycle reliability** — The #1 thing that makes the app feel broken is servers in inconsistent states (UI says "running" but process is dead, or process running but app lost track). Current mitigations: status updates on process exit events, port conflict pre-check. Missing mitigations: PID persistence in DB, periodic health checks against OS process table, orphan detection on app restart (see gap 3.3).

**Console output volume** — Minecraft can emit hundreds of lines/sec during world generation. Current mitigations: ring buffer (configurable, default 1000 lines), 100ms batching of WS console messages, `@tanstack/react-virtual` for virtualized rendering.

**Graceful shutdown** — If the manager process dies, running MC servers become orphans. Current mitigations: SIGINT/SIGTERM handlers send `stop` to all servers. Missing mitigations: PID persistence, orphan reclamation on restart (see gap 3.3).

### Medium Risk

**server.properties parsing** — Java properties format has edge cases (Unicode escapes, multiline values, BOM). Currently handled by a hand-rolled parser that works for standard Minecraft properties.

**Port management** — The creation wizard suggests next available port and validates uniqueness. OS-level port availability is checked before start.

**EULA acceptance** — Auto-written during creation. A notice should explain what the user is agreeing to.

**WebSocket reconnection** — Frontend WS client has auto-reconnect with exponential backoff (1s → 30s cap). Re-subscribes on reconnect. Console history buffer resent on subscribe.

### Low Risk

**Java version compatibility** — Different MC versions need different Java versions. The creation wizard warns about incompatibility. A lookup table maps MC version → minimum Java version.

**Disk space** — Server worlds can grow to many GB. Backups multiply this. No disk usage monitoring exists (see gap 3.8).

**Anti-virus interference** — On Windows, AV may block Java processes or downloaded JARs. Good error messages help but this is outside the app's control.

---

## 5. Technical Decisions & Rationale

### Library Choices (Why These Specific Tools)

| Choice | Pick | Reasoning |
|--------|------|-----------|
| HTTP framework | Express | Ecosystem maturity. Performance irrelevant for single/few-user local app. |
| WebSocket | ws (not socket.io) | Pure WebSocket, no custom protocol. Socket.io's features (rooms, auto-reconnect) are trivially implemented in 50 lines. |
| Database | better-sqlite3 | Synchronous API = simpler code. No connection pooling. WAL mode handles concurrent reads. |
| Validation | Zod | Type-safe request validation with TypeScript inference. Schema = type. |
| Frontend state | Zustand | Minimal boilerplate, works with imperative WS callbacks. No providers. |
| Styling | Tailwind CSS v4 | Utility-first for dashboards. No CSS file context-switching. |
| Logging | Pino | Structured JSON logging, fast. |
| IDs | nanoid | Short, URL-safe, ergonomic in URLs. |
| Process management | child_process.spawn | Built-in, streaming stdio. |
| Build/dev | tsx (backend) + Vite (frontend) | tsx = instant TS execution. Vite = standard frontend dev server. |

### Key Architectural Decisions

**stdin for commands, not RCON** — RCON requires additional setup and isn't enabled by default. Piping to stdin works universally for all server types.

**Ring buffer for console output** — 1000 lines default, configurable. Prevents unbounded memory growth. Historical output goes to disk via Minecraft's own log rotation.

**One `ServerProcess` per server in a `Map`** — ServerManager singleton holds the map. Simple, predictable. The tradeoff is no process survival across manager restarts (gap 3.3).

**No ORM** — Raw SQL with prepared statements. 9 migrations, still simple enough. Could add Drizzle later if schema complexity grows.

**WebSocket multiplexing** — Single WS endpoint, messages multiplexed by `serverId`. Client subscribes per-server. Avoids connection sprawl.

### Planned-But-Unused Database Schemas

These schemas were designed in the original plan for future features. They haven't been migrated yet. Preserved here for reference when implementing the corresponding features.

```sql
-- For gap 3.1 (Backup & Restore)
CREATE TABLE backups (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- For gap 3.7 (Scheduled Tasks)
CREATE TABLE scheduled_tasks (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  task_type     TEXT NOT NULL,             -- backup | restart | command
  cron_expr     TEXT NOT NULL,
  payload       TEXT,                      -- JSON (e.g. command to run)
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- For gap 3.8 (Performance Metrics)
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

---

## 6. Build Order

Phased execution plan. Within each phase, order reflects dependencies (top items unblock bottom items). Each item notes whether it needs a new spec, an existing spec update, or a direct fix.

### Phase A: Bug Fixes & Wiring Gaps (Direct fixes — no specs needed)

Small enough to fix directly without the spec workflow. Do these first to stabilize what exists.

1. **Fix mod toggle bug** (gap 2.1) — one-line fix, critical, unblocks server mod management
2. **Server name/port/javaPath editable** (gap 2.5) — add fields to settings tab
3. **User profile page** (gap 2.3) — unlocks password change, Minecraft linking (2.6), logout-all (2.13)
4. **Instance mod install from search** (gap 2.4) — extend Mods page picker to include launcher instances
5. **Modpack remove button** (gap 2.8) — wire existing `removeModpack()` API method
6. **ModSearchResult metadata** (gap 2.9) — render compatibility fields already returned by backend
7. **Minecraft account linking** (gap 2.6) — add form to profile page (depends on item 3)
8. **Launcher Java management in web UI** (gap 2.7) — API methods + Java panel in launcher section
9. **Mod compatibility warnings** (gap 2.11) — surface `checkCompatibility()` results before install
10. **403 error handling** (gap 2.12) — status-specific error messages in API client
11. **Remaining low wiring gaps** (2.10, 2.13–2.21) — in any order

### Phase B: Core Infrastructure (NEW specs to create)

Foundational reliability and data safety. Everything else is undermined without these.

| Order | Spec | Covers Gaps | Complexity | Rationale |
|-------|------|-------------|------------|-----------|
| B1 | `server-resilience` | 3.2 (auto-restart on crash), 3.3 (process recovery after manager restart) | Medium-High | The #1 reliability risk. Auto-restart is low effort and massive impact. Process recovery is harder but critical — manager restarts currently kill all servers. |
| B2 | `backup-restore` | 3.1 (backup & restore) | Medium | Prevents data loss. Must exist before scheduled tasks (which automate backups) and before world management (which needs pre-operation snapshots). DB schema already designed (see section 5). |
| B3 | `player-management` | 3.5 (whitelist, ban, op, player history) | Medium | Daily operational need. Also a prerequisite for shared-minecraft-servers (auto-whitelist management). |

### Phase C: Server Operations (NEW specs to create)

Builds on Phase B's foundation to complete the server management story.

| Order | Spec | Covers Gaps | Complexity | Rationale |
|-------|------|-------------|------------|-----------|
| C1 | `config-file-editor` | 3.4 (paper.yml, spigot.yml, bukkit.yml, per-mod configs) | Medium | Unlocks modded server tuning. Users of Paper/Fabric/Forge need this more than server.properties. |
| C2 | `server-import` | 3.6 (import existing server directory) | Medium | Removes adoption barrier. Users with existing servers can't use the tool without this. |
| C3 | `scheduled-tasks` | 3.7 (cron-like restart, backup, commands, timed announcements) | Medium-High | Depends on B1 (restart logic) and B2 (backup service). Automates the manual operations from Phase B. DB schema already designed (see section 5). |
| C4 | `performance-monitoring` | 3.8 (TPS, memory, player count over time, historical charts) | Medium | Adds observability. DB schema already designed (see section 5). |
| C5 | `world-management` | 3.9 (list, switch, reset, upload, delete worlds) | Medium | Depends on B2 (should backup before destructive world operations). |

### Phase D: Social & Community (EXISTING specs — validate & update)

These specs exist with full requirements/design/tasks but haven't been implemented. They need validation before execution:
- **Migration numbers**: All assume 009 is the latest, but codebase-cleanup and other specs may have shifted numbering.
- **File references**: Tasks reference `plans/EPIC-N-*.md` files that may no longer exist — inline or update references.
- **Code assumptions**: Verify that services, models, and routes referenced in task prompts still match current code after 7 completed specs of changes.

| Order | Existing Spec | Covers Gaps | Validation Needed |
|-------|--------------|-------------|-------------------|
| D1 | `shared-minecraft-servers` | 2.2 (permissions UI), server sharing, community browsing | Check migration number. Verify server-permission.ts model matches task assumptions. Verify `plans/EPIC-7-shared-servers.md` refs. |
| D2 | `friends-text-chat` | Friends, presence, DMs, text channels | Check migration number. Verify WS handler structure. Verify `plans/EPIC-6-friends-chat.md` refs. Can run parallel with D1. |
| D3 | `voice-communication` | Voice channels via LiveKit | Check migration number. Verify LiveKit version/download URLs still valid. Verify `plans/EPIC-8-voice.md` refs. Can run parallel with D1/D2. |
| D4 | `mod-sync` | 3.10 (client-server mod sync) | **Must come after D1** (depends on shared-minecraft-servers). Verify community route assumptions. Verify `plans/EPIC-9-mod-sync.md` refs. |

### Phase E: Quality of Life (NEW specs to create)

Self-contained improvements. Can run in any order, or in parallel with Phase C/D when there's bandwidth. Grouped by natural affinity — each spec bundles 2-3 related gaps.

| Order | Spec | Covers Gaps | Complexity |
|-------|------|-------------|------------|
| E1 | `dashboard-ux` | 3.11 (search/filter/sort), 3.12 (keyboard shortcuts), 3.16 (dark/light theme) | Low-Medium |
| E2 | `console-enhancements` | 3.13 (command autocomplete), 3.22 (destructive command confirmation) | Medium |
| E3 | `mod-workflow` | 3.19 (dependency resolution), 3.20 (bulk updates), 3.21 (export/import mod lists) | Medium |
| E4 | `log-search-alerts` | 3.15 (full-text log search, regex filter, pattern alerts) | Low-Medium |
| E5 | `notifications` | 3.14 (browser/desktop push, optional webhook/Discord) | Medium |
| E6 | `audit-log` | 3.18 (user-facing activity log: who did what, when) | Medium |
| E7 | `mobile-responsive` | 3.17 (mobile layouts for console, mods, modals) | Medium |

### Phase F: Differentiators (NEW specs to create — long-term)

Features that would set this apart from competitors. Only pursue after Phases B–D are solid.

| Order | Spec | Covers Gaps | Complexity |
|-------|------|-------------|------------|
| F1 | `docker-deployment` | 3.26 (Dockerfile, Compose, containerized MC servers) | Medium |
| F2 | `integration-api` | 3.24 (documented API, API keys, webhooks for Discord/Grafana) | Medium |
| F3 | `server-templates` | 3.25 (save config as template, one-click deploy) | Low-Medium |
| F4 | `tunneling` | 3.27 (playit.gg or Cloudflare Tunnel for users behind CGNAT) | Medium |
| F5 | `server-networks` | 3.23 (BungeeCord/Velocity proxy management) | Very High |
| F6 | `resource-packs` | 3.28 (upload, host, auto-distribute resource packs) | Medium |

### Summary

| Action | Count | Items |
|--------|-------|-------|
| Fix directly (no spec) | ~15 wiring gaps | Phase A |
| Create new specs | 18 | B1–B3, C1–C5, E1–E7, F1–F6 |
| Validate & update existing specs | 4 | D1–D4 |
| Already complete | 7 | electron-migration, multi-user-foundation, electron-desktop-builds, application-logging, testing-suite, launcher-download-progress, codebase-cleanup |

**Critical path**: A → B1 → B2 → B3 → C1–C5 → D1–D4. Phase E can run in parallel with C or D.
