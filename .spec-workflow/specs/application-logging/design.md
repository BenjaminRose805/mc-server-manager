# Design Document

## Overview

This spec adds consistent, structured logging across the backend and frontend to close the observability gaps identified in the logging audit. On the backend, this means enhancing the existing Pino logger usage: enriching the error middleware with request context, adding logging to silent catch blocks, and instrumenting auth/session/rate-limit middleware. On the frontend, this means creating a lightweight logger utility and replacing silent catch blocks and toast-only error handling with structured log calls.

No new API endpoints, database tables, WebSocket events, or npm dependencies are introduced. This is purely additive — every change adds logging alongside existing behavior without modifying control flow.

## Steering Document Alignment

Per `tech.md`: Pino 9.x is the established logging library. The design extends its usage to currently-unlogged areas rather than introducing alternatives. Per `structure.md`: new utilities follow the existing pattern — backend utilities in `packages/backend/src/utils/`, frontend utilities in `packages/frontend/src/utils/`. Per `product.md`: self-hosted operators need visibility into their instance without external services, so all logging goes to stdout/console (no SaaS dependencies).

## Code Reuse Analysis

### Existing Code to Leverage

- **`packages/backend/src/utils/logger.ts`**: Existing Pino logger instance. All backend logging additions import from here. No changes needed to this file.
- **`packages/backend/src/utils/errors.ts`**: `AppError` base class with `statusCode` and `code` properties. The error middleware enhancement reads these fields.
- **`packages/backend/src/middleware/rate-limit.ts`**: Existing `authRateLimit` using `express-rate-limit`. Will add a `handler` callback for logging rejections.
- **`packages/backend/src/middleware/auth.ts`**: Existing auth middleware (`requireAuth`, `requireRole`, etc.). Will add `logger.warn` on rejection paths.
- **`packages/backend/src/ws/handlers.ts`**: Existing WebSocket handlers. Will add logging to auth success/failure and disconnect paths.
- **`packages/backend/src/services/brute-force.ts`**: Existing brute-force service. Will add logging to lockout detection and attempt recording.
- **`packages/backend/src/services/session.ts`**: Existing session service. Will add logging to session lifecycle operations.
- **`packages/frontend/src/components/ErrorBoundary.tsx`**: Existing error boundary. Will replace `console.error` with the new frontend logger.

### Integration Points

- **Express error middleware** (`app.ts:79-101`): Enhanced to log all errors with request context.
- **Rate limit middleware** (`rate-limit.ts`): `handler` option added to log rejections.
- **Auth middleware** (`middleware/auth.ts`): Logger calls added to each rejection branch.
- **WebSocket handlers** (`ws/handlers.ts`, `ws/index.ts`): Logger calls added to auth and disconnect events.
- **All frontend catch blocks**: Updated to call the new logger before/alongside existing toast/error-state handling.

### Shared Types Already Available

No new shared types needed. This spec uses only logging — no cross-package interfaces.

## Architecture

```
BACKEND (Pino logger — already exists)
├── app.ts error middleware ─── enhanced with req context logging
├── middleware/
│   ├── auth.ts ────────────── add warn logs on rejection
│   └── rate-limit.ts ─────── add handler callback for rejection logging
├── services/
│   ├── brute-force.ts ─────── add logger import + lockout/attempt logging
│   ├── session.ts ─────────── add logger import + session lifecycle logging
│   ├── auth.ts ────────────── add debug log for argon2 failures
│   ├── jwt.ts ─────────────── add debug log for verification failures
│   ├── server-manager.ts ──── add warn logs in shutdown catch blocks
│   └── process.ts ─────────── add warn log for stdin write failure
├── ws/
│   └── handlers.ts ────────── add auth success/fail + disconnect logging
└── providers/ + other services ── upgrade empty catches to logger.debug

FRONTEND (new logger utility)
├── utils/logger.ts ────────── NEW: structured browser logger
├── components/ErrorBoundary.tsx ── replace console.error with logger
├── contexts/AuthContext.tsx ────── add logger to silent catch blocks
├── api/ws.ts ──────────────────── add logger to connection/parse errors
├── api/client.ts ──────────────── add logger to error paths (optional debug)
├── pages/*.tsx ─────────────────── add logger to catch blocks
└── components/*.tsx ────────────── add logger alongside toast notifications
```

