# Tasks Document

<!--
  MC Server Manager -- Task Template
  
  Guidelines for the AI generating tasks from this template:
  
  ARCHITECTURE REFERENCE:
  - Backend: Express + ws (packages/backend/src/)
    - Routes:    packages/backend/src/routes/       (Express routers, Zod validation)
    - Services:  packages/backend/src/services/      (business logic, singletons)
    - Models:    packages/backend/src/models/         (raw SQL, prepared statements, better-sqlite3)
    - Middleware: packages/backend/src/middleware/     (Express middleware)
    - Utils:     packages/backend/src/utils/          (errors.ts, helpers)
    - Migrations: packages/backend/migrations/        (numbered .sql files)
    - Config:    packages/backend/src/config.ts
    - App:       packages/backend/src/app.ts          (Express app setup, route mounting)
    - Entry:     packages/backend/src/index.ts        (HTTP/HTTPS server, WS setup)
  
  - Frontend: React + Vite (packages/frontend/src/)
    - Pages:      packages/frontend/src/pages/        (default exports)
    - Components: packages/frontend/src/components/   (named exports)
    - Stores:     packages/frontend/src/stores/       (Zustand stores)
    - API:        packages/frontend/src/api/          (fetch wrappers, WS client)
    - Contexts:   packages/frontend/src/contexts/     (React contexts)
    - Utils:      packages/frontend/src/utils/        (helpers)
    - Types:      packages/frontend/src/types/        (ambient .d.ts)
    - App:        packages/frontend/src/App.tsx        (routing)
    - Entry:      packages/frontend/src/main.tsx       (providers, render)
  
  - Electron: packages/electron/src/
    - Main:    packages/electron/src/main.ts          (window, tray, backend lifecycle)
    - Preload: packages/electron/src/preload.ts       (contextBridge)
    - IPC:     packages/electron/src/ipc.ts           (ipcMain.handle registration)
    - Modules: packages/electron/src/auth.ts, launcher.ts, secure-storage.ts
  
  - Shared: shared/src/index.ts (all shared types, interfaces, constants)
  
  CONVENTIONS:
  - TypeScript strict mode everywhere
  - ES modules with .js extensions in backend imports
  - No default exports except React pages
  - Zod schemas for all request validation in routes
  - Raw SQL with prepared statements (no ORM)
  - snake_case in DB columns, camelCase in TypeScript
  - kebab-case file names
  - Pino for logging, sonner for frontend toasts
  - nanoid for IDs
  - No automated test framework exists -- verification is manual or via build
  
  TASK STRUCTURE RULES:
  - Number tasks sequentially: 1, 2, 3, ... (flat numbering, no nested)
  - Each task touches 1-3 files maximum
  - Order: shared types -> DB migrations -> models -> services -> routes -> frontend API -> stores -> components -> pages -> wiring/cleanup
  - Every task MUST have: Files, Purpose, _Leverage, _Requirements, _Prompt
  - The _Prompt field is the most critical part -- it's what the implementing agent receives
  
  _Prompt QUALITY CHECKLIST (every prompt must satisfy):
  [ ] Starts with "Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task:"
  [ ] Specifies a concrete Role
  [ ] Names exact file paths to read FIRST before writing
  [ ] Lists exact function signatures, type names, or component props to create
  [ ] References .js import extensions for backend code
  [ ] Mentions existing patterns to follow (with file paths)
  [ ] States specific Restrictions (what NOT to do)
  [ ] Defines measurable Success criteria
  [ ] Ends with: "Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete."
-->

