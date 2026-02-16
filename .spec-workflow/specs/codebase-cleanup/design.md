# Design Document

## Overview

This spec addresses 7 categories of code quality issues found during a comprehensive codebase audit. All changes are internal refactors — no new features, no API contract changes, no database migrations. The goal is to reduce maintenance cost and improve developer experience before the next wave of feature specs (friends-chat, shared-servers, voice-communication, mod-sync).

The work spans all four packages (backend, frontend, shared, electron) but is predominantly backend-focused. Each change is independently verifiable and introduces no new runtime dependencies.

## Steering Document Alignment

Per `tech.md`: The project uses TypeScript strict mode, Zod for validation, Pino for logging, and custom error classes (`AppError`, `NotFoundError`, etc.) in `utils/errors.ts`. This design extends those existing patterns rather than introducing new ones.

Per `structure.md`: New utilities go in `packages/backend/src/utils/` (validation helper). Shared type changes happen in `shared/src/index.ts`. No new files are created in frontend except modifications to `api/client.ts`.

Per `product.md`: This cleanup supports the "minimal external dependencies" and "single codebase" principles — it removes duplication and tightens type safety without adding packages.

## Code Reuse Analysis

### Existing Code to Leverage

- **`packages/backend/src/utils/errors.ts`**: Already has `AppError` (base), `NotFoundError` (404), `ValidationError` (400), `ConflictError` (409), `UnauthorizedError` (401), `ForbiddenError` (403). REQ-2 will use these directly — no new error classes needed.
- **`packages/backend/src/app.ts:82-123`**: Express error middleware already handles `AppError` subclasses and returns structured JSON `{ error, code }`. No changes needed here.
- **`packages/backend/src/routes/validation.ts`**: Existing Zod schemas. The new validation utility will live alongside these.
- **`packages/frontend/src/api/client.ts`**: Contains both `request()` and `authFetch()`. REQ-3 merges them.
- **`shared/src/index.ts`**: All shared types. REQ-4 modifies existing types in place.

### Integration Points

- **Express error middleware** (`app.ts:82-123`): Catches `AppError` subclasses and returns appropriate HTTP status. Services that currently throw raw `Error` fall through to the generic 500 handler. After REQ-2, they'll be caught by the `AppError` branch instead.
- **Frontend `ApiError`** (`api/client.ts:41-50`): The frontend's `ApiError` class extracts `status`, `message`, and `code` from response JSON. After REQ-2, it will receive more accurate status codes from the backend.

### Shared Types Already Available

- `ServerType`, `ServerStatus`, `ModLoader`, `LoaderType`, `VersionType` — modified by REQ-4
- `MojangVersionManifest`, `MojangVersionEntry` — kept as canonical types by REQ-4
- `VersionManifest`, `MinecraftVersion` — removed/replaced by REQ-4
- `AppSettings` — referenced by REQ-6 settings.ts fix

## Architecture

No architectural changes. All modifications are within existing files. The data flow remains:

```
Routes (HTTP) --> Services (business logic) --> Models (SQLite)
                        |
                        +---> ServerManager --> ServerProcess (child_process.spawn)
                        +---> File I/O (server.properties, JARs)

WebSocket Server ---> Same services, different transport
```

### Design Principles Applied

- **Single File Responsibility**: The new validation utility is one file (`utils/validation.ts`) with one function. It doesn't absorb other concerns.
- **Transport Separation**: Error class migration (REQ-2) happens in services, not routes. Routes already delegate to services — they just get better errors back now.
- **Minimal Surface Area**: No new exports from shared beyond what's needed. Type aliases replace removed types to minimize import-site changes.

## Components and Interfaces

### Component 1: Validation Utility (`packages/backend/src/utils/validation.ts`)

- **Purpose**: Single function to validate input against a Zod schema and throw `ValidationError` on failure.
- **Interfaces**:
  ```typescript
  import { z } from "zod";
  import { ValidationError } from "./errors.js";

  /**
   * Validate input against a Zod schema.
   * Returns the parsed (typed) data on success.
   * Throws ValidationError with formatted message on failure.
   */
  export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new ValidationError(message);
    }
    return result.data;
  }
  ```
- **Dependencies**: `zod`, `./errors.js`
- **Reuses**: Existing `ValidationError` class which already sets status 400 and code `VALIDATION_ERROR`

### Component 2: Consolidated API Client (`packages/frontend/src/api/client.ts`)

- **Purpose**: Single fetch wrapper with auth headers, token refresh, and error handling.
- **Interfaces**:
  ```typescript
  /**
   * Unified fetch wrapper. Attaches auth token, refreshes on 401, throws ApiError.
   * @param path - API path (e.g., "/api/servers")
   * @param options - Standard RequestInit
   * @param skipRefresh - Set true for the refresh endpoint itself (prevents loops)
   */
  async function request<T>(
    path: string,
    options?: RequestInit,
    skipRefresh?: boolean,
  ): Promise<T>
  ```