### Design Principles Applied

- **Single File Responsibility**: The frontend logger is a standalone utility. Each file's logging additions are self-contained.
- **Transport Separation**: No business logic changes. Logging is orthogonal to control flow.
- **Minimal Surface Area**: No new APIs, no new IPC channels, no new dependencies.

## Components and Interfaces

### Component 1: Frontend Logger (`packages/frontend/src/utils/logger.ts`)

- **Purpose**: Structured browser logging utility with level filtering and consistent output format.
- **Interfaces**:
  ```typescript
  type LogLevel = 'debug' | 'info' | 'warn' | 'error';

  interface LogContext {
    [key: string]: unknown;
  }

  interface Logger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
  }

  export const logger: Logger;
  ```
- **Behavior**:
  - In development: outputs to `console.debug/info/warn/error` with `[LEVEL] message` prefix and context object.
  - In production: same output (console), but `debug` level is suppressed unless `localStorage.getItem('debug') === 'true'`.
  - Context objects are passed as the second argument to console methods so they're expandable in DevTools.
- **Dependencies**: None (zero-dependency utility).
- **Reuses**: Pattern mirrors the backend's Pino logger interface (level methods with context object).

### Component 2: Enhanced Error Middleware (`packages/backend/src/app.ts`)

- **Purpose**: Log all API errors with request context for debugging.
- **Changes**:
  ```typescript
  // AppError (4xx) — currently not logged at all
  if (err instanceof AppError) {
    logger.warn(
      { statusCode: err.statusCode, code: err.code, method: req.method, path: req.path, userId: req.user?.id },
      err.message
    );
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  // Unexpected errors (5xx) — currently logged but with minimal context
  logger.error(
    { err, method: req.method, path: req.path, query: req.query, userId: req.user?.id },
    "Unhandled error"
  );
  ```
- **Dependencies**: Existing `logger` import.
- **Reuses**: Existing `AppError` class, existing `req.user` from auth middleware.

### Component 3: Rate Limit Logging (`packages/backend/src/middleware/rate-limit.ts`)

- **Purpose**: Log when rate limits reject requests.
- **Changes**: Add `handler` callback to the `authRateLimit` configuration.
  ```typescript
  import { logger } from "../utils/logger.js";

  export const authRateLimit = rateLimit({
    // ...existing config...
    handler: (req, res) => {
      logger.warn(
        { ip: req.ip, path: req.path, method: req.method },
        "Auth rate limit exceeded"
      );
      res.status(429).json({ error: "Too many authentication attempts, please try again later" });
    },
  });
  ```
- **Dependencies**: Existing `logger`.

### Component 4: Auth Middleware Logging (`packages/backend/src/middleware/auth.ts`)

- **Purpose**: Log authentication and authorization rejections.
- **Changes**: Add `logger.warn` calls to each rejection path in `requireAuth`, `requireRole`, `requireOwner`, `requireAdminOrOwner`, `requireServerPermission`.
  ```typescript
  // Example in requireAuth:
  if (!payload) {
    logger.warn({ path: req.path, method: req.method }, "Invalid or expired access token");
    throw new UnauthorizedError("Invalid or expired access token");
  }
  ```
- **Dependencies**: Existing `logger`.

### Component 5: Session & Brute-Force Logging (`packages/backend/src/services/session.ts`, `packages/backend/src/services/brute-force.ts`)

- **Purpose**: Audit trail for security-sensitive operations.
- **Changes to `session.ts`**:
  ```typescript
  import { logger } from "../utils/logger.js";

  // In createSession:
  logger.info({ userId, sessionId: id }, "Session created");

  // In revokeSession:
  logger.info({ sessionId }, "Session revoked");

  // In revokeAllUserSessions:
  logger.info({ userId, revokedCount: result.changes }, "All user sessions revoked");

  // In cleanupExpiredSessions:
  logger.info({ cleanedUp: result.changes }, "Expired sessions cleaned up");
  ```