- [ ] 1. Add shared types to shared package
  - Files: `shared/src/index.ts` (modify)
  - Define TypeScript interfaces and type aliases for the feature's data structures
  - Export all new types alongside existing exports
  - Purpose: Foundation types used by backend, frontend, and electron packages
  - _Leverage: `shared/src/index.ts` for existing type patterns and export style_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: TypeScript Developer | Task: Read `shared/src/index.ts` to understand existing type patterns (interfaces, type aliases, enums). Add all types from `.spec-workflow/specs/{spec-name}/design.md` Data Models section: [list each type with its fields]. Ensure all types are exported. | Restrictions: Do NOT remove or rename any existing types or exports. Do NOT add implementation code -- types only. Follow existing naming and style conventions. | Success: All types compile, all are exported, existing types unchanged, `npm run build -w shared` succeeds. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 2. Create database migration
  - Files: `packages/backend/migrations/NNN_{feature}.sql` (new)
  - Create tables with columns, constraints, indexes as defined in design
  - Purpose: Database schema for the feature
  - _Leverage: `packages/backend/migrations/` for existing migration patterns (numbering, style), `.spec-workflow/specs/{spec-name}/design.md` Data Models section_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Database Engineer with SQLite expertise | Task: Check existing migrations in `packages/backend/migrations/` to determine the next migration number. Create `NNN_{feature}.sql` with tables: [list each table with columns, types, constraints, foreign keys, indexes]. Use `DEFAULT (datetime('now'))` for timestamp defaults. All FKs use ON DELETE CASCADE unless specified otherwise. | Restrictions: Do NOT modify existing migrations. Use TEXT for IDs (nanoid). Use INTEGER for booleans (0/1). | Success: SQL is valid, all tables created with correct constraints and indexes. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 3. Create database model
  - Files: `packages/backend/src/models/{feature}.ts` (new)
  - CRUD functions using prepared statements and the project's database access pattern
  - Map snake_case DB columns to camelCase TypeScript interfaces
  - Purpose: Data access layer for the feature
  - _Leverage: Existing model files in `packages/backend/src/models/` for database access patterns (prepared statements, column mapping)_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Backend Node.js Developer | Task: Read existing model files in `packages/backend/src/models/` to understand the pattern (how they access the database, prepared statements, column mapping). Create `packages/backend/src/models/{feature}.ts` with functions: [list each function with signature]. Map snake_case DB columns to camelCase TypeScript (e.g., created_at -> createdAt). | Restrictions: Use prepared statements. Do NOT use an ORM. Follow exact pattern of existing models. Use `.js` extension in imports. | Success: All CRUD operations compile, column mapping correct. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 4. Create service (business logic)
  - Files: `packages/backend/src/services/{feature}.ts` (new)
  - Business logic layer using model functions, with validation and error handling
  - Purpose: Encapsulate business rules separate from HTTP/WS transport
  - _Leverage: Existing service files in `packages/backend/src/services/` for patterns, `packages/backend/src/utils/errors.ts` for error classes (AppError, NotFoundError, ConflictError, ForbiddenError, UnauthorizedError)_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Backend Node.js Developer | Task: Read existing service files in `packages/backend/src/services/` for patterns. Create `packages/backend/src/services/{feature}.ts`. Implement: [list each function with signature, behavior, and error cases]. Use error classes from `packages/backend/src/utils/errors.ts`. | Restrictions: Use existing error classes (NotFoundError, ConflictError, etc.). Do NOT bypass model validation. Use `.js` extension in imports. | Success: All functions compile, error cases handled, business logic encapsulated. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 5. Create API routes
  - Files: `packages/backend/src/routes/{feature}.ts` (new)
  - Express router with Zod request validation, auth middleware, error handling
  - Purpose: HTTP API endpoints for the feature
  - _Leverage: Existing route files in `packages/backend/src/routes/` for patterns (Zod schemas, try/catch/next, router setup), `packages/backend/src/middleware/auth.ts` for auth middleware_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Backend Node.js Developer with Express expertise | Task: Read existing route files in `packages/backend/src/routes/` for patterns (Zod schemas, middleware usage, error handling). Create `packages/backend/src/routes/{feature}.ts` with endpoints: [list each endpoint: method, path, auth requirement, request body/query, response shape]. Use Zod for ALL request body validation. Apply `requireAuth` middleware on all routes (add `requireAdminOrOwner` or `requireServerPermission` where needed). | Restrictions: Use Zod for ALL validation. Follow existing try/catch/next error handling pattern. Use `.js` extension in imports. | Success: All endpoints compile, Zod validates inputs, auth middleware applied. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 6. Mount routes in app.ts
  - Files: `packages/backend/src/app.ts` (modify)
  - Import and mount the new router at the appropriate path
  - Purpose: Register new routes in the Express application
  - _Leverage: Existing route mounting in `packages/backend/src/app.ts`_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Backend Node.js Developer | Task: Read `packages/backend/src/app.ts` to see how existing routes are mounted. Import the new route file and mount at `/api/{feature}`. Place after existing route mounts but before error handling middleware. | Restrictions: Do NOT modify existing route mounts. Do NOT change middleware order. Use `.js` extension in imports. | Success: New routes accessible, existing routes unaffected. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 7. Add WebSocket handlers (if real-time features needed)
  - Files: WebSocket handler files in `packages/backend/src/` (modify)
  - Add message handlers for new event types, broadcast helpers
  - Purpose: Real-time communication for the feature
  - _Leverage: Existing WS handler pattern in `packages/backend/src/`_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Backend Node.js Developer with WebSocket expertise | Task: Find the WebSocket handler files in `packages/backend/src/`. Read them to understand the current message handling pattern (switch on msg.type). Add handlers for: [list each WS message type with payload and behavior]. Add broadcast helpers if needed: [list helpers]. | Restrictions: Do NOT break existing console/server/chat WS handlers. Add new cases alongside existing ones. Use `.js` extension in imports. | Success: New WS events handled correctly, existing WS functionality preserved. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 8. Create frontend API client
  - Files: `packages/frontend/src/api/{feature}.ts` (new)
  - Fetch wrapper functions matching backend endpoints, with auth headers
  - Purpose: Frontend API layer for the feature
  - _Leverage: `packages/frontend/src/api/client.ts` for existing fetch patterns (BASE_URL, headers, error handling)_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: React Frontend Developer | Task: Read `packages/frontend/src/api/client.ts` for existing fetch wrapper patterns. Create `packages/frontend/src/api/{feature}.ts` with functions: [list each function with signature, matching the backend endpoints]. Include Authorization bearer token from the auth helper in client.ts. | Restrictions: Use the same fetch pattern as existing API client. Do NOT duplicate auth header logic. | Success: All API functions compile, match backend endpoint signatures, include auth headers. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 9. Create Zustand store (if state management needed)
  - Files: `packages/frontend/src/stores/{feature}Store.ts` (new)
  - Zustand store with state and actions for the feature
  - Purpose: Frontend state management
  - _Leverage: `packages/frontend/src/stores/serverStore.ts` for Zustand patterns_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: React Frontend Developer with Zustand expertise | Task: Read `packages/frontend/src/stores/serverStore.ts` for the Zustand store pattern (create with set/get). Create `packages/frontend/src/stores/{feature}Store.ts` with state: [list state fields with types] and actions: [list actions with behavior]. | Restrictions: Follow existing Zustand patterns exactly. Do NOT use immer or other middleware. | Success: Store compiles, actions update state correctly. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 10. Wire WebSocket events to store (if real-time features)
  - Files: `packages/frontend/src/api/ws.ts` (modify)
  - Handle new server-sent events and dispatch to Zustand store
  - Purpose: Real-time state updates from server to frontend
  - _Leverage: Existing WS event handling in `packages/frontend/src/api/ws.ts`_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: React Frontend Developer | Task: Read `packages/frontend/src/api/ws.ts` to understand the existing onmessage handler (switch on msg.type). Add new cases for: [list each event type with store dispatch]. | Restrictions: Do NOT break existing WS event handlers. Import stores at module level. | Success: All new WS events dispatched to correct stores, existing events unaffected. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 11. Create UI components
  - Files: `packages/frontend/src/components/{feature}/` (new directory)
  - Reusable components with Tailwind dark theme styling
  - Purpose: UI building blocks for the feature
  - _Leverage: Existing component patterns in `packages/frontend/src/components/`, Tailwind dark theme (slate-800/900 backgrounds, white/slate-300 text, blue-600 buttons), lucide-react for icons, sonner for toasts_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: React Frontend Developer with Tailwind expertise | Task: Read existing components in `packages/frontend/src/components/` for styling patterns (Tailwind classes, layout, dark theme colors). Create components: [list each component with props interface, behavior, and styling notes]. Use Tailwind dark theme: bg-slate-900 page background, bg-slate-800 cards/panels, slate-700 inputs/borders, blue-600 primary buttons, white/slate-300 text. Use lucide-react for icons. Use sonner for toast notifications. | Restrictions: Named exports (not default). Pure presentational where possible. Match existing app styling exactly. | Success: Components render correctly, consistent styling with app. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 12. Create page and wire up routing
  - Files: `packages/frontend/src/pages/{Feature}.tsx` (new), `packages/frontend/src/App.tsx` (modify)
  - Page component composing feature components, add route to App.tsx
  - Purpose: Main view for the feature
  - _Leverage: Existing pages in `packages/frontend/src/pages/` for layout patterns, `packages/frontend/src/App.tsx` for routing_
  - _Requirements: [list requirement IDs]_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: React Frontend Developer | Task: Read existing pages in `packages/frontend/src/pages/` for layout patterns. Read `packages/frontend/src/App.tsx` for routing setup. (1) Create `packages/frontend/src/pages/{Feature}.tsx`: [describe layout, data loading, component composition]. (2) Add route in App.tsx: `/{feature}` pointing to the new page, wrapped in ProtectedRoute. Add navigation link if app has nav/sidebar. | Restrictions: Use default export (React page convention). Wrap in ProtectedRoute if auth required. Match existing page layout patterns. | Success: Page loads data, renders components, route accessible from navigation. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

