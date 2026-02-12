# Design Document -- Multi-User Foundation

## Overview

Transform MC Server Manager from a single-user desktop application into a multi-user community platform. The host runs the Express backend as a network-facing server that friends connect to over the internet. This design covers the authentication system (JWT + refresh tokens), invitation-based registration, role-based access control with granular per-server permissions, TLS/HTTPS support, security hardening, and the frontend auth UI.

This is the platform pivot -- all subsequent social features (Friends & Chat, Shared Servers, Voice, Mod Sync) depend on this multi-user foundation.

## Steering Document Alignment

No steering docs exist. This design follows existing project conventions (Express routes, Zod validation, SQLite models, Zustand store, Tailwind UI) and the patterns established in the AGENTS.md.

## Code Reuse Analysis

### Existing Components to Leverage
- **`packages/backend/src/utils/errors.ts`**: Custom error classes (AppError, NotFoundError, ConflictError). Extended with `UnauthorizedError` and `ForbiddenError` for auth.
- **`packages/backend/src/models/settings.ts`** (or equivalent settings table): Key-value store used for JWT secret, TLS config, and network settings.
- **`packages/backend/src/config.ts`**: Application configuration. Extended with host binding, TLS mode, and multi-user settings.
- **`packages/frontend/src/api/client.ts`**: Existing API client. Modified to inject `Authorization` headers on all requests.
- **`packages/frontend/src/api/ws.ts`**: WebSocket client. Modified to send access token as the first WebSocket message after connection (first-message auth pattern).
- **Express route patterns**: Existing routes in `packages/backend/src/routes/` serve as the template for auth, user, invitation, and permission routes.
- **Zod validation patterns**: All existing routes use Zod schemas for request validation. Auth routes follow the same pattern.
- **Pino logger**: Existing logger instance reused for auth event logging (with sensitive data redaction).

### Integration Points
- **`servers` table**: Foreign key target for `server_permissions` table. Server routes gain permission middleware.
- **WebSocket handlers**: Existing `subscribe`/`command` handlers gain auth token verification and permission checks.
- **Express middleware chain**: Auth middleware, rate limiting, CORS, and Helmet inserted before existing route handlers.
- **Settings table**: Extended with JWT secret, TLS configuration, and network settings.

## Architecture

### Authentication Flow

```
First Run (Setup):
  App detects 0 users --> Show setup wizard --> POST /api/auth/setup
  --> Create owner account (argon2id hash) --> Return JWT + refresh token

Friend Registration (Invite-Based):
  Owner creates invite (POST /api/invitations) --> Shares code/link
  --> Friend registers (POST /api/auth/register) with invite code
  --> Validate invite (not expired, uses remaining) --> Create account
  --> Return JWT + refresh token

Login:
  POST /api/auth/login --> Check brute force lockout
  --> Verify password (argon2.verify) --> Generate access token (15min JWT)
  --> Generate refresh token (30-day, hashed in DB) --> Return both

Token Refresh:
  Access token expires --> Frontend detects 401 --> POST /api/auth/refresh
  --> Hash refresh token, lookup in sessions --> Verify not expired
  --> Generate new access token --> Optionally rotate refresh token

Logout:
  POST /api/auth/logout --> Delete session record --> Frontend discards tokens
```

### Permission Resolution

```
                        Request arrives
                             |
                     requireAuth middleware
                     (verify JWT, attach user)
                             |
                    +--------+--------+
                    |                 |
               Owner/Admin?       Member?
               (bypass all)    (check server_permissions)
                    |                 |
                 ALLOW        has record with flag=1?
                                     |
                              +------+------+
                              |             |
                            ALLOW        DENY (403)
```

### Architecture Shift

```
Before (Single-User):
  Tauri App (localhost only)
    --> Express Backend (127.0.0.1:3001, no auth)

After (Multi-User):
  Host's Tauri App                     Friend's Tauri App
    --> Express Backend                   --> (connects remotely)
        (0.0.0.0:3001, HTTPS)                   |
              ^                                  |
              +----------------------------------+
                      (over internet, TLS)
```

### Modular Design Principles
- **Single Responsibility**: Each auth concern in its own service file -- `auth.ts` (password hashing), `jwt.ts` (token generation/verification), `session.ts` (refresh token management), `brute-force.ts` (login attempt tracking).
- **Composable Middleware**: `requireAuth`, `requireRole('admin')`, `requireServerPermission('can_start')` -- each is a standalone middleware that can be combined in route definitions.
- **Backward Compatibility**: When no users exist in the database, all existing functionality works without authentication. Auth middleware skips verification in single-user mode.
- **Route Separation**: Auth routes (`auth.ts`), user routes (`users.ts`), invitation routes (`invitations.ts`), and permission routes (extension to `servers.ts`) are each in separate files.

