# Requirements Document -- Multi-User Foundation

## Introduction

Transform MC Server Manager from a single-user desktop application into a multi-user community platform. The host runs the Express backend as a network-facing server that friends connect to over the internet. This epic implements authentication, authorization, invitation-based registration, role-based permissions, TLS/HTTPS security, and the frontend auth UI.

This is the platform pivot -- all social features (Friends & Chat, Shared Servers, Voice Communication, Mod Sync) depend on this multi-user foundation being in place.

## Alignment with Product Vision

MC Server Manager evolves from "manage my servers locally" to "invite friends to my community." The host shares their server dashboard with friends who can view server status, join game servers, and (in later epics) chat and voice call. This requires:
- Secure user authentication (JWT + refresh tokens)
- Controlled access via invite codes (no open registration)
- Role-based permissions (Owner/Admin/Member with granular per-server control)
- TLS/HTTPS for network-facing security

Prerequisite for: Epic 6 (Friends & Chat), Epic 7 (Shared Servers), Epic 8 (Voice), Epic 9 (Mod Sync).

---

## Requirements

### REQ-1: Initial Setup (Owner Account)

**User Story:** As the host, I want to create an owner account on first launch, so that I have full control over my community.

#### Acceptance Criteria

1. WHEN the application starts with no users in the database THEN the system SHALL display a setup wizard prompting for username, password, and display name.
2. WHEN the setup form is submitted THEN the system SHALL create the first user with `role=owner` and hash the password using argon2id.
3. WHEN setup completes THEN the system SHALL return JWT access token (15-minute expiry) and refresh token (30-day expiry) and redirect to the dashboard.
4. WHEN an owner account already exists THEN the setup endpoint SHALL return 409 Conflict.
5. WHEN running locally without multi-user configured THEN existing single-user functionality SHALL continue to work without requiring login.

---

### REQ-2: Invitation-Based Registration

**User Story:** As the host, I want to generate invite codes for friends, so that only people I trust can access my community.

#### Acceptance Criteria

1. WHEN the owner or admin creates an invitation THEN the system SHALL generate a unique 8-character code with configurable: max uses (default 1), expiration duration, and assigned role (default member).
2. WHEN a friend registers with a valid invite code THEN the system SHALL create their account with the role specified in the invitation and increment the usage counter.
3. IF an invite code has reached its max uses THEN the system SHALL reject registration with a clear error.
4. IF an invite code has expired THEN the system SHALL reject registration with a clear error.
5. WHEN the owner or admin lists invitations THEN the system SHALL show: code, uses/max, role, expiration, and creation date.
6. WHEN the owner or admin deletes an invitation THEN the system SHALL invalidate the code immediately.

---

### REQ-3: Login and Session Management

**User Story:** As a user, I want to log in with my username and password, so that I can access the community dashboard.

#### Acceptance Criteria

1. WHEN the user submits valid credentials THEN the system SHALL return a JWT access token (15-minute expiry) and a refresh token (30-day expiry stored as SHA-256 hash in the sessions table).
2. WHEN the access token expires THEN the frontend SHALL automatically refresh it using the refresh token without user interaction.
3. WHEN the refresh token is used THEN the system SHALL verify it against the sessions table, check expiry, and optionally rotate the token.
4. WHEN the user logs out THEN the system SHALL delete the session record (invalidating the refresh token) and the frontend SHALL discard both tokens.
5. WHEN the user selects "logout all sessions" THEN the system SHALL delete all session records for that user, forcing re-authentication on all devices.
6. IF the user's account is deactivated THEN login and token refresh SHALL be rejected.

---

### REQ-4: Brute Force Protection

**User Story:** As the host, I want login attempts to be rate-limited, so that attackers cannot guess passwords through brute force.

#### Acceptance Criteria

1. WHEN 5 failed login attempts occur for the same username or IP within 15 minutes THEN the system SHALL block further attempts for that username/IP with a 429 response.
2. WHEN a successful login occurs THEN the system SHALL clear the failed attempt counter for that username.
3. WHEN login attempts are recorded THEN the system SHALL store: username, IP address, success/failure, and timestamp.
4. WHEN old login attempt records exceed 7 days THEN the system SHALL clean them up automatically.

---

### REQ-5: Role-Based Access Control

**User Story:** As the host, I want to assign roles to users, so that I can control what each person can do.

#### Acceptance Criteria

1. WHEN a user has the Owner role THEN they SHALL have full access to all features, servers, and administrative functions.
2. WHEN a user has the Admin role THEN they SHALL have full access to all servers and the ability to manage users (except the Owner) and create invitations.
3. WHEN a user has the Member role THEN they SHALL only have access to servers where they have been explicitly granted permissions.
4. WHEN the Owner changes a user's role THEN the system SHALL update it immediately and the user's next token refresh SHALL reflect the new role.
5. WHEN any user (except the Owner) is deactivated THEN their sessions SHALL be revoked and they SHALL be unable to log in.
6. The Owner account SHALL NOT be deletable or demotable.

---

### REQ-6: Granular Server Permissions

**User Story:** As the host, I want to control exactly what each member can do on each server, so that I can give limited access to friends.

#### Acceptance Criteria

