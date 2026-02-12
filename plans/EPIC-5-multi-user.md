# Epic 5 — Multi-User Foundation

> **Prerequisite for**: Epic 6 (Friends & Chat), Epic 7 (Shared Servers), Epic 8 (Voice)
> **Standalone value**: Transform from single-user local tool to multi-user community platform — friends can connect remotely
> **Dependencies**: Epic 1 (Tauri Desktop)

---

## Executive Summary

Transform MC Server Manager from a single-user desktop application into a multi-user community platform. The host runs a community server (the Express backend) that friends connect to over the internet. This epic implements the complete authentication, authorization, and security foundation required for all social features.

### Key Decisions

- **JWT-based authentication** with access tokens (15 min) + refresh tokens (30 days) — industry standard, stateless, works with WebSocket
- **Invitation system** for controlled access — the host (Owner) generates invite codes/links, friends use them to register
- **Role-based permissions** — Owner (full control), Admin (manage servers/users), Member (view/join servers) with granular per-server permissions
- **Mandatory TLS/HTTPS** for network-facing deployments — auto-provision via Let's Encrypt or user-provided certificates
- **argon2** for password hashing — OWASP recommended, resistant to GPU cracking
- **Security-first design** — rate limiting, CORS, CSP, brute force protection, input validation, secure session management

### Architecture Shift

**Before (Epic 1):**
```
Tauri App (localhost only)
  └─► Express Backend (127.0.0.1:3001)
```

**After (Epic 5):**
```
Host's Tauri App                          Friend's Tauri App
  └─► Express Backend                       └─► (connects remotely)
      (0.0.0.0:3001, HTTPS)                      │
            ▲                                     │
            └─────────────────────────────────────┘
                    (over internet)
```

---

## Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Initial Setup (First Run)                                   │
│                                                              │
│ 1. App detects no users exist                               │
│ 2. Show setup wizard                                         │
│ 3. POST /api/auth/setup                                      │
│    { username, password, displayName }                       │
│ 4. Create first user with role=owner                         │
│ 5. Return access + refresh tokens                            │
│ 6. Store refresh token in secure storage (Tauri)             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Friend Registration (Invite-Based)                          │
│                                                              │
│ 1. Owner generates invite code via UI                        │
│    POST /api/invitations                                     │
│    { maxUses: 1, expiresIn: 7d, role: 'member' }            │
│    → Returns { code: 'abc123xyz', link: 'https://...' }     │
│                                                              │
│ 2. Owner shares link/code with friend                        │
│                                                              │
│ 3. Friend enters code in registration form                   │
│    POST /api/auth/register                                   │
│    { inviteCode, username, password, displayName }           │
│                                                              │
│ 4. Backend validates invite (not expired, uses < maxUses)    │
│ 5. Create user with role from invitation                     │
│ 6. Increment invitation uses                                 │
│ 7. Return access + refresh tokens                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Login Flow                                                   │
│                                                              │
│ 1. POST /api/auth/login                                      │
│    { username, password }                                    │
│                                                              │
│ 2. Validate credentials (argon2.verify)                      │
│ 3. Check brute force protection (max 5 attempts/15min)       │
│ 4. Generate access token (JWT, 15 min expiry)                │
│ 5. Generate refresh token (random, 30 day expiry)            │
│ 6. Store refresh token hash in sessions table                │
│ 7. Return both tokens + user profile                         │
│                                                              │
│ Access Token Payload:                                        │
│ {                                                            │
│   sub: userId,                                               │
│   username: string,                                          │
│   role: 'owner' | 'admin' | 'member',                        │
│   iat: timestamp,                                            │
│   exp: timestamp (15 min from iat)                           │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Token Refresh Flow                                          │
│                                                              │
│ 1. Access token expires (15 min)                             │
│ 2. Frontend detects 401 response                             │
│ 3. POST /api/auth/refresh                                    │
│    { refreshToken }                                          │
│                                                              │
│ 4. Validate refresh token:                                   │
│    - Hash token, lookup in sessions table                    │
│    - Check not expired                                       │
│    - Check user still exists and active                      │
│                                                              │
│ 5. Generate new access token (same payload, new expiry)      │
│ 6. Optionally rotate refresh token (security best practice)  │
│ 7. Return new access token (+ new refresh if rotated)        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Logout Flow                                                  │
│                                                              │
│ 1. POST /api/auth/logout                                     │
│    { refreshToken }                                          │
│                                                              │
│ 2. Delete session from database (invalidates refresh token)  │
│ 3. Frontend discards access token                            │
│ 4. Redirect to login page                                    │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
-- Migration: 002_multi_user.sql

-- Users table
CREATE TABLE users (
  id              TEXT PRIMARY KEY,                    -- nanoid
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Case-insensitive unique
  display_name    TEXT NOT NULL,                       -- Display name (can have spaces, caps)
  avatar_url      TEXT,                                -- Optional avatar URL
  password_hash   TEXT NOT NULL,                       -- argon2id hash
  role            TEXT NOT NULL DEFAULT 'member',      -- owner | admin | member
  is_active       INTEGER NOT NULL DEFAULT 1,          -- Soft delete / ban
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- Sessions table (refresh tokens)
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,                  -- nanoid
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,             -- SHA-256 hash of refresh token
  device_info       TEXT,                              -- User agent / device name
  ip_address        TEXT,                              -- IP address at creation
  expires_at        TEXT NOT NULL,                     -- Expiry timestamp
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Invitations table
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,                        -- nanoid
  code        TEXT NOT NULL UNIQUE,                    -- Invite code (8-char nanoid)
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_uses    INTEGER NOT NULL DEFAULT 1,              -- 0 = unlimited
  uses        INTEGER NOT NULL DEFAULT 0,              -- Current use count
  role        TEXT NOT NULL DEFAULT 'member',          -- Role assigned to new users
  expires_at  TEXT,                                    -- NULL = never expires
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invitations_code ON invitations(code);
CREATE INDEX idx_invitations_created_by ON invitations(created_by);

-- Server permissions table (granular per-server access control)
CREATE TABLE server_permissions (
  id          TEXT PRIMARY KEY,                        -- nanoid
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view    INTEGER NOT NULL DEFAULT 1,              -- Can see server in list
  can_start   INTEGER NOT NULL DEFAULT 0,              -- Can start/stop/restart
  can_console INTEGER NOT NULL DEFAULT 0,              -- Can send commands
  can_edit    INTEGER NOT NULL DEFAULT 0,              -- Can edit settings
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, user_id)
);

CREATE INDEX idx_server_permissions_server ON server_permissions(server_id);
CREATE INDEX idx_server_permissions_user ON server_permissions(user_id);

-- Login attempts table (brute force protection)
CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  ip_address  TEXT NOT NULL,
  success     INTEGER NOT NULL,                        -- 0 = failed, 1 = success
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_login_attempts_username ON login_attempts(username);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_time ON login_attempts(attempted_at);
```

### Permission System

**Role Hierarchy:**

| Role | Description | Default Permissions |
|------|-------------|---------------------|
| **Owner** | First account created. Full control. Cannot be deleted or demoted. | All permissions on all servers. Can manage users, create invitations, change settings. |
| **Admin** | Trusted users. Can manage servers and users. | All permissions on all servers. Can create invitations, manage users (except Owner). Cannot change app settings. |
| **Member** | Regular users. View-only by default. | Can view servers they have explicit permissions for. Cannot manage users or create invitations. |

**Granular Server Permissions:**

Each user can have per-server permissions (stored in `server_permissions` table):

- `can_view` — See server in list, view status/stats
- `can_start` — Start, stop, restart, kill server
- `can_console` — Send commands to console
- `can_edit` — Edit server.properties, JVM args, other settings

**Permission Resolution Logic:**

```typescript
function hasPermission(user: User, server: Server, permission: Permission): boolean {
  // Owner and Admin have all permissions
  if (user.role === 'owner' || user.role === 'admin') {
    return true;
  }

  // Members need explicit permission
  const serverPerm = getServerPermission(user.id, server.id);
  if (!serverPerm) {
    return false; // No permission record = no access
  }

  switch (permission) {
    case 'view': return serverPerm.can_view;
    case 'start': return serverPerm.can_start;
    case 'console': return serverPerm.can_console;
    case 'edit': return serverPerm.can_edit;
    default: return false;
  }
}
```

**Default Permissions for New Servers:**

When a server is created:
- Creator gets full permissions (all flags = 1)
- Owner/Admin roles automatically have access (no explicit record needed)
- Members have no access unless explicitly granted

---

## API Design

### Authentication Endpoints

```typescript
// Setup (first run only)
POST /api/auth/setup
Request:
{
  username: string;        // 3-20 chars, alphanumeric + underscore
  password: string;        // Min 8 chars
  displayName: string;     // 1-50 chars
}
Response:
{
  user: User;
  accessToken: string;
  refreshToken: string;
}
Errors:
- 409 Conflict: Setup already completed (users exist)
- 400 Bad Request: Validation errors

// Register with invite code
POST /api/auth/register
Request:
{
  inviteCode: string;
  username: string;
  password: string;
  displayName: string;
}
Response:
{
  user: User;
  accessToken: string;
  refreshToken: string;
}
Errors:
- 400 Bad Request: Invalid/expired/exhausted invite code
- 409 Conflict: Username already taken

// Login
POST /api/auth/login
Request:
{
  username: string;
  password: string;
}
Response:
{
  user: User;
  accessToken: string;
  refreshToken: string;
}
Errors:
- 401 Unauthorized: Invalid credentials
- 429 Too Many Requests: Brute force protection triggered
- 403 Forbidden: Account is inactive

// Refresh access token
POST /api/auth/refresh
Request:
{
  refreshToken: string;
}
Response:
{
  accessToken: string;
  refreshToken?: string;  // If rotation enabled
}
Errors:
- 401 Unauthorized: Invalid/expired refresh token

// Logout
POST /api/auth/logout
Request:
{
  refreshToken: string;
}
Response:
{
  success: true;
}
Errors:
- None (idempotent)

// Logout all sessions (revoke all refresh tokens for current user)
POST /api/auth/logout-all
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  revokedCount: number;
}
```

### User Management Endpoints

```typescript
// Get current user profile
GET /api/users/me
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  lastLoginAt: string | null;
}

// Update current user profile
PATCH /api/users/me
Headers:
  Authorization: Bearer <accessToken>
Request:
{
  displayName?: string;
  avatarUrl?: string;
  currentPassword?: string;  // Required if changing password
  newPassword?: string;
}
Response:
{
  user: User;
}

// List all users (admin/owner only)
GET /api/users
Headers:
  Authorization: Bearer <accessToken>
Query:
  ?role=member&active=true
Response:
{
  users: User[];
}

// Get user by ID (admin/owner only)
GET /api/users/:id
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  user: User;
  sessions: Session[];  // Active sessions for this user
}

// Update user role (owner only)
PATCH /api/users/:id/role
Headers:
  Authorization: Bearer <accessToken>
