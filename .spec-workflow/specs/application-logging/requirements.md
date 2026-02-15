# Requirements Document

## Introduction

MC Server Manager currently has inconsistent application logging and error handling. The backend uses Pino in ~42 of ~74 source files, but critical areas — the model layer, auth middleware, session management, rate limiting — have no logging at all. Approximately 15+ catch blocks silently swallow errors, making failures invisible. The frontend has zero structured logging: errors are either shown as toasts (invisible to developers) or silently discarded.

This gap was exposed when users experienced "Too many requests" (429) errors during normal browsing. The rate limiter was rejecting requests, but no log entry existed to indicate this was happening, what the request was, or which client was affected. Debugging required reading source code rather than reading logs.

This spec adds structured, consistent logging across the backend and frontend to make failures visible, errors debuggable, and operational patterns observable — without introducing external services or heavy infrastructure.

## Alignment with Project Direction

Logging and error visibility are foundational infrastructure that support every current and future feature. As the app evolves into a multi-user community platform with social features (friends, chat, voice), the surface area for failures grows. Per the product principles, the app should "just work" after setup — but when it doesn't, operators need visibility into what went wrong without SSH-ing into the machine and reading source code.

This spec is purely additive and infrastructure-level. It does not depend on or block any feature spec, but every feature spec benefits from it.

### Dependencies

- **Depends on**: None (standalone infrastructure improvement)
- **Depended on by**: All future specs benefit from improved observability

---

## Requirements

### REQ-1: Backend Error Middleware Logging

**User Story:** As a server operator, I want all API errors to be logged with request context, so that I can diagnose issues from the server logs without reproducing the problem.

#### Acceptance Criteria

1. WHEN the Express error middleware handles an `AppError` (4xx), THEN the system SHALL log the error at `warn` level including: HTTP method, request path, status code, error code, and authenticated user ID (if present).
2. WHEN the Express error middleware handles an unexpected error (5xx), THEN the system SHALL log the error at `error` level including: HTTP method, request path, query parameters, error stack trace, and authenticated user ID (if present).
3. WHEN any middleware rejects a request (auth failure, rate limit, CORS), THEN the system SHALL log the rejection at `warn` level with the rejection reason, client IP, and request path.

### REQ-2: Backend Silent Catch Block Remediation

**User Story:** As a server operator, I want all caught errors to leave a trace in the logs, so that silent failures don't create mysterious broken behavior.

#### Acceptance Criteria

1. WHEN a catch block handles an error in a service or middleware, THEN the system SHALL log the error at an appropriate level (`debug` for expected/probing operations like Java path scanning, `warn` for recoverable failures, `error` for unexpected failures).
2. WHEN an error occurs during server process lifecycle (start, stop, kill, stdin write), THEN the system SHALL log the error at `warn` or `error` level with the server ID and operation context.
3. WHEN an error occurs during shutdown (graceful stop, force-kill), THEN the system SHALL log the error at `warn` level with the server ID.
4. IF a catch block intentionally discards an error (e.g., probing for Java in known-optional paths), THEN the system SHALL log at `debug` level so it is visible when debug logging is enabled.

### REQ-3: Backend Model/Service Layer Logging

**User Story:** As a server operator, I want database and auth operations to be logged, so that I can trace the system's behavior when investigating issues.

#### Acceptance Criteria

1. WHEN a security-sensitive operation occurs (login attempt, session creation, session revocation, lockout triggered, token refresh), THEN the system SHALL log the event at `info` level with relevant identifiers (username, user ID, IP address as appropriate).
2. WHEN a brute-force lockout is triggered for a username or IP, THEN the system SHALL log at `warn` level with the locked-out username and IP address.
3. WHEN expired sessions or old login attempts are cleaned up, THEN the system SHALL log the count of cleaned-up records at `info` level.

### REQ-4: Backend WebSocket Lifecycle Logging

**User Story:** As a server operator, I want WebSocket connection events logged, so that I can diagnose real-time communication issues.

#### Acceptance Criteria