1. WHEN a Member views the server list THEN they SHALL only see servers where they have `can_view` permission.
2. WHEN permissions are configured for a user on a server THEN the system SHALL support: `can_view` (see server), `can_start` (start/stop/restart), `can_console` (send commands), `can_edit` (change settings).
3. WHEN a user lacks the required permission for an action THEN the API SHALL return 403 Forbidden and the UI SHALL hide or disable the corresponding controls.
4. WHEN an Owner or Admin accesses any server THEN permission checks SHALL be bypassed (full access).
5. WHEN a server is deleted THEN all associated permission records SHALL be cascade-deleted.

---

### REQ-7: TLS/HTTPS Support

**User Story:** As the host, I want my community server to use HTTPS, so that connections from friends are encrypted and secure.

#### Acceptance Criteria

1. WHEN TLS mode is set to "letsencrypt" THEN the system SHALL automatically provision and renew certificates from Let's Encrypt using the HTTP-01 challenge.
2. WHEN TLS mode is set to "custom" THEN the system SHALL load user-provided certificate and key files.
3. WHEN TLS mode is set to "self-signed" THEN the system SHALL generate a self-signed certificate for LAN-only use.
4. WHEN TLS mode is set to "disabled" THEN the system SHALL run plain HTTP (with a warning log).
5. WHEN a Let's Encrypt certificate is within 30 days of expiry THEN the system SHALL automatically renew it.
6. WHEN TLS is enabled THEN the WebSocket server SHALL also use the TLS certificate (wss://).

---

### REQ-8: Network Configuration

**User Story:** As the host, I want to configure how my community server is accessible on the network, so that friends can connect from the internet.

#### Acceptance Criteria

1. WHEN multi-user mode is enabled THEN the backend SHALL bind to `0.0.0.0` (all interfaces) instead of `127.0.0.1`.
2. WHEN UPnP is enabled in settings THEN the system SHALL attempt automatic port forwarding via UPnP.
3. IF UPnP port forwarding fails THEN the system SHALL log a warning and display manual port forwarding instructions.
4. WHEN the user views network settings THEN the system SHALL show: current bind address, port, public IP (detected), TLS status, and UPnP status.

---

### REQ-9: Security Hardening

**User Story:** As the host, I want the server to follow security best practices, so that my community is protected from attacks.

#### Acceptance Criteria

1. WHEN the server starts THEN it SHALL apply security headers via Helmet (CSP, HSTS, referrer policy, etc.).
2. WHEN the server starts THEN it SHALL configure CORS to only allow the Tauri app origin and any configured custom domain.
3. WHEN API endpoints are called THEN a general rate limiter SHALL allow a maximum of 100 requests per minute per IP.
4. WHEN auth endpoints are called THEN a strict rate limiter SHALL allow a maximum of 5 requests per 15 minutes per IP.
5. WHEN any request contains user input THEN it SHALL be validated using Zod schemas before processing.
6. WHEN JWT secrets are needed THEN the system SHALL auto-generate a 64-byte random secret on first startup and store it in the settings table.

---

### REQ-10: Frontend Auth UI

**User Story:** As a user, I want login, registration, and admin pages, so that I can manage my account and community.

#### Acceptance Criteria

1. WHEN no users exist THEN the app SHALL show the setup wizard at the root route.
2. WHEN the user is not authenticated THEN all routes SHALL redirect to the login page.
3. WHEN the user is authenticated THEN the app SHALL show the dashboard with a user menu (profile, logout).
4. WHEN a friend has an invite code THEN they SHALL be able to register via `/register?code=...`.
5. WHEN an Owner or Admin navigates to the admin panel THEN they SHALL see: user list (with role management), active invitations (with create/delete), and server permission management.
6. WHEN a Member navigates to the admin panel THEN the system SHALL deny access and redirect to the dashboard.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Auth services (password hashing, JWT, sessions, brute force) SHALL each be in separate files.
- **Modular Design**: Auth middleware SHALL be composable (`requireAuth`, `requireRole('admin')`, `requireServerPermission('can_start')`).
- **Backward Compatibility**: When running in single-user mode (no users exist), all existing functionality SHALL work without authentication.
- **Clear Interfaces**: All auth types (User, Session, Invitation, etc.) SHALL be defined in the shared package.

### Performance
- JWT verification SHALL be synchronous and under 1ms (HS256 with cached secret).
- Password hashing with argon2id SHALL complete within 500ms (configurable via memory/time cost parameters).
- Token refresh SHALL be seamless -- users SHALL NOT experience authentication interruptions.

### Security
- Passwords SHALL be hashed with argon2id (OWASP recommended), NOT bcrypt or SHA-256.
- Refresh tokens SHALL be hashed (SHA-256) before database storage -- never stored in plaintext.
- JWT secrets SHALL be minimum 64 bytes of cryptographically random data.
- All sensitive data (passwords, tokens) SHALL be excluded from logs.
- Error responses SHALL NOT leak internal details (no stack traces, no "user not found" vs "wrong password" distinction).

### Reliability
- IF the JWT secret is lost (database corruption) THEN all tokens are automatically invalidated and users must re-authenticate.
- IF TLS certificate provisioning fails THEN the server SHALL fall back to HTTP with clear warnings.
- Session cleanup (expired tokens, old login attempts) SHALL run on a periodic timer (every hour).

### Usability
- Token refresh SHALL be invisible to users -- the frontend handles it automatically.
- The setup wizard SHALL be simple: 3 fields (username, display name, password).
- Invite codes SHALL be short (8 characters) and easy to share via text/chat.
- The admin panel SHALL provide one-click invite code generation with copy-to-clipboard.