- **Changes to `brute-force.ts`**:
  ```typescript
  import { logger } from "../utils/logger.js";

  // In isLockedOut, when returning true:
  logger.warn({ username, ipAddress }, "Login lockout triggered");

  // In cleanupOldAttempts:
  logger.info({ cleanedUp: result.changes }, "Old login attempts cleaned up");
  ```

### Component 6: WebSocket Lifecycle Logging (`packages/backend/src/ws/handlers.ts`)

- **Purpose**: Log WebSocket auth events and disconnections.
- **Changes**:
  ```typescript
  // On successful auth (after authenticatedClients.set):
  logger.info({ userId: payload.sub, username: payload.username }, "WebSocket client authenticated");

  // On failed auth:
  logger.warn("WebSocket auth failed: invalid token");

  // On auth timeout:
  logger.warn("WebSocket auth timeout — closing connection");

  // In handleDisconnect:
  const user = authenticatedClients.get(ws);
  const subs = clientSubscriptions.get(ws);
  logger.debug({ userId: user?.id, subscriptionCount: subs?.size ?? 0 }, "WebSocket client disconnected");
  ```

### Component 7: Silent Catch Block Remediation (multiple files)

- **Purpose**: Make currently-silent failures visible in logs.
- **Files and changes**:

  | File | Lines | Change |
  |------|-------|--------|
  | `services/java.ts` | 105, 122, 230, 266, 301, 355, 375, 479, 499 | Add `logger.debug` with probed path/command |
  | `services/server-manager.ts` | 329 | Add `logger.warn({ serverId: id }, "Error during graceful stop")` |
  | `services/server-manager.ts` | 341 | Add `logger.warn({ serverId: id }, "Error during force-kill")` |
  | `services/process.ts` | 244 | Add `logger.warn({ serverId: this.serverId }, "Failed to write stop command to stdin")` |
  | `services/auth.ts` | 20 | Add `logger.debug("Password verification failed — argon2 error")` |
  | `services/jwt.ts` | 53 | Add `logger.debug("JWT verification failed")` |
  | `middleware/cors-config.ts` | 17 | Add `logger.debug({ origin }, "CORS origin parse failed")` |
  | `ws/handlers.ts` | 88 | Add `logger.warn({ raw: raw.slice(0, 200) }, "Failed to parse WebSocket message as JSON")` |
  | `providers/forge.ts` | 131, 400, 410 | Add `logger.debug` for installer/cleanup errors |
  | `providers/neoforge.ts` | 355, 368 | Add `logger.debug` for installer/cleanup errors |

### Component 8: Frontend Catch Block Remediation (multiple files)

- **Purpose**: Replace silent catches and toast-only catches with structured logging.
- **Pattern**: Every existing catch block gets a `logger.warn` or `logger.error` call **before** the existing behavior (toast, error state, etc.).
  ```typescript
  // BEFORE:
  } catch (err) {
    toast.error("Failed to load");
  }

  // AFTER:
  } catch (err) {
    logger.warn("Failed to load resource", {
      error: err instanceof Error ? err.message : String(err),
      status: err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : undefined,
    });
    toast.error("Failed to load");
  }
  ```
- **Files**:

  | File | Catch blocks | Change |
  |------|-------------|--------|
  | `contexts/AuthContext.tsx` | 106, 139, 160, 204 | Add `logger.warn` for token refresh, logout, status check failures |
  | `api/ws.ts` | 73 | Add `logger.warn` for JSON parse errors |
  | `api/ws.ts` | 86 (onerror) | Add `logger.warn` for connection errors |
  | `api/ws.ts` | 78 (onclose) | Add `logger.debug` for reconnect events with attempt count |
  | `pages/CreateServer.tsx` | 130, 134, 440 | Add `logger.warn` for silently-caught fetch failures |
  | `pages/Mods.tsx` | 886, 890, 900 | Add `logger.warn` for silently-caught category/settings failures |
  | `components/ErrorBoundary.tsx` | 24 | Replace `console.error` with `logger.error` including component stack and route |
  | `pages/ServerDetail.tsx` | 129, 152 | Add `logger.error` alongside error state |
  | `pages/Login.tsx` | 33 | Add `logger.warn` for login failures |
  | `pages/Launcher.tsx` | 24, 43, 59 | Add `logger.warn` alongside toast |
  | `pages/AppSettings.tsx` | 85, 115 | Add `logger.warn` alongside toast |
  | `pages/InstanceDetail.tsx` | 75, 89, 238, 466, 491 | Add `logger.warn` alongside toast |
  | `components/ModList.tsx` | 103, 124, 146, 171, 196, 226 | Add `logger.warn` alongside toast |
  | `components/ServerControls.tsx` | 71 | Add `logger.warn` alongside toast |
  | `components/PropertiesForm.tsx` | 63, 147 | Add `logger.warn` alongside toast |