## Components and Interfaces

### Component 1: Password Hashing Service (`packages/backend/src/services/auth.ts`)
- **Purpose**: Hash and verify passwords using argon2id
- **Interfaces**: `hashPassword(password: string): Promise<string>`, `verifyPassword(hash: string, password: string): Promise<boolean>`
- **Dependencies**: `argon2` npm package
- **Reuses**: None (new foundational service)

### Component 2: JWT Service (`packages/backend/src/services/jwt.ts`)
- **Purpose**: Generate and verify JWT access tokens (HS256, 15-min expiry)
- **Interfaces**: `generateAccessToken(user: User): string`, `verifyAccessToken(token: string): JWTPayload | null`, `getOrCreateJWTSecret(): string`
- **Dependencies**: `jsonwebtoken` npm package, settings model (for secret storage)
- **Reuses**: Settings table for persistent secret storage
- **Security Note**: The JWT secret is stored in the SQLite settings table. For production deployments, consider storing the secret in a separate file with restrictive permissions (0600) rather than the shared database. Tauri secure storage is a future enhancement.

### Component 3: Session Service (`packages/backend/src/services/session.ts`)
- **Purpose**: Manage refresh tokens (30-day expiry) -- create, validate, revoke, cleanup
- **Interfaces**: `generateRefreshToken(): string`, `hashRefreshToken(token: string): string`, `createSession(userId, refreshToken, deviceInfo, ipAddress): Session`, `validateRefreshToken(token: string): Session | null`, `revokeSession(sessionId: string): void`, `revokeAllUserSessions(userId: string): number`, `cleanupExpiredSessions(): number`
- **Dependencies**: `crypto` (Node built-in), session model
- **Reuses**: None (new service)

### Component 4: Brute Force Service (`packages/backend/src/services/brute-force.ts`)
- **Purpose**: Track failed login attempts and enforce lockout (5 failures per 15 minutes)
- **Interfaces**: `recordLoginAttempt(username, ipAddress, success): void`, `isLockedOut(username, ipAddress): boolean`, `clearLoginAttempts(username): void`, `cleanupOldAttempts(): number`
- **Dependencies**: login_attempts model
- **Reuses**: None (new service)

### Component 5: Auth Middleware (`packages/backend/src/middleware/auth.ts`)
- **Purpose**: Express middleware for JWT verification, role checks, and server permission checks
- **Interfaces**: `requireAuth` (verify JWT, attach user to request), `requireRole(...roles)` (check user role), `requireOwner` (owner only), `requireAdminOrOwner` (admin or owner), `requireServerPermission(permission)` (check per-server permission)
- **Dependencies**: JWT service, server-permission model
- **Reuses**: Existing error classes (extended with `UnauthorizedError`, `ForbiddenError`)

