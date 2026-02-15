# Design Document

## Overview

This design establishes a Vitest-based testing suite across the MC Server Manager monorepo. The suite covers three testable packages — `shared`, `backend`, and `frontend` — with package-specific configurations, shared test utilities, and an initial set of tests targeting the highest-value code paths.

The architecture uses Vitest workspaces to orchestrate per-package test runs from a single root command, supertest for backend HTTP integration tests against the exported Express `app`, Testing Library for frontend component tests in a happy-dom environment, and in-memory SQLite databases for backend test isolation.

Electron is explicitly excluded from this spec — its testing requires Electron-specific tooling (Playwright Electron or Spectron) and is a separate concern.

## Steering Document Alignment

- **tech.md**: "No automated tests: All verification is manual or build-based. High-risk area." — this spec directly addresses that gap.
- **tech.md**: "No DI container: Services are singletons imported directly. No IoC framework." — the design works within this constraint by using supertest integration tests (which exercise real singletons) rather than requiring DI refactoring.
- **product.md**: "Reliability of server management (zero orphaned processes, clean shutdown)" — testing the ConsoleBuffer, error classes, properties parser, and API routes provides automated regression coverage for the server management core.
- **structure.md**: File naming (`kebab-case.ts`), import conventions (`.js` extensions in backend), and module boundaries are all respected.

## Code Reuse Analysis

### Existing Code to Leverage

- **`packages/backend/src/app.ts`**: Exports `app` (Express instance) separately from server startup — supertest can use it directly without starting an HTTP server.
- **`packages/backend/src/services/database.ts`**: `initDatabase()` accepts the DB path from `config.dbPath` which is environment-variable driven (`DB_PATH`). Tests override this to use `:memory:` or temp file databases.
- **`packages/backend/src/services/jwt.ts`**: `generateAccessToken()` creates valid JWTs — test helpers reuse this to create authenticated test requests.
- **`packages/backend/src/utils/errors.ts`**: Error class hierarchy is small and self-contained — directly testable.
- **`packages/backend/src/services/console-buffer.ts`**: `ConsoleBuffer` class is pure (no external dependencies beyond `Date`) — directly testable.
- **`packages/backend/src/routes/validation.ts`**: Zod schemas are exported and can be tested independently of routes.
- **`shared/src/index.ts`**: Pure utility functions (`compareMcVersions`, `getMinJavaForMcVersion`, `getJavaMajorVersion`, `checkJavaMcCompat`) have zero dependencies — trivially testable.

### Integration Points

- **Backend test setup** must call `initDatabase()` with a `:memory:` SQLite database and run all migrations before route tests. The `config` module reads `DB_PATH` from environment — tests set `process.env.DB_PATH = ':memory:'` before importing config.
- **Auth middleware** (`requireAuth`) checks `isMultiUserMode()` which calls `countUsers()`. In single-user mode (no users in DB), auth is skipped. Tests for authenticated endpoints must first insert a user into the test database.
- **Frontend tests** must mock the `@/api/client` module and `@/api/ws` module to prevent real HTTP/WebSocket connections.

### Shared Types Already Available

- `ServerWithStatus`, `Server`, `ServerStatus`, `ServerType` — for mock data factories
- `CreateServerRequest`, `UpdateServerRequest` — for API request test payloads
- `WsMessage`, `WsSubscribe`, `WsCommand` — for WebSocket protocol testing (future)
- `UserRole`, `JWTPayload` — for auth test helpers

## Architecture

```
vitest.workspace.ts                    (root: orchestrates all packages)
     |
     +-- shared/vitest.config.ts       (env: node, tests: utility functions)
     |
     +-- packages/backend/vitest.config.ts  (env: node, tests: HTTP integration + unit)
     |       |
     |       +-- src/test-utils/
     |       |     +-- db.ts           (in-memory SQLite setup/teardown)
     |       |     +-- auth.ts         (JWT token generation for tests)
     |       |     +-- factories.ts    (mock data factories)
     |       |
     |       +-- src/**/*.test.ts      (co-located test files)
     |
     +-- packages/frontend/vitest.config.ts (env: happy-dom, tests: components + stores)
             |
             +-- src/test-utils/
             |     +-- setup.ts        (Testing Library cleanup, jest-dom matchers)
             |     +-- render.ts       (custom render with providers)
             |     +-- factories.ts    (mock ServerWithStatus, etc.)
             |
             +-- src/**/*.test.ts(x)   (co-located test files)
```

### Design Principles Applied

- **Single File Responsibility**: Each test file tests one module. Test utilities are organized by concern (db, auth, factories).
- **Transport Separation**: Backend integration tests exercise the HTTP layer via supertest; backend unit tests exercise services/utilities directly. They are separate test files.
- **No Application Code Changes**: This spec adds only test infrastructure and test files. Zero changes to existing application source code. No DI refactoring required.

## Components and Interfaces