Request:
{
  role: 'admin' | 'member';  // Cannot set to 'owner'
}
Response:
{
  user: User;
}
Errors:
- 403 Forbidden: Only owner can change roles
- 400 Bad Request: Cannot change owner's role

// Deactivate user (owner only)
DELETE /api/users/:id
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  success: true;
}
Errors:
- 403 Forbidden: Cannot delete owner
- 404 Not Found: User doesn't exist
```

### Invitation Endpoints

```typescript
// Create invitation (owner/admin only)
POST /api/invitations
Headers:
  Authorization: Bearer <accessToken>
Request:
{
  maxUses?: number;        // Default: 1, 0 = unlimited
  expiresIn?: string;      // Duration string: '7d', '24h', '30m'
  role?: 'admin' | 'member';  // Default: 'member'
}
Response:
{
  id: string;
  code: string;            // 8-char code
  link: string;            // Full URL: https://host:port/register?code=...
  maxUses: number;
  uses: number;
  role: string;
  expiresAt: string | null;
  createdAt: string;
}

// List invitations (owner/admin only)
GET /api/invitations
Headers:
  Authorization: Bearer <accessToken>
Query:
  ?active=true  // Only non-expired, non-exhausted
Response:
{
  invitations: Invitation[];
}

// Delete invitation (owner/admin only)
DELETE /api/invitations/:id
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  success: true;
}
```

### Server Permission Endpoints

```typescript
// Get permissions for a server (owner/admin only)
GET /api/servers/:serverId/permissions
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  permissions: Array<{
    userId: string;
    username: string;
    displayName: string;
    canView: boolean;
    canStart: boolean;
    canConsole: boolean;
    canEdit: boolean;
  }>;
}

// Grant/update permissions for a user on a server (owner/admin only)
PUT /api/servers/:serverId/permissions/:userId
Headers:
  Authorization: Bearer <accessToken>
Request:
{
  canView: boolean;
  canStart: boolean;
  canConsole: boolean;
  canEdit: boolean;
}
Response:
{
  permission: ServerPermission;
}

// Revoke all permissions for a user on a server (owner/admin only)
DELETE /api/servers/:serverId/permissions/:userId
Headers:
  Authorization: Bearer <accessToken>
Response:
{
  success: true;
}
```

---

## Shared TypeScript Types

Add to `shared/src/index.ts`:

```typescript
// User types
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
}

export type UserRole = 'owner' | 'admin' | 'member';

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
  createdAt: string;
}

// Auth request/response types
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

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
}

// JWT payload
export interface JWTPayload {
  sub: string;           // User ID
  username: string;
  role: UserRole;
  iat: number;           // Issued at (Unix timestamp)
  exp: number;           // Expires at (Unix timestamp)
}

// Request context (attached by auth middleware)
export interface AuthenticatedRequest {
  user: {
    id: string;
    username: string;
    role: UserRole;
  };
}
```

---

## Security Implementation

### Password Hashing (argon2)

```typescript
// packages/backend/src/services/auth.ts
import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,      // Hybrid mode (resistant to both side-channel and GPU attacks)
  memoryCost: 65536,          // 64 MB
  timeCost: 3,                // 3 iterations
  parallelism: 4,             // 4 threads
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
```

### JWT Token Generation

```typescript
// packages/backend/src/services/jwt.ts
import jwt from 'jsonwebtoken';
import { JWTPayload } from '@mc-server-manager/shared';

const JWT_SECRET = process.env.JWT_SECRET || generateSecretOnStartup();
const ACCESS_TOKEN_EXPIRY = '15m';

export function generateAccessToken(user: User): string {
  const payload: JWTPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
  };

  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

// Generate a secure random secret on first startup if not provided
function generateSecretOnStartup(): string {
  const crypto = require('crypto');
  const secret = crypto.randomBytes(64).toString('hex');
  
  // Store in settings table for persistence across restarts
  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', secret);
  
  return secret;
}
```

### Refresh Token Management

```typescript
// packages/backend/src/services/session.ts
import crypto from 'crypto';
import { nanoid } from 'nanoid';

const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export function generateRefreshToken(): string {
  // 32-byte random token, base64url encoded
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(
  userId: string,
  refreshToken: string,
  deviceInfo: string | null,
  ipAddress: string | null
): Session {
  const db = getDatabase();
  const sessionId = nanoid();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_token_hash, device_info, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, deviceInfo, ipAddress, expiresAt);

  return getSessionById(sessionId)!;
}

export function validateRefreshToken(token: string): Session | null {
  const db = getDatabase();
  const tokenHash = hashRefreshToken(token);

  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE refresh_token_hash = ?
      AND datetime(expires_at) > datetime('now')
  `).get(tokenHash) as Session | undefined;

  if (!session) {
    return null;
  }

  // Update last_used_at
  db.prepare('UPDATE sessions SET last_used_at = datetime("now") WHERE id = ?').run(session.id);

  return session;
}

export function revokeSession(sessionId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeAllUserSessions(userId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return result.changes;
}

// Cleanup expired sessions (run periodically)
export function cleanupExpiredSessions(): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')
  `).run();
  return result.changes;
}
```

### Brute Force Protection

```typescript
// packages/backend/src/services/brute-force.ts

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