### Component 6: TLS Service (`packages/backend/src/services/tls.ts`)
- **Purpose**: Configure HTTPS -- Let's Encrypt (HTTP-01 challenge), custom certificates, self-signed, or disabled
- **Interfaces**: `setupTLS(config: TLSConfig, dataDir: string): Promise<{cert, key} | null>`
- **Dependencies**: `@root/acme` (Let's Encrypt), `node-forge` (self-signed), `fs` (custom certs)
- **Reuses**: Config/settings for TLS mode persistence
- **Default Mode**: Self-signed certificates are the default TLS mode. Let's Encrypt is an opt-in upgrade for users who have a domain and port 80 open to the internet. The setup wizard should present TLS options with realistic guidance.

### Component 7: UPnP Service (`packages/backend/src/services/upnp.ts`)
- **Purpose**: Automatic port forwarding via UPnP for hosts without manual router access
- **Interfaces**: `setupPortForwarding(port: number): Promise<boolean>`, `removePortForwarding(port: number): Promise<void>`
- **Dependencies**: `nat-upnp` npm package
- **Reuses**: None (new service)

### Component 8: Auth Routes (`packages/backend/src/routes/auth.ts`)
- **Purpose**: HTTP endpoints for setup, register, login, refresh, logout, logout-all
- **Endpoints**: `POST /api/auth/setup`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`
- **Dependencies**: Auth service, JWT service, session service, brute force service, user model, invitation model
- **Reuses**: Zod validation patterns, Express route patterns

### Component 9: User Routes (`packages/backend/src/routes/users.ts`)
- **Purpose**: User profile and admin user management endpoints
- **Endpoints**: `GET /api/users/me`, `PATCH /api/users/me`, `GET /api/users` (admin), `GET /api/users/:id` (admin), `PATCH /api/users/:id/role` (owner), `DELETE /api/users/:id` (owner), `PATCH /api/users/me/minecraft` (Bearer)
- **Dependencies**: User model, auth middleware
- **Reuses**: Route handler patterns from existing server routes

### Component 10: Invitation Routes (`packages/backend/src/routes/invitations.ts`)
- **Purpose**: CRUD for invite codes (owner/admin only)
- **Endpoints**: `POST /api/invitations`, `GET /api/invitations`, `DELETE /api/invitations/:id`
- **Dependencies**: Invitation model, auth middleware
- **Reuses**: Route handler patterns

### Component 11: Server Permission Routes (extension to existing server routes)
- **Purpose**: Granular per-server permission management
- **Endpoints**: `GET /api/servers/:serverId/permissions`, `PUT /api/servers/:serverId/permissions/:userId`, `DELETE /api/servers/:serverId/permissions/:userId`
- **Dependencies**: Server-permission model, auth middleware
- **Reuses**: Existing server route file structure

### Component 12: Security Middleware (`packages/backend/src/middleware/rate-limit.ts`, `cors.ts`, `security.ts`)
- **Purpose**: Rate limiting (100 req/min general, 5 req/15min auth), CORS (Tauri origin + custom domain), Helmet security headers
- **Dependencies**: `express-rate-limit`, `cors`, `helmet` npm packages
- **Reuses**: None (new middleware layer)

### Component 13: Frontend Auth Context (`packages/frontend/src/contexts/AuthContext.tsx`)
- **Purpose**: React context providing auth state, automatic token refresh (1 min before expiry), and logout
- **Interfaces**: `useAuth()` hook returning `{ user, accessToken, isAuthenticated, logout }`
- **Dependencies**: Auth API client
- **Reuses**: Existing React context patterns

### Component 14: Frontend Auth Pages (`Setup.tsx`, `Login.tsx`, `Register.tsx`)
- **Purpose**: Setup wizard (first run), login page, registration page (with invite code from URL)
- **Dependencies**: Auth API client, AuthContext, React Router
- **Reuses**: Tailwind styling patterns from existing pages

### Component 15: Admin Panel (`packages/frontend/src/pages/Admin.tsx`)
- **Purpose**: User list with role management, invitation list with create/delete, server permission management
- **Dependencies**: User API, invitation API, auth middleware (admin/owner only)
- **Reuses**: Table patterns from existing server list UI

### Component 16: Protected Route Component (`packages/frontend/src/components/ProtectedRoute.tsx`)
- **Purpose**: Route guard that redirects unauthenticated users to login
- **Dependencies**: AuthContext
- **Reuses**: None (simple wrapper component)

## Data Models

### users table
```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,                    -- nanoid
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE, -- case-insensitive unique
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  password_hash   TEXT NOT NULL,                       -- argon2id hash
  role            TEXT NOT NULL DEFAULT 'member',      -- owner | admin | member
  is_active       INTEGER NOT NULL DEFAULT 1,          -- soft delete / ban
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  minecraft_username TEXT,                        -- linked MC account username
  minecraft_uuid     TEXT                         -- linked MC account UUID
);
```

### sessions table (refresh tokens)
```sql
CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,                  -- nanoid
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,              -- SHA-256 hash
  device_info        TEXT,
  ip_address         TEXT,
  expires_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### invitations table
```sql
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,                        -- nanoid
  code        TEXT NOT NULL UNIQUE,                    -- 8-char nanoid
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_uses    INTEGER NOT NULL DEFAULT 1,              -- 0 = unlimited
  uses        INTEGER NOT NULL DEFAULT 0,
  role        TEXT NOT NULL DEFAULT 'member',
  expires_at  TEXT,                                    -- NULL = never expires
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### server_permissions table
```sql
CREATE TABLE server_permissions (
  id          TEXT PRIMARY KEY,                        -- nanoid
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view    INTEGER NOT NULL DEFAULT 1,
  can_start   INTEGER NOT NULL DEFAULT 0,
  can_console INTEGER NOT NULL DEFAULT 0,
  can_edit    INTEGER NOT NULL DEFAULT 0,
  can_join    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, user_id)
);
```

### login_attempts table
```sql
CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL,
  ip_address   TEXT NOT NULL,
  success      INTEGER NOT NULL,                       -- 0 = failed, 1 = success
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Shared TypeScript Types (added to `shared/src/index.ts`)