- **Dependencies**: `@/utils/desktop` (for `getBackendBaseUrlSync`)
- **Reuses**: Existing `ApiError` class (unchanged), existing `localStorage` token storage
- **Change**: The current `request()` (no refresh) and `authFetch()` (with refresh) merge into a single `request()` that always handles refresh. A `skipRefresh` parameter prevents infinite loops on `/api/auth/refresh`. The `authFetch` named export is removed; `users.ts`, `invitations.ts`, and `auth.ts` are updated to use `api.*` methods or `request()` directly.

### Component 3: Shared Type Cleanup (`shared/src/index.ts`)

- **Purpose**: Eliminate duplicate version manifest types and clarify the `ModLoader`/`LoaderType` relationship.
- **Changes**:

  **Version manifest types:**
  ```typescript
  // KEEP as canonical (lines 764-780):
  export interface MojangVersionManifest { ... }
  export interface MojangVersionEntry { ... }

  // REPLACE MinecraftVersion (currently line 841-848) with:
  /** Launcher-side version entry (subset of MojangVersionEntry, no complianceLevel) */
  export type MinecraftVersion = Omit<MojangVersionEntry, "complianceLevel">;

  // REPLACE VersionManifest (currently line 850-856) with:
  /** Launcher-side version manifest */
  export interface VersionManifest {
    latest: { release: string; snapshot: string };
    versions: MinecraftVersion[];
  }
  ```

  **Loader types:**
  ```typescript
  // KEEP ModLoader as-is (line 479):
  export type ModLoader = "forge" | "fabric" | "neoforge";

  // CHANGE LoaderType (line 784) from standalone to derived:
  /** Launcher supports all server mod loaders plus Quilt (client-side only) */
  export type LoaderType = ModLoader | "quilt";
  ```

- **Dependencies**: None
- **Impact**: All import sites continue to work — `MinecraftVersion` and `VersionManifest` still exist as exported names.

### Component 4: Settings Type Fix (`packages/backend/src/services/settings.ts`)

- **Purpose**: Remove `as unknown as AppSettings` double-cast.
- **Change**: Build the result object as `AppSettings` directly by constructing it field by field with proper types instead of building a `Record<string, string | number | boolean>` and casting.
  ```typescript
  export function getAllSettings(): AppSettings {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const stored: Record<string, string> = {};
    for (const row of rows) {
      stored[row.key] = row.value;
    }

    return {
      javaPath: stored.javaPath ?? DEFAULTS.javaPath,
      dataDir: stored.dataDir ?? DEFAULTS.dataDir,
      defaultJvmArgs: stored.defaultJvmArgs ?? DEFAULTS.defaultJvmArgs,
      maxConsoleLines: stored.maxConsoleLines
        ? parseInt(stored.maxConsoleLines, 10) || DEFAULTS.maxConsoleLines
        : DEFAULTS.maxConsoleLines,
      curseforgeApiKey: stored.curseforgeApiKey ?? DEFAULTS.curseforgeApiKey,
      showOverridePreview: stored.showOverridePreview
        ? stored.showOverridePreview === "true"
        : DEFAULTS.showOverridePreview,
    };
  }
  ```
- **Reuses**: Existing `DEFAULTS` constant, existing `SETTING_KEYS`

### Component 5: WebSocket Message Validation (`packages/backend/src/ws/handlers.ts`)

- **Purpose**: Replace `as unknown as WsClientMessage` casts with proper field access and validation.
- **Change**: Instead of casting the entire `msg` object, read individual fields with type checks:
  ```typescript
  switch (msg.type) {
    case "subscribe": {
      const serverId = typeof msg.serverId === "string" ? msg.serverId : "";
      handleSubscribe(ws, serverId);
      break;
    }
    case "unsubscribe": {
      const serverId = typeof msg.serverId === "string" ? msg.serverId : "";
      handleUnsubscribe(ws, serverId);
      break;
    }
    case "command": {
      const serverId = typeof msg.serverId === "string" ? msg.serverId : "";
      const command = typeof msg.command === "string" ? msg.command : "";
      handleCommand(ws, serverId, command);
      break;
    }
    // ...
  }
  ```
- **Reuses**: Existing `handleSubscribe`, `handleUnsubscribe`, `handleCommand` functions (unchanged). Existing `sendMessage` helper. The handler functions already validate for empty `serverId`/`command`.

### Component 6: Electron Port Fix (`packages/electron/src/main.ts`)

- **Purpose**: Propagate `BACKEND_PORT` to `process.env` so `launcher.ts` reads the correct value.
- **Change**: One line addition after `startBackend()`:
  ```typescript
  async function main(): Promise<void> {
    setElectronEnv();
    await app.whenReady();
    registerIpcHandlers();

    if (!isDev) {
      await startBackend();
    }

    // Propagate for launcher.ts and other modules that read BACKEND_PORT
    process.env.BACKEND_PORT = String(BACKEND_PORT);

    // ... rest unchanged
  }
  ```