### Component 1: Root Vitest Workspace (`vitest.workspace.ts`)

- **Purpose**: Orchestrate test runs across all packages from a single command.
- **Interface**:
  ```typescript
  import { defineWorkspace } from 'vitest/config'

  export default defineWorkspace([
    'shared/vitest.config.ts',
    'packages/backend/vitest.config.ts',
    'packages/frontend/vitest.config.ts',
  ])
  ```
- **Dependencies**: `vitest`
- **Reuses**: Nothing — new file at project root.

### Component 2: Shared Package Test Config (`shared/vitest.config.ts`)

- **Purpose**: Configure Vitest for the shared types package (Node environment).
- **Interface**:
  ```typescript
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    test: {
      name: 'shared',
      environment: 'node',
      globals: true,
      include: ['src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
      },
    },
  })
  ```
- **Dependencies**: `vitest`
- **Reuses**: Nothing — new file.

### Component 3: Backend Test Config (`packages/backend/vitest.config.ts`)

- **Purpose**: Configure Vitest for backend (Node environment, setup file for DB).
- **Interface**:
  ```typescript
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      globals: true,
      setupFiles: ['./src/test-utils/setup.ts'],
      include: ['src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.test.ts',
          'src/test-utils/**',
        ],
      },
    },
  })
  ```
- **Dependencies**: `vitest`, `supertest`, `@types/supertest`
- **Reuses**: Nothing — new file.

### Component 4: Backend Test Setup (`packages/backend/src/test-utils/setup.ts`)

- **Purpose**: Global test setup — set environment variables before any module loads, silence logger.
- **Interface**:
  ```typescript
  // Set env vars BEFORE any app modules are imported
  process.env.DB_PATH = ':memory:'
  process.env.LOG_LEVEL = 'silent'
  process.env.MC_MIGRATIONS_DIR = new URL('../../migrations', import.meta.url).pathname
  ```
- **Dependencies**: None (runs before test files)
- **Reuses**: Environment variable conventions from `packages/backend/src/config.ts`

### Component 5: Backend DB Test Helper (`packages/backend/src/test-utils/db.ts`)

- **Purpose**: Initialize and tear down an in-memory SQLite database for each test suite.
- **Interface**:
  ```typescript
  import { initDatabase, closeDatabase, getDb } from '../services/database.js'

  /**
   * Initialize a fresh in-memory database with all migrations.
   * Call in beforeAll() or beforeEach().
   */
  export function setupTestDb(): void

  /**
   * Close the test database connection.
   * Call in afterAll() or afterEach().
   */
  export function teardownTestDb(): void

  /**
   * Get the test database instance (convenience re-export).
   */
  export { getDb } from '../services/database.js'
  ```
- **Dependencies**: `../services/database.js`
- **Reuses**: Existing `initDatabase()` / `closeDatabase()` functions directly.

### Component 6: Backend Auth Test Helper (`packages/backend/src/test-utils/auth.ts`)

- **Purpose**: Create test users and generate JWT tokens for authenticated supertest requests.
- **Interface**:
  ```typescript
  import type { UserRole } from '@mc-server-manager/shared'

  interface TestUser {
    id: string
    username: string
    role: UserRole
    token: string
  }

  /**
   * Create a user in the test DB and return user info + valid JWT.
   * Requires setupTestDb() to have been called first.
   */
  export function createTestUser(overrides?: {
    username?: string
    role?: UserRole
  }): TestUser

  /**
   * Create an owner user (convenience wrapper).
   */
  export function createTestOwner(): TestUser
  ```
- **Dependencies**: `../services/jwt.js`, `../models/user.js`, `nanoid`
- **Reuses**: Existing `generateAccessToken()` from `services/jwt.ts`, existing `createUser()` from `models/user.ts`.

### Component 7: Backend Mock Data Factories (`packages/backend/src/test-utils/factories.ts`)

- **Purpose**: Generate valid test data for servers and other entities.
- **Interface**:
  ```typescript
  import type { CreateServerRequest } from '@mc-server-manager/shared'

  /**
   * Build a valid CreateServerRequest with sensible defaults.
   * All fields can be overridden.
   */
  export function buildCreateServerRequest(
    overrides?: Partial<CreateServerRequest>
  ): CreateServerRequest
  ```
- **Dependencies**: `@mc-server-manager/shared`
- **Reuses**: Shared type definitions.

### Component 8: Frontend Test Config (`packages/frontend/vitest.config.ts`)

- **Purpose**: Configure Vitest for frontend (happy-dom, React plugin, path aliases).
- **Interface**:
  ```typescript
  import { defineConfig } from 'vitest/config'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    test: {
      name: 'frontend',
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./src/test-utils/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test-utils/**',
          'src/main.tsx',
          'src/vite-env.d.ts',
        ],
      },
    },
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  })
  ```
- **Dependencies**: `vitest`, `happy-dom`, `@vitejs/plugin-react` (already installed)
- **Reuses**: Path alias config from existing `vite.config.ts`.