export function recordLoginAttempt(username: string, ipAddress: string, success: boolean): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO login_attempts (username, ip_address, success)
    VALUES (?, ?, ?)
  `).run(username, ipAddress, success ? 1 : 0);
}

export function isLockedOut(username: string, ipAddress: string): boolean {
  const db = getDatabase();
  
  const cutoff = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();
  
  const failedAttempts = db.prepare(`
    SELECT COUNT(*) as count
    FROM login_attempts
    WHERE (username = ? OR ip_address = ?)
      AND success = 0
      AND datetime(attempted_at) > datetime(?)
  `).get(username, ipAddress, cutoff) as { count: number };

  return failedAttempts.count >= MAX_FAILED_ATTEMPTS;
}

export function clearLoginAttempts(username: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM login_attempts WHERE username = ?').run(username);
}

// Cleanup old attempts (run periodically)
export function cleanupOldAttempts(): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  const result = db.prepare(`
    DELETE FROM login_attempts WHERE datetime(attempted_at) < datetime(?)
  `).run(cutoff);
  return result.changes;
}
```

### Auth Middleware

```typescript
// packages/backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: UserRole;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const payload = verifyAccessToken(token);

  if (!payload) {
    throw new UnauthorizedError('Invalid or expired access token');
  }

  // Attach user to request
  req.user = {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
  };

  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    next();
  };
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required');
  }
  next();
}

export function requireAdminOrOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'owner' && req.user.role !== 'admin')) {
    throw new ForbiddenError('Admin or owner role required');
  }
  next();
}
```

### Rate Limiting

```typescript
// packages/backend/src/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';

// Strict rate limit for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Moderate rate limit for API endpoints
export const apiRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per window
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost in development
    if (process.env.NODE_ENV === 'development' && req.ip === '127.0.0.1') {
      return true;
    }
    return false;
  },
});

// Apply to routes:
// app.use('/api/auth', authRateLimit);
// app.use('/api', apiRateLimit);
```

### CORS Configuration

```typescript
// packages/backend/src/middleware/cors.ts
import cors from 'cors';

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // In development, allow Vite dev server
    if (process.env.NODE_ENV === 'development') {
      callback(null, true);
      return;
    }

    // In production, only allow Tauri app origin
    const allowedOrigins = [
      'tauri://localhost',
      'https://tauri.localhost',
    ];

    // If user configured a custom domain, add it
    const customDomain = process.env.CUSTOM_DOMAIN;
    if (customDomain) {
      allowedOrigins.push(`https://${customDomain}`);
    }

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
```

### Security Headers (Helmet)

```typescript
// packages/backend/src/middleware/security.ts
import helmet from 'helmet';