## Data Models

No new data models. No database migrations. No schema changes.

## API Endpoints

No new API endpoints. Existing endpoints preserve their request/response contracts. The only behavioral change: service-layer errors that currently return HTTP 500 will return more specific status codes (400, 404, 409, 502) after REQ-2.

## WebSocket Events

No new WebSocket events. The WebSocket message handler (`ws/handlers.ts`) is refactored internally but the client-visible protocol is unchanged.

## Error Handling

### Error Scenarios

1. **Service throws for missing resource (e.g., "No Forge versions found for MC 1.21")**
   - **Before**: `throw new Error(msg)` → caught by generic handler → HTTP 500
   - **After**: `throw new NotFoundError("Forge versions", mcVersion)` → caught by `AppError` handler → HTTP 404 `{ error: "...", code: "NOT_FOUND" }`
   - **User Impact**: Frontend receives 404 instead of 500 — can show a meaningful "not found" message instead of "Internal server error"

2. **Provider fails to reach external API (e.g., Paper API returns 503)**
   - **Before**: `throw new Error("Failed to fetch Paper versions: 503")` → HTTP 500
   - **After**: `throw new AppError("Failed to fetch Paper versions: 503 Service Unavailable", 502, "UPSTREAM_ERROR")` → HTTP 502
   - **User Impact**: Frontend can distinguish between "our server broke" (500) and "external service is down" (502)

3. **Provider receives corrupt/unexpected response**
   - **Before**: `throw new Error("SHA256 mismatch")` → HTTP 500
   - **After**: `throw new AppError("SHA256 mismatch: expected X, got Y", 502, "INTEGRITY_ERROR")` → HTTP 502
   - **User Impact**: Same as above — clearer error attribution

4. **Cancellation throws (download/prepare aborted)**
   - **Before and After**: `throw new Error("Cancelled")` — unchanged. These are caught internally by the download/prepare job logic and never propagate to HTTP.

## Verification Strategy

### Build Verification

- `npm run build` must pass with zero errors after each task
- `npm test` must pass (existing 136 tests must remain green)

### Manual Testing Checklist

1. **Validation utility**: Start a server, send a `POST /api/servers` with an invalid body → verify the response is still `400` with the same error format as before
2. **Error migration**: Trigger a version fetch for a nonsupported type → verify the response is `400` (not `500`)
3. **API client**: Log in, wait for access token to expire, perform an API action → verify auto-refresh still works
4. **Shared types**: `npm run build` succeeds (TypeScript will catch any import/usage mismatches)
5. **Settings cast**: Load app settings page → verify settings load correctly
6. **WebSocket**: Open console, subscribe to a server, send a command → verify all work as before
7. **Electron port**: (if testing Electron) Set `PORT=3005`, launch Electron app, verify game launching attempts connect to port 3005

### Parity / Migration Checks

| Existing Behavior | New Implementation | Verify |
|---|---|---|
| Validation returns `400` with `{ error: "path: msg; path2: msg2", code: "VALIDATION_ERROR" }` | Same format via `validate()` utility | Compare response bodies before/after |
| Service errors return `500` | Service errors return appropriate 4xx/5xx | Check specific error scenarios return correct codes |
| `authFetch()` refreshes token on 401 | `request()` refreshes token on 401 | Log in, wait for token expiry, make API call |
| `MinecraftVersion` / `VersionManifest` types compile | Same names still compile | `npm run build` succeeds |

## Implementation Order

1. **Shared type cleanup** (REQ-4) — No dependencies. Changes type definitions that downstream tasks reference. Must go first so all packages build cleanly.
2. **Validation utility** (REQ-1) — New file, no dependencies on other tasks. Foundation for REQ-5.
3. **Route param/query validation** (REQ-5) — Depends on (2) for the `validate()` utility.
4. **Service error migration** (REQ-2) — Independent of (2)/(3) but logically follows. Largest task by volume.
5. **Settings and WebSocket type fixes** (REQ-6) — Small, focused fixes. Independent of other tasks.
6. **Frontend API client consolidation** (REQ-3) — Frontend-only. Independent of backend tasks.
7. **Electron port fix** (REQ-7) — One line. Independent of everything else.

Each step can be verified independently via `npm run build` + `npm test` before proceeding.

## Migration / Backward Compatibility

All changes are internal refactors. The external API surface (HTTP endpoints, WebSocket messages, response shapes) is preserved exactly, with one intentional improvement: service errors now return appropriate HTTP status codes instead of always 500.

No database migration is needed. No new npm dependencies are added. The `MinecraftVersion` and `VersionManifest` type names continue to exist as exported aliases, so frontend import sites require zero changes for the type rename.