```typescript
export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  minecraftUsername: string | null;
  minecraftUuid: string | null;
}

export interface Session {
  id: string;
  userId: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface Invitation {
  id: string;
  code: string;
  createdBy: string;
  maxUses: number;
  uses: number;
  role: UserRole;
  expiresAt: string | null;
  createdAt: string;
}

export interface ServerPermission {
  id: string;
  serverId: string;
  userId: string;
  canView: boolean;
  canStart: boolean;
  canConsole: boolean;
  canEdit: boolean;
  canJoin: boolean;
  createdAt: string;
}

export interface JWTPayload {
  sub: string;       // User ID
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface SetupRequest {
  username: string;
  password: string;
  displayName: string;
}

export interface RegisterRequest {
  inviteCode: string;
  username: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
}
```

## Error Handling

### Error Scenarios

1. **Invalid credentials on login**
   - **Handling**: Return generic 401 "Invalid credentials" (no distinction between "user not found" and "wrong password" to prevent user enumeration). Record failed login attempt.
   - **User Impact**: "Invalid username or password" toast.

2. **Brute force lockout triggered**
   - **Handling**: Return 429 after 5 failed attempts within 15 minutes for the same username or IP. Include `Retry-After` header.
   - **User Impact**: "Too many login attempts. Please try again later."

3. **Expired or invalid invite code**
   - **Handling**: Return 400 with specific reason (expired, exhausted, or not found -- safe to differentiate since invite codes are shared intentionally).
   - **User Impact**: "This invite code is expired / has been used / is invalid."

4. **Access token expired**
   - **Handling**: Frontend interceptor catches 401, automatically calls `/api/auth/refresh`. If refresh succeeds, retry original request. If refresh fails, redirect to login.
   - **User Impact**: Seamless (invisible token refresh). Only visible if refresh token also expired.

5. **Insufficient permissions (role or server-level)**
   - **Handling**: Return 403 Forbidden. Frontend hides/disables controls the user lacks permissions for.
   - **User Impact**: Forbidden controls are not visible. Direct API calls return "Insufficient permissions."

6. **TLS certificate provisioning fails**
    - **Handling**: Log error, fall back to self-signed certificates. If self-signed also fails, fall back to HTTP with prominent warning in logs and admin UI. Do not block server startup.
    - **User Impact**: Admin sees "TLS setup failed -- running without encryption" warning in admin panel.

7. **Owner account already exists during setup**
   - **Handling**: Return 409 Conflict. Frontend redirects to login page.
   - **User Impact**: "Setup has already been completed. Please log in."

8. **JWT secret lost (database corruption)**
    - **Handling**: All existing tokens automatically become invalid (signature mismatch). New secret generated on startup. Users must re-authenticate.
    - **User Impact**: Logged out on next request, must log in again.

## Security

### CSRF Protection
**CSRF Protection**: CSRF protection is inherent in the Bearer token architecture — browsers cannot auto-send the Authorization header cross-origin. No additional CSRF tokens are required.

## File Structure

### New Files
```
packages/backend/migrations/009_multi_user.sql        # All auth tables
packages/backend/src/services/auth.ts                  # Password hashing (argon2id)
packages/backend/src/services/jwt.ts                   # JWT generation/verification
packages/backend/src/services/session.ts               # Refresh token management
packages/backend/src/services/brute-force.ts           # Login attempt tracking
packages/backend/src/services/tls.ts                   # TLS/HTTPS setup
packages/backend/src/services/upnp.ts                  # UPnP port forwarding
packages/backend/src/middleware/auth.ts                 # Auth middleware
packages/backend/src/middleware/rate-limit.ts           # Rate limiting
packages/backend/src/middleware/cors-config.ts          # CORS configuration
packages/backend/src/middleware/security.ts             # Helmet headers
packages/backend/src/routes/auth.ts                    # Auth endpoints
packages/backend/src/routes/users.ts                   # User management endpoints
packages/backend/src/routes/invitations.ts             # Invitation endpoints
packages/backend/src/routes/acme.ts                    # ACME challenge handler
packages/backend/src/models/user.ts                    # User DB queries
packages/backend/src/models/session.ts                 # Session DB queries
packages/backend/src/models/invitation.ts              # Invitation DB queries
packages/backend/src/models/server-permission.ts       # Permission DB queries
packages/frontend/src/pages/Setup.tsx                  # First-run setup wizard
packages/frontend/src/pages/Login.tsx                  # Login page
packages/frontend/src/pages/Register.tsx               # Registration page
packages/frontend/src/pages/Admin.tsx                  # Admin panel
packages/frontend/src/contexts/AuthContext.tsx         # Auth context + token refresh
packages/frontend/src/components/ProtectedRoute.tsx    # Route guard
packages/frontend/src/api/auth.ts                      # Auth API client
packages/frontend/src/api/users.ts                     # User API client
packages/frontend/src/api/invitations.ts               # Invitation API client
```