## Data Models

No new data models. This spec is purely additive logging — no database changes.

## API Endpoints

No new API endpoints. All changes are internal logging additions.

## WebSocket Events

No new WebSocket events. Logging is added to existing connection/auth lifecycle.

## Error Handling

### Error Scenarios

1. **Logger itself fails (backend — disk full, stdout broken)**
   - **Handling**: Pino handles this internally — write failures don't crash the process. No additional handling needed.
   - **User Impact**: None. The application continues functioning; only log output is lost.

2. **Logger itself fails (frontend — console overridden or unavailable)**
   - **Handling**: The frontend logger wraps console calls in a try-catch to prevent logging from breaking the app.
   - **User Impact**: None. Logging is best-effort.

## Verification Strategy

### Build Verification

- `npm run build` must pass with zero errors after implementation.
- `npm run build -w shared && npm run build -w backend` must compile cleanly.
- `npm run build -w frontend` must compile cleanly (frontend logger has no type errors).

### Manual Testing Checklist

1. **Backend error middleware**: Send a request to a nonexistent endpoint → server logs show 404 with method, path, and error code.
2. **Backend error middleware**: Trigger a 500 (e.g., corrupt DB) → server logs show full error with stack, method, path, and query.
3. **Rate limit logging**: Rapidly POST to `/api/auth/login` 30+ times → server logs show "Auth rate limit exceeded" with IP and path.
4. **Auth middleware logging**: Send a request with an expired/invalid token → server logs show "Invalid or expired access token" with path.
5. **Brute-force logging**: Fail login 5 times → server logs show "Login lockout triggered" with username and IP.
6. **Session logging**: Log in → server logs show "Session created" with userId. Log out → "Session revoked".
7. **WebSocket logging**: Connect with valid token → server logs show "WebSocket client authenticated". Connect with invalid token → "WebSocket auth failed".
8. **Frontend logger**: Open browser DevTools console. Navigate the app. Trigger an error (e.g., stop the backend and try to navigate) → structured log output appears in console with level, message, and context.
9. **Frontend AuthContext**: Stop the backend while logged in, wait for token refresh → browser console shows "Token refresh failed" with context.
10. **Frontend ErrorBoundary**: Introduce a temporary rendering error → browser console shows structured error log with component stack.

## Implementation Order

1. **Frontend logger utility** (`packages/frontend/src/utils/logger.ts`) — No dependencies. Foundation for all frontend logging tasks.
2. **Backend error middleware enhancement** (`app.ts`) — No dependencies on other tasks. Highest-value single change.
3. **Backend rate-limit + auth middleware logging** (`rate-limit.ts`, `middleware/auth.ts`) — Independent of other tasks.
4. **Backend session + brute-force logging** (`session.ts`, `brute-force.ts`) — Independent; adds logger import and calls.
5. **Backend WebSocket lifecycle logging** (`ws/handlers.ts`) — Independent.
6. **Backend silent catch block remediation** (multiple services/providers) — Independent; touches many files but each change is isolated.
7. **Frontend silent catch block remediation** (AuthContext, ws.ts, pages, components) — Depends on step 1 (logger utility).
8. **Frontend ErrorBoundary enhancement** — Depends on step 1 (logger utility).

Steps 1-6 are independent of each other and can be implemented in any order. Steps 7-8 depend on step 1.