export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'ws://localhost:*', 'wss://localhost:*'],
      imgSrc: ["'self'", 'data:', 'https://cdn.modrinth.com'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind needs unsafe-inline
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
```

---

## TLS/HTTPS Setup

### Certificate Options

The backend must support HTTPS when network-facing. Three options:

1. **Let's Encrypt (automatic)** — Best for users with a domain name
2. **User-provided certificate** — For users who already have a cert
3. **Self-signed certificate** — For LAN-only use (not recommended for internet)

### Let's Encrypt Integration

```typescript
// packages/backend/src/services/tls.ts
import { ACME } from '@root/acme';
import { promises as fs } from 'fs';
import path from 'path';

interface TLSConfig {
  mode: 'letsencrypt' | 'custom' | 'self-signed' | 'disabled';
  domain?: string;           // For Let's Encrypt
  email?: string;            // For Let's Encrypt
  certPath?: string;         // For custom cert
  keyPath?: string;          // For custom cert
}

export async function setupTLS(config: TLSConfig, dataDir: string): Promise<{ cert: string; key: string } | null> {
  switch (config.mode) {
    case 'letsencrypt':
      return setupLetsEncrypt(config.domain!, config.email!, dataDir);
    
    case 'custom':
      return loadCustomCert(config.certPath!, config.keyPath!);
    
    case 'self-signed':
      return generateSelfSignedCert(dataDir);
    
    case 'disabled':
      return null;
  }
}

async function setupLetsEncrypt(domain: string, email: string, dataDir: string): Promise<{ cert: string; key: string }> {
  const certDir = path.join(dataDir, 'certs', domain);
  await fs.mkdir(certDir, { recursive: true });

  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  // Check if valid cert already exists
  if (await certExists(certPath, keyPath)) {
    const cert = await fs.readFile(certPath, 'utf-8');
    const key = await fs.readFile(keyPath, 'utf-8');
    
    if (!isCertExpiringSoon(cert)) {
      return { cert, key };
    }
  }

  // Request new certificate via ACME
  const acme = ACME.create({
    maintainerEmail: email,
    packageAgent: 'mc-server-manager/1.0',
    notify: (ev, msg) => {
      logger.info({ event: ev, message: msg }, 'ACME event');
    },
  });

  await acme.init('https://acme-v02.api.letsencrypt.org/directory');

  // Generate account key
  const accountKey = await acme.accounts.create({
    subscriberEmail: email,
    agreeToTerms: true,
  });

  // Generate server key
  const serverKey = await acme.keys.generate({ kty: 'RSA', format: 'jwk' });
  const serverKeyPem = await acme.keys.export({ jwk: serverKey });

  // Create CSR
  const csr = await acme.csr.create({
    key: serverKey,
    domains: [domain],
  });

  // Request certificate
  const cert = await acme.certificates.create({
    account: accountKey,
    accountKey,
    csr,
    domains: [domain],
    challenges: {
      'http-01': {
        set: async (opts) => {
          // Store challenge for HTTP-01 validation
          // The Express server needs to serve this at /.well-known/acme-challenge/<token>
          await fs.writeFile(
            path.join(dataDir, 'acme-challenge', opts.token),
            opts.keyAuthorization
          );
        },
        remove: async (opts) => {
          await fs.unlink(path.join(dataDir, 'acme-challenge', opts.token));
        },
      },
    },
  });

  // Save certificate and key
  await fs.writeFile(certPath, cert.cert);
  await fs.writeFile(keyPath, serverKeyPem);

  return { cert: cert.cert, key: serverKeyPem };
}

async function loadCustomCert(certPath: string, keyPath: string): Promise<{ cert: string; key: string }> {
  const cert = await fs.readFile(certPath, 'utf-8');
  const key = await fs.readFile(keyPath, 'utf-8');
  return { cert, key };
}

async function generateSelfSignedCert(dataDir: string): Promise<{ cert: string; key: string }> {
  const forge = require('node-forge');
  const pki = forge.pki;

  // Generate key pair
  const keys = pki.rsa.generateKeyPair(2048);

  // Create certificate
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'MC Server Manager' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const certPem = pki.certificateToPem(cert);
  const keyPem = pki.privateKeyToPem(keys.privateKey);

  // Save to disk
  const certDir = path.join(dataDir, 'certs', 'self-signed');
  await fs.mkdir(certDir, { recursive: true });
  await fs.writeFile(path.join(certDir, 'cert.pem'), certPem);
  await fs.writeFile(path.join(certDir, 'key.pem'), keyPem);

  return { cert: certPem, key: keyPem };
}

function isCertExpiringSoon(certPem: string): boolean {
  const forge = require('node-forge');
  const cert = forge.pki.certificateFromPem(certPem);
  const expiryDate = new Date(cert.validity.notAfter);
  const daysUntilExpiry = (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry < 30; // Renew if less than 30 days
}

async function certExists(certPath: string, keyPath: string): Promise<boolean> {
  try {
    await fs.access(certPath);
    await fs.access(keyPath);
    return true;
  } catch {
    return false;
  }
}
```

### HTTPS Server Setup

```typescript
// packages/backend/src/index.ts
import https from 'https';
import http from 'http';
import { setupTLS } from './services/tls.js';

async function startServer() {
  const app = createExpressApp();
  
  const tlsConfig = await loadTLSConfig(); // From settings table
  const tls = await setupTLS(tlsConfig, config.dataDir);

  let server: http.Server | https.Server;

  if (tls) {
    server = https.createServer({ cert: tls.cert, key: tls.key }, app);
    logger.info('HTTPS server enabled');
  } else {
    server = http.createServer(app);
    logger.warn('Running without HTTPS (not recommended for network-facing deployments)');
  }

  // Attach WebSocket server
  const wss = new WebSocketServer({ server });
  setupWebSocketHandlers(wss);

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0'; // Bind to all interfaces

  server.listen(port, host, () => {
    logger.info({ port, host, https: !!tls }, 'Server started');
  });
}
```

### ACME Challenge Route

```typescript
// packages/backend/src/routes/acme.ts
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';

const router = express.Router();

// Serve ACME HTTP-01 challenges
router.get('/.well-known/acme-challenge/:token', async (req, res) => {
  const token = req.params.token;
  const challengePath = path.join(config.dataDir, 'acme-challenge', token);

  try {
    const keyAuthorization = await fs.readFile(challengePath, 'utf-8');
    res.type('text/plain').send(keyAuthorization);
  } catch {
    res.status(404).send('Challenge not found');
  }
});

export default router;
```

---

## Network Configuration

### Backend Binding

Change from `127.0.0.1` (localhost only) to `0.0.0.0` (all interfaces):

```typescript
// packages/backend/src/config.ts
export const config = {
  host: process.env.HOST || '0.0.0.0',  // Changed from 127.0.0.1
  port: parseInt(process.env.PORT || '3001', 10),
  // ...
};
```

### Port Forwarding (Optional UPnP)

For users without manual port forwarding knowledge, implement automatic UPnP:

```typescript
// packages/backend/src/services/upnp.ts
import natUpnp from 'nat-upnp';

export async function setupPortForwarding(port: number): Promise<boolean> {
  const client = natUpnp.createClient();

  try {
    await client.portMapping({
      public: port,
      private: port,
      ttl: 0, // Permanent
      description: 'MC Server Manager',
    });

    logger.info({ port }, 'UPnP port forwarding enabled');
    return true;
  } catch (error) {
    logger.warn({ error, port }, 'UPnP port forwarding failed (manual setup required)');
    return false;
  }
}

export async function removePortForwarding(port: number): Promise<void> {
  const client = natUpnp.createClient();
  try {
    await client.portUnmapping({ public: port });
    logger.info({ port }, 'UPnP port forwarding removed');
  } catch (error) {
    logger.warn({ error, port }, 'Failed to remove UPnP port forwarding');
  }
}
```

### Settings Table Schema Addition

```sql
-- Add to migration 002_multi_user.sql

-- App-level settings (TLS, network, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('tls_mode', 'disabled'),
  ('tls_domain', ''),
  ('tls_email', ''),
  ('host', '0.0.0.0'),
  ('port', '3001'),
  ('upnp_enabled', 'false');
```

---

## Frontend Changes

### Setup Wizard (First Run)

```typescript
// packages/frontend/src/pages/Setup.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupAccount } from '../api/auth';

export default function Setup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const { user, accessToken, refreshToken } = await setupAccount({
        username,
        password,
        displayName,
      });

      // Store tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      // Redirect to dashboard
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="max-w-md w-full bg-slate-800 rounded-lg p-8">
        <h1 className="text-2xl font-bold text-white mb-6">Welcome to MC Server Manager</h1>
        <p className="text-slate-300 mb-6">
          Create your owner account to get started. You'll be able to invite friends later.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded"
              required
              maxLength={50}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded"
              required
              minLength={8}
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded"
          >
            Create Account
          </button>
        </form>
      </div>
    </div>
  );
}
```

### Login Page

```typescript
// packages/frontend/src/pages/Login.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const { user, accessToken, refreshToken } = await login({ username, password });

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      navigate('/');
    } catch (err: any) {
      if (err.status === 429) {
        setError('Too many login attempts. Please try again later.');
      } else {
        setError('Invalid username or password');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="max-w-md w-full bg-slate-800 rounded-lg p-8">
        <h1 className="text-2xl font-bold text-white mb-6">Login</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded"
              required
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
```

### Auth API Client

```typescript
// packages/frontend/src/api/auth.ts
import { BASE_URL } from './client';
import type { SetupRequest, RegisterRequest, LoginRequest, AuthResponse, RefreshResponse } from '@mc-server-manager/shared';

export async function setupAccount(data: SetupRequest): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Setup failed');
  }

  return res.json();
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Registration failed');
  }

  return res.json();
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    const err: any = new Error(error.message || 'Login failed');
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    throw new Error('Token refresh failed');
  }

  return res.json();
}