### Component 9: Frontend Test Setup (`packages/frontend/src/test-utils/setup.ts`)

- **Purpose**: Register Testing Library jest-dom matchers and automatic cleanup.
- **Interface**:
  ```typescript
  import '@testing-library/jest-dom/vitest'
  import { cleanup } from '@testing-library/react'
  import { afterEach } from 'vitest'

  afterEach(() => {
    cleanup()
  })
  ```
- **Dependencies**: `@testing-library/jest-dom`, `@testing-library/react`
- **Reuses**: Nothing — standard Testing Library setup.

### Component 10: Frontend Custom Render (`packages/frontend/src/test-utils/render.ts`)

- **Purpose**: Wrap components with required providers (MemoryRouter) for testing.
- **Interface**:
  ```typescript
  import type { RenderOptions } from '@testing-library/react'
  import type { ReactElement } from 'react'

  interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
    initialRoute?: string
  }

  /**
   * Render with MemoryRouter wrapper.
   * Use instead of bare `render()` when component uses React Router.
   */
  export function renderWithRouter(
    ui: ReactElement,
    options?: CustomRenderOptions
  ): ReturnType<typeof import('@testing-library/react').render>
  ```
- **Dependencies**: `@testing-library/react`, `react-router`
- **Reuses**: Existing React Router setup pattern from `App.tsx`.

### Component 11: Frontend Mock Data Factories (`packages/frontend/src/test-utils/factories.ts`)

- **Purpose**: Generate valid mock data for frontend components.
- **Interface**:
  ```typescript
  import type { ServerWithStatus, Server } from '@mc-server-manager/shared'

  /**
   * Build a ServerWithStatus object with sensible defaults.
   * All fields can be overridden via the overrides parameter.
   */
  export function buildServer(
    overrides?: Partial<ServerWithStatus>
  ): ServerWithStatus

  /**
   * Build an array of servers with sequential names.
   */
  export function buildServerList(count: number): ServerWithStatus[]
  ```
- **Dependencies**: `@mc-server-manager/shared`
- **Reuses**: Shared type definitions.

## Data Models

No new data models. This spec adds only test infrastructure — no database schema changes.

## API Endpoints

No new API endpoints. This spec tests existing endpoints, it does not create new ones.

## WebSocket Events

No new WebSocket events. WebSocket testing is not in scope for this initial spec.

## Error Handling

### Error Scenarios

1. **Test database initialization failure**
   - **Handling**: `setupTestDb()` throws if migrations fail. Test suite aborts with a clear error indicating which migration failed.
   - **User Impact**: Developer sees a migration error in test output and can fix the SQL.

2. **Missing environment variable in test setup**
   - **Handling**: `setup.ts` sets all required env vars (`DB_PATH`, `LOG_LEVEL`, `MC_MIGRATIONS_DIR`) before any imports. If setup file fails to load, Vitest reports the setup error with file path.
   - **User Impact**: Clear error pointing to setup file.

## Verification Strategy

### Build Verification

- `npm run build` must pass with zero errors after implementation (test files are excluded from `tsc` compilation by the `include` patterns in each `tsconfig.json`).
- `npm test` must pass with zero errors — this is the primary verification.

### Manual Testing Checklist

1. `npm test` from project root -> all packages' tests run, all pass
2. `npm test -w @mc-server-manager/shared` -> only shared tests run
3. `npm run test -w @mc-server-manager/backend` -> only backend tests run
4. `npm run test -w @mc-server-manager/frontend` -> only frontend tests run
5. `npm run test:coverage` -> coverage report generated with HTML output
6. Modify a shared utility function to return wrong result -> `npm test` fails with clear message
7. Modify a backend route response shape -> integration test fails
8. Modify a component's rendered text -> component test fails

## Implementation Order

1. **Root config + shared package tests** — Foundation. No dependencies. Proves Vitest works in the monorepo. Delivers immediate value (shared utility tests).
2. **Backend test infrastructure** — Config, setup file, DB helper, auth helper, data factories. Depends on (1) for root workspace config.
3. **Backend unit tests** — ConsoleBuffer, error classes, Zod schemas, properties parser. Depends on (2) for test infrastructure.
4. **Backend integration tests** — Supertest route tests for core server CRUD. Depends on (2) for DB/auth helpers.
5. **Frontend test infrastructure** — Config, setup file, custom render, data factories. Depends on (1) for root workspace config.
6. **Frontend unit tests** — Zustand store tests. Depends on (5) for test infrastructure.
7. **Frontend component tests** — StatusBadge, ServerCard. Depends on (5) for setup + factories.
8. **Root scripts + verification** — Add `test`, `test:watch`, `test:coverage` scripts to root and per-package `package.json`. Verify everything works end-to-end. Depends on all previous steps.

Each step can be verified independently before proceeding to the next.