### Modified Files
```
shared/src/index.ts                                    # Add User, Session, Invitation, ServerPermission, auth types
packages/backend/src/index.ts                          # HTTPS server setup, bind to 0.0.0.0
packages/backend/src/config.ts                         # Add host, TLS, UPnP settings
packages/backend/src/app.ts                            # Insert auth, rate-limit, CORS, Helmet middleware
packages/backend/src/routes/servers.ts                 # Add permission checks to all endpoints
packages/backend/src/ws/handlers.ts (or equivalent)    # Add auth to WebSocket connections
packages/backend/src/utils/errors.ts                   # Add UnauthorizedError, ForbiddenError
packages/frontend/src/App.tsx                          # Add AuthProvider, setup/login routes, protected routes
packages/frontend/src/api/client.ts                    # Inject Authorization header
packages/frontend/src/api/ws.ts                        # Send access token via first-message auth pattern
packages/frontend/src/main.tsx                         # Wrap app in AuthProvider
```

## API Endpoints

### Auth Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/setup` | None | Create owner account (first run only) |
| POST | `/api/auth/register` | None | Register with invite code |
| POST | `/api/auth/login` | None | Login with credentials |
| POST | `/api/auth/refresh` | None | Refresh access token |
| POST | `/api/auth/logout` | None | Revoke refresh token |
| POST | `/api/auth/logout-all` | Bearer | Revoke all sessions for current user |

### User Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | Bearer | Get current user profile |
| PATCH | `/api/users/me` | Bearer | Update profile (display name, avatar, password) |
| GET | `/api/users` | Admin+ | List all users |
| GET | `/api/users/:id` | Admin+ | Get user details + sessions |
| PATCH | `/api/users/:id/role` | Owner | Change user role |
| DELETE | `/api/users/:id` | Owner | Deactivate user |

### Invitation Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/invitations` | Admin+ | Create invitation |
| GET | `/api/invitations` | Admin+ | List invitations |
| DELETE | `/api/invitations/:id` | Admin+ | Delete invitation |

### Server Permission Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/servers/:serverId/permissions` | Admin+ | List permissions for server |
| PUT | `/api/servers/:serverId/permissions/:userId` | Admin+ | Grant/update permissions |
| DELETE | `/api/servers/:serverId/permissions/:userId` | Admin+ | Revoke permissions |

## Dependencies

### New Backend npm Packages
- `argon2` -- Password hashing (argon2id)
- `jsonwebtoken` + `@types/jsonwebtoken` -- JWT generation/verification
- `express-rate-limit` -- Rate limiting middleware
- `helmet` -- Security headers
- `cors` + `@types/cors` -- CORS middleware
- `@root/acme` -- Let's Encrypt ACME client
- `node-forge` + `@types/node-forge` -- Self-signed certificate generation
- `nat-upnp` -- UPnP port forwarding

### New Frontend npm Packages
- None -- uses existing React, React Router, Zustand, Tailwind

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual verification per the testing checklist.
- Key areas: password hashing roundtrip, JWT generation/verification, refresh token lifecycle, brute force lockout threshold.

### Integration Testing
- **Setup flow**: First run shows wizard, creates owner, redirects to dashboard
- **Login flow**: Valid credentials succeed, invalid fail, brute force triggers lockout after 5 attempts
- **Token refresh**: Access token auto-refreshes before expiry, expired refresh token triggers logout
- **Invitation lifecycle**: Create invite, register with code, code exhausts at max uses, expired codes rejected
- **Role permissions**: Owner full access, Admin manages users/servers, Member limited to granted servers
- **Server permissions**: Granular flags work (view-only, start-only), Owner/Admin bypass checks
- **WebSocket auth**: Connection requires valid token, expired token disconnects

### End-to-End Testing
- Full flow: Setup owner --> Create invite --> Friend registers --> Friend sees permitted servers --> Owner revokes access --> Friend loses access
- TLS: Let's Encrypt provisions cert (requires domain), custom cert loads, self-signed works for LAN
- Network: Backend on 0.0.0.0, accessible from other LAN devices