- [ ] 13. Verification and cleanup
  - Files: Various (modify as needed)
  - Run `npm run build` to verify clean compilation across all packages
  - Fix any remaining import issues or type errors
  - Purpose: Ensure everything compiles and integrates correctly
  - _Leverage: Build commands in root package.json_
  - _Requirements: All_
  - _Prompt: Implement the task for spec {spec-name}, first run spec-workflow-guide to get the workflow guide then implement the task: | Role: Senior Developer | Task: (1) Run `npm run build` from project root -- must succeed with zero errors. (2) Grep the codebase for any TODO/FIXME comments added during this spec's implementation. (3) Verify all new routes are mounted in app.ts. (4) Verify all new WS events are handled in the frontend ws.ts. (5) Check for any unused imports or dead code in new files. | Restrictions: Do NOT make functional changes -- this is verification only. If build fails, fix the specific issue (likely a missed import or type mismatch). | Success: `npm run build` passes with zero errors, no orphaned TODOs, all integrations wired. Mark task as [-] in-progress before starting, log implementation with log-implementation tool after completion, then mark [x] complete._

<!--
  NOTES FOR THE AI GENERATING TASKS:
  
  1. REMOVE tasks that don't apply (e.g., no WS tasks if feature has no real-time component,
     no Electron tasks if feature is web-only, no store if feature is stateless).
  
  2. ADD tasks for feature-specific needs not covered above (e.g., Electron IPC handlers,
     migration scripts, config changes, new middleware).
  
  3. SPLIT large tasks if a single task would touch more than 3 files or implement
     more than ~200 lines of logic. A model with 10+ functions should be its own task.
  
  4. The _Prompt field must be EXHAUSTIVE. The implementing agent has no context beyond
     what the prompt provides. Include:
     - Exact file paths to read first
     - Exact function names and signatures
     - Exact endpoint paths and HTTP methods
     - Exact Zod schema shapes
     - Exact TypeScript type names to import
     - Exact error classes to use
     - Which existing files to use as reference patterns
  
  5. Build order matters. Dependencies between tasks must be respected:
     shared types (1) -> migration (2) -> model (3) -> service (4) -> routes (5)
     -> mount (6) -> WS (7) -> frontend API (8) -> store (9) -> WS wiring (10)
     -> components (11) -> page (12) -> verify (13)
  
  6. For Electron features, insert tasks between routes and frontend API:
     - Electron module (auth/launcher/etc.)
     - IPC handler registration
     - Preload script extension
     - Frontend type declarations (.d.ts)
-->