1. WHEN a WebSocket client authenticates successfully, THEN the system SHALL log at `info` level with the user ID and username.
2. WHEN a WebSocket client fails to authenticate (invalid token, timeout), THEN the system SHALL log at `warn` level with the failure reason.
3. WHEN a WebSocket client disconnects, THEN the system SHALL log at `debug` level with the user ID (if authenticated) and the number of active subscriptions at time of disconnect.

### REQ-5: Frontend Logger Utility

**User Story:** As a developer, I want a structured logging utility in the frontend, so that error information is captured consistently and is accessible for debugging.

#### Acceptance Criteria

1. WHEN the logger is used in the frontend, THEN it SHALL produce structured output including: timestamp, log level, message, and optional context object.
2. WHEN running in development mode, THEN the logger SHALL output to the browser console with human-readable formatting.
3. WHEN running in production mode (Electron or production build), THEN the logger SHALL output to the browser console (and be available for future extension to an external endpoint).
4. The logger SHALL support levels: `debug`, `info`, `warn`, `error`.

### REQ-6: Frontend Silent Failure Remediation

**User Story:** As a developer, I want all caught frontend errors to be logged with context, so that I can debug issues users report without needing to reproduce them.

#### Acceptance Criteria

1. WHEN a catch block in the frontend handles an API error, THEN the system SHALL log the error via the logger with: the operation that failed, HTTP status code (if available), error message, and relevant entity IDs (server ID, instance ID, etc.).
2. WHEN a catch block currently swallows an error silently (empty catch), THEN the system SHALL be updated to log the error at `warn` or `error` level with context.
3. WHEN the AuthContext token refresh fails, THEN the system SHALL log at `warn` level with the failure reason before clearing auth state.
4. WHEN the WebSocket client encounters a connection error, parse error, or unexpected close, THEN the system SHALL log the event at `warn` level with error details and reconnect attempt count.

### REQ-7: Frontend ErrorBoundary Enhancement

**User Story:** As a developer, I want React component crashes captured with structured logging, so that production crashes are visible beyond just the browser console.

#### Acceptance Criteria

1. WHEN the ErrorBoundary catches a React component error, THEN the system SHALL log the error via the frontend logger at `error` level with the error message, component stack, and current route path.
2. The ErrorBoundary SHALL continue to render the existing fallback UI.

### REQ-8: Backend Rate Limit Logging

**User Story:** As a server operator, I want rate limit rejections logged, so that I can see when and why clients are being throttled.

#### Acceptance Criteria

1. WHEN the auth rate limiter rejects a request, THEN the system SHALL log at `warn` level with: client IP, request path, and the rate limit that was exceeded.
2. The rate limit logging SHALL use the existing Pino logger instance.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility**: Each new file handles one domain (one model, one service, one route file, one component concern)
- **Modular Design**: Components, services, and models are isolated and reusable across the app
- **Transport Separation**: Business logic lives in services, not in route handlers or WebSocket handlers
- **Clear Interfaces**: New modules export typed functions; Electron features flow through the contextBridge preload script

### Performance
- Logging SHALL NOT introduce measurable latency to request handling. Pino's async logging handles this by default.
- Frontend logging SHALL NOT impact rendering performance. Console output is synchronous but negligible for error-frequency events.
- No new npm dependencies SHALL be added to the backend (Pino is already present).
- The frontend logger SHALL be a lightweight utility (no heavy logging libraries).

### Security
- Log entries for auth operations SHALL NOT include passwords, tokens, or refresh tokens. Only user IDs, usernames, and IP addresses are acceptable.
- Log entries SHALL NOT include full request bodies for auth endpoints (which contain passwords).
- The frontend logger SHALL NOT log sensitive data (tokens, passwords).

### Reliability
- Adding logging SHALL NOT change any existing application behavior (purely additive).
- All existing catch block behavior (returning defaults, re-throwing, etc.) SHALL be preserved — logging is added alongside, not instead of, existing error handling.
- If logging itself fails (e.g., disk full for Pino), the application SHALL continue functioning normally.

### Usability
- Backend logs SHALL use Pino's structured JSON format (production) and pino-pretty (development), consistent with existing logger configuration.
- Frontend logs SHALL be readable in browser DevTools during development.
- Log messages SHALL be concise and grep-friendly (e.g., "Auth token refresh failed" not "An error occurred while attempting to refresh the authentication token").