export async function logout(refreshToken: string): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}
```

### Auth Context & Token Refresh

```typescript
// packages/frontend/src/contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { refreshAccessToken } from '../api/auth';
import type { User } from '@mc-server-manager/shared';

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem('accessToken')
  );

  // Decode JWT to get user info
  useEffect(() => {
    if (accessToken) {
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        setUser({
          id: payload.sub,
          username: payload.username,
          role: payload.role,
          // Other fields fetched separately if needed
        } as User);
      } catch {
        setAccessToken(null);
      }
    } else {
      setUser(null);
    }
  }, [accessToken]);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!accessToken) return;

    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    const expiresAt = payload.exp * 1000; // Convert to ms
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;

    // Refresh 1 minute before expiry
    const refreshTime = timeUntilExpiry - 60 * 1000;

    if (refreshTime <= 0) {
      // Already expired, refresh immediately
      handleRefresh();
      return;
    }

    const timer = setTimeout(handleRefresh, refreshTime);
    return () => clearTimeout(timer);
  }, [accessToken]);

  const handleRefresh = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      setAccessToken(null);
      return;
    }

    try {
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);
      
      localStorage.setItem('accessToken', newAccessToken);
      setAccessToken(newAccessToken);

      if (newRefreshToken) {
        localStorage.setItem('refreshToken', newRefreshToken);
      }
    } catch {
      // Refresh failed, log out
      setAccessToken(null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  };

  const logout = () => {
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, isAuthenticated: !!user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

### Protected Routes

```typescript
// packages/frontend/src/components/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

### Admin Panel (User Management)

```typescript
// packages/frontend/src/pages/Admin.tsx
import { useEffect, useState } from 'react';
import { getUsers, updateUserRole, deleteUser } from '../api/users';
import { createInvitation, getInvitations, deleteInvitation } from '../api/invitations';
import type { User, Invitation } from '@mc-server-manager/shared';

export default function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [usersData, invitationsData] = await Promise.all([
      getUsers(),
      getInvitations(),
    ]);
    setUsers(usersData);
    setInvitations(invitationsData);
  };

  const handleCreateInvite = async () => {
    const invite = await createInvitation({ maxUses: 1, expiresIn: '7d', role: 'member' });
    setInvitations([...invitations, invite]);
  };

  const handleDeleteInvite = async (id: string) => {
    await deleteInvitation(id);
    setInvitations(invitations.filter(i => i.id !== id));
  };

  const handleChangeRole = async (userId: string, role: 'admin' | 'member') => {
    await updateUserRole(userId, role);
    setUsers(users.map(u => u.id === userId ? { ...u, role } : u));
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    await deleteUser(userId);
    setUsers(users.filter(u => u.id !== userId));
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Admin Panel</h1>

      {/* Users Section */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Users</h2>
        <div className="bg-slate-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-700">
              <tr>
                <th className="px-4 py-2 text-left text-slate-300">Username</th>
                <th className="px-4 py-2 text-left text-slate-300">Display Name</th>
                <th className="px-4 py-2 text-left text-slate-300">Role</th>
                <th className="px-4 py-2 text-left text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-t border-slate-700">
                  <td className="px-4 py-2 text-white">{user.username}</td>
                  <td className="px-4 py-2 text-white">{user.displayName}</td>
                  <td className="px-4 py-2">
                    {user.role === 'owner' ? (
                      <span className="text-yellow-400">Owner</span>
                    ) : (
                      <select
                        value={user.role}
                        onChange={(e) => handleChangeRole(user.id, e.target.value as 'admin' | 'member')}
                        className="bg-slate-700 text-white rounded px-2 py-1"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {user.role !== 'owner' && (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Invitations Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Invitations</h2>
          <button
            onClick={handleCreateInvite}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Create Invite
          </button>
        </div>

        <div className="bg-slate-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-700">
              <tr>
                <th className="px-4 py-2 text-left text-slate-300">Code</th>
                <th className="px-4 py-2 text-left text-slate-300">Uses</th>
                <th className="px-4 py-2 text-left text-slate-300">Expires</th>
                <th className="px-4 py-2 text-left text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map(invite => (
                <tr key={invite.id} className="border-t border-slate-700">
                  <td className="px-4 py-2 text-white font-mono">{invite.code}</td>
                  <td className="px-4 py-2 text-white">
                    {invite.uses} / {invite.maxUses === 0 ? '∞' : invite.maxUses}
                  </td>
                  <td className="px-4 py-2 text-white">
                    {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDeleteInvite(invite.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **Database Schema** | ~2h | Migration 002_multi_user.sql with all tables |
| 2 | **Auth Services** | ~4h | Password hashing, JWT, session management, brute force protection |
| 3 | **Auth Routes** | ~3h | Setup, register, login, refresh, logout endpoints |
| 4 | **Auth Middleware** | ~2h | requireAuth, requireRole, permission checks |
| 5 | **User Management** | ~3h | User CRUD endpoints, role management |
| 6 | **Invitation System** | ~2h | Create/list/delete invitations, validation |
| 7 | **Server Permissions** | ~3h | Granular permission system, middleware integration |
| 8 | **Security Hardening** | ~3h | Rate limiting, CORS, Helmet, input validation |
| 9 | **TLS/HTTPS Setup** | ~4h | Let's Encrypt integration, custom cert support, self-signed fallback |
| 10 | **Network Config** | ~2h | Bind to 0.0.0.0, UPnP port forwarding, settings UI |
| 11 | **Frontend Auth** | ~4h | Setup wizard, login page, auth context, token refresh |
| 12 | **Admin Panel** | ~3h | User management UI, invitation UI |
| 13 | **Protected Routes** | ~2h | Route guards, permission-based UI rendering |

**Total: ~37 hours** (revised from initial 30h estimate after detailed design)

---

## Complete File Change Summary

### New Files (30+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/migrations/002_multi_user.sql` | 1 | Database schema for users, sessions, invitations, permissions |
| `packages/backend/src/services/auth.ts` | 2 | Password hashing (argon2) |
| `packages/backend/src/services/jwt.ts` | 2 | JWT generation and verification |
| `packages/backend/src/services/session.ts` | 2 | Refresh token management |
| `packages/backend/src/services/brute-force.ts` | 2 | Login attempt tracking and lockout |
| `packages/backend/src/services/tls.ts` | 9 | TLS/HTTPS setup (Let's Encrypt, custom, self-signed) |
| `packages/backend/src/services/upnp.ts` | 10 | UPnP port forwarding |
| `packages/backend/src/middleware/auth.ts` | 4 | Auth middleware (requireAuth, requireRole) |
| `packages/backend/src/middleware/rate-limit.ts` | 8 | Rate limiting configuration |
| `packages/backend/src/middleware/cors.ts` | 8 | CORS configuration |
| `packages/backend/src/middleware/security.ts` | 8 | Helmet security headers |
| `packages/backend/src/routes/auth.ts` | 3 | Auth endpoints (setup, register, login, refresh, logout) |
| `packages/backend/src/routes/users.ts` | 5 | User management endpoints |
| `packages/backend/src/routes/invitations.ts` | 6 | Invitation endpoints |
| `packages/backend/src/routes/acme.ts` | 9 | ACME HTTP-01 challenge handler |
| `packages/backend/src/models/user.ts` | 5 | User database queries |
| `packages/backend/src/models/session.ts` | 2 | Session database queries |
| `packages/backend/src/models/invitation.ts` | 6 | Invitation database queries |
| `packages/backend/src/models/server-permission.ts` | 7 | Server permission database queries |
| `packages/frontend/src/pages/Setup.tsx` | 11 | First-run setup wizard |
| `packages/frontend/src/pages/Login.tsx` | 11 | Login page |
| `packages/frontend/src/pages/Register.tsx` | 11 | Registration page (with invite code) |
| `packages/frontend/src/pages/Admin.tsx` | 12 | Admin panel (user/invitation management) |
| `packages/frontend/src/contexts/AuthContext.tsx` | 11 | Auth context provider, token refresh |
| `packages/frontend/src/components/ProtectedRoute.tsx` | 13 | Route guard component |
| `packages/frontend/src/api/auth.ts` | 11 | Auth API client functions |
| `packages/frontend/src/api/users.ts` | 12 | User management API client |
| `packages/frontend/src/api/invitations.ts` | 12 | Invitation API client |

### Modified Files (10+)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 1 | Add User, Session, Invitation, ServerPermission types |
| `packages/backend/src/index.ts` | 9 | HTTPS server setup, bind to 0.0.0.0 |
| `packages/backend/src/config.ts` | 10 | Add host, TLS config, UPnP settings |
| `packages/backend/src/app.ts` | 8 | Add auth middleware, rate limiting, CORS, Helmet |
| `packages/backend/src/routes/servers.ts` | 7 | Add permission checks to all endpoints |
| `packages/backend/src/ws/handlers.ts` | 7 | Add permission checks to WebSocket handlers |
| `packages/backend/src/models/server.ts` | 7 | Add creator_id column, permission queries |
| `packages/frontend/src/App.tsx` | 11 | Add AuthProvider, setup/login routes, protected routes |
| `packages/frontend/src/api/client.ts` | 11 | Add Authorization header injection |
| `packages/frontend/src/main.tsx` | 11 | Wrap app in AuthProvider |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| JWT secret compromise | Generate strong random secret on first startup. Store in settings table. Allow rotation via admin UI. Consider using asymmetric keys (RS256) for future scalability. |
| Refresh token theft | Hash tokens before storage. Implement token rotation on refresh. Detect concurrent use (token reuse = revoke all sessions). Store device info and IP for anomaly detection. |
| Let's Encrypt rate limits | Cache certificates. Renew 30 days before expiry. Provide fallback to custom cert if LE fails. Document rate limits (50 certs/week per domain). |
| Port forwarding fails | UPnP is best-effort. Provide clear manual setup instructions. Detect public IP and show in UI. Test connectivity with external ping service. |

### Medium

| Risk | Mitigation |
|------|------------|
| Brute force attacks | Rate limit auth endpoints (5 attempts/15min). Track by username AND IP. Progressive delays. Log all failed attempts. Consider CAPTCHA for repeated failures. |
| Session fixation | Generate new session ID on login. Invalidate old sessions. Bind session to IP (optional, breaks mobile). |
| CORS misconfiguration | Strict origin whitelist. Never use `*` in production. Test with actual Tauri app origin. |
| Password strength | Enforce minimum 8 chars. Recommend password manager. Consider zxcvbn for strength estimation. |

### Low

| Risk | Mitigation |
|------|------------|
| Clock skew (JWT expiry) | Use short-lived access tokens (15 min). Refresh tokens are long-lived (30 days). Server clock sync is user's responsibility. |
| Database encryption at rest | SQLite doesn't encrypt by default. Consider SQLCipher for sensitive deployments. Document this limitation. |
| Avatar URL injection | Validate URLs. Whitelist domains or use data URIs. Sanitize in UI rendering. |

---

## Testing Checklist

1. **Setup Flow**: First run shows setup wizard, creates owner account, redirects to dashboard
2. **Login Flow**: Login with valid credentials succeeds, invalid fails with error, brute force triggers lockout
3. **Token Refresh**: Access token auto-refreshes before expiry, expired refresh token logs out
4. **Invitation System**: Owner creates invite, friend registers with code, code exhausts after max uses, expired codes rejected
5. **Role Permissions**: Owner can do everything, Admin can manage users/servers, Member has limited access
6. **Server Permissions**: Granular permissions work (view-only, start-only, etc.), Owner/Admin bypass checks
7. **TLS/HTTPS**: Let's Encrypt provisions cert (with test domain), custom cert loads, self-signed works for LAN
8. **Network Binding**: Backend binds to 0.0.0.0, accessible from other devices on LAN
9. **Rate Limiting**: Auth endpoints rate limit after 5 attempts, API endpoints rate limit after 100/min
10. **CORS**: Tauri app origin allowed, other origins blocked
11. **Security Headers**: Helmet headers present in responses
12. **Session Management**: Logout revokes refresh token, logout-all revokes all sessions, expired sessions cleaned up
13. **Brute Force Protection**: 5 failed logins lock account for 15 min, successful login clears attempts
14. **WebSocket Auth**: WS connections require valid access token, expired token disconnects

---

## Security Audit Checklist

Before deploying to production (network-facing):

- [ ] JWT secret is strong random value (64+ bytes)
- [ ] Passwords hashed with argon2id (not bcrypt, not SHA-256)
- [ ] Refresh tokens hashed before storage (SHA-256 minimum)
- [ ] Rate limiting enabled on all auth endpoints
- [ ] CORS configured with strict origin whitelist
- [ ] Helmet security headers enabled
- [ ] TLS/HTTPS enabled (not self-signed for internet-facing)
- [ ] Input validation on all endpoints (Zod schemas)
- [ ] SQL injection prevented (prepared statements only)
- [ ] Path traversal prevented (validate all file paths)
- [ ] Brute force protection enabled
- [ ] Session expiry enforced (cleanup job running)
- [ ] Owner role cannot be deleted or demoted
- [ ] Invite codes are cryptographically random (nanoid)
- [ ] No secrets in logs (redact passwords, tokens)
- [ ] Error messages don't leak sensitive info (no stack traces to client)

---

## Future Enhancements (Post-Epic 5)

These are explicitly out of scope for Epic 5 but noted for future epics:

- **Two-factor authentication (2FA)** — TOTP via authenticator app
- **OAuth/SSO** — Login with Discord, Google, etc.
- **Email verification** — Require email confirmation for registration
- **Password reset** — Email-based password reset flow
- **Audit log** — Track all admin actions (user created, role changed, etc.)
- **IP whitelisting** — Restrict access to specific IP ranges
- **Device management** — View and revoke sessions per device
- **Account recovery** — Owner can reset any user's password
- **API keys** — Generate API keys for programmatic access (for Epic 7+ automation)

---

## Dependencies

### New npm Packages (Backend)

```json
{
  "dependencies": {
    "argon2": "^0.31.0",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.1.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "@root/acme": "^3.1.0",
    "node-forge": "^1.3.1",
    "nat-upnp": "^2.0.0"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.5",
    "@types/cors": "^2.8.17",
    "@types/node-forge": "^1.3.11"
  }
}
```

### New npm Packages (Frontend)

```json
{
  "dependencies": {
    // No new dependencies — uses existing React, React Router, Zustand
  }
}
```

---

## Summary

Epic 5 is the **platform pivot** — it transforms MC Server Manager from a single-user desktop tool into a multi-user community platform. This is the foundation for all social features (Epics 6-9).

**Key Deliverables:**
- Complete authentication system (JWT + refresh tokens)
- User accounts with role-based permissions
- Invitation system for controlled access
- Granular per-server permissions
- TLS/HTTPS support (Let's Encrypt + custom certs)
- Security hardening (rate limiting, CORS, CSP, brute force protection)
- Network configuration (bind to 0.0.0.0, UPnP port forwarding)
- Frontend auth UI (setup wizard, login, admin panel)

**Estimated Effort:** ~37 hours

**Critical Success Factors:**
1. Security must be rock-solid — this is the foundation for all social features
2. Permission system must be flexible enough for future features (chat channels, voice rooms)
3. TLS setup must be user-friendly (auto-provision via Let's Encrypt)
4. Token refresh must be seamless (no user-visible interruptions)

After Epic 5, the app is ready for friends to connect remotely. Epics 6-9 build on this foundation to add chat, shared servers, voice, and mod sync.
