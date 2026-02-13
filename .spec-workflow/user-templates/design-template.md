# Design Document

<!--
  MC Server Manager -- Design Template
  
  Guidelines for the AI generating the design:
  
  This project is a monorepo (npm workspaces) with four packages:
    packages/backend/   -- Express + ws API server (Node.js, SQLite)
    packages/frontend/  -- React SPA (Vite, Zustand, Tailwind CSS)
    packages/electron/  -- Electron desktop wrapper (IPC, auth, launcher)
    shared/             -- TypeScript types shared by all packages
  
  Core architecture pattern:
    Routes (HTTP) --> Services (business logic) --> Models (SQLite)
    WebSocket Server --> Same services, different transport
  
  When writing this design, you MUST:
  - Read existing code in the areas you're designing for
  - Reference specific existing files, functions, and patterns to reuse
  - Show exact TypeScript interfaces for new components
  - Define the implementation order and dependency graph
  - Address error handling with the project's existing error classes
-->

## Overview

[High-level description of the feature. What it does, why it exists, and where it fits in the MC Server Manager architecture. 2-3 paragraphs max.]

## Steering Document Alignment

<!--
  If .spec-workflow/steering/ exists, reference product.md, tech.md, structure.md.
  If no steering docs exist, replace this section with:
  "No steering docs exist. This design follows conventions from AGENTS.md and the existing codebase."
  Then briefly note how the design follows:
  - TypeScript strict mode, ES modules with .js extensions in backend
  - Express services as singletons, Zustand for frontend state
  - Zod for validation, Pino for logging, better-sqlite3 for persistence
  - contextBridge + contextIsolation for Electron IPC
  - File placement follows existing package structure
-->

[Steering doc alignment OR codebase convention alignment]

## Code Reuse Analysis

<!--
  This is critical. The implementing agents will use this section to understand
  what already exists and should NOT be rebuilt. Be specific with file paths.
-->

### Existing Code to Leverage

- **[File path]**: [What it provides and how to use/extend it]
- **[File path]**: [What it provides and how to use/extend it]

### Integration Points

- **[Existing system]**: [How the new feature connects to it -- which functions/endpoints/events]
- **[Existing system]**: [How the new feature connects to it]

### Shared Types Already Available

- [List any existing types in `shared/src/index.ts` that this feature will reuse]

## Architecture

[Describe the overall architecture. Where does new code live? How does data flow?]

```
[ASCII diagram or mermaid showing the data flow for this feature.
 Show which packages are involved and how they communicate.]
```

### Design Principles Applied

- **Single File Responsibility**: [How each new file handles one domain]
- **Transport Separation**: [Business logic in services, not in routes/WS handlers]
- **Minimal Surface Area**: [Preload/IPC exposes only what's needed, if Electron is involved]

## Components and Interfaces

<!--
  For each new module, show the EXACT TypeScript interface.
  The implementing agent will use these signatures directly.
-->

### Component 1: [Name] (`[exact file path]`)

- **Purpose**: [Single sentence]
- **Interfaces**:
  ```typescript
  export function functionName(param: Type): ReturnType
  export function anotherFunction(param: Type): Promise<ReturnType>
  ```
- **Dependencies**: [What it imports]
- **Reuses**: [Existing code it builds upon]

### Component 2: [Name] (`[exact file path]`)

- **Purpose**: [Single sentence]
- **Interfaces**:
  ```typescript
  export function functionName(param: Type): ReturnType
  ```
- **Dependencies**: [What it imports]
- **Reuses**: [Existing code it builds upon]

## Data Models

<!--
  Show the exact database schema (SQLite) AND the TypeScript interfaces.
  The migration task and shared types task will use these directly.
  If no new tables are needed, state "No new data models" and explain why.
-->

### [Table Name]

**SQLite Schema:**
```sql
CREATE TABLE table_name (
  id TEXT PRIMARY KEY,
  field_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_table_field ON table_name(field_name);
```

**TypeScript Interface** (in `shared/src/index.ts`):
```typescript
export interface ModelName {
  id: string
  fieldName: string
  createdAt: string
}
```

## API Endpoints

<!--
  List every new HTTP endpoint. The route tasks will implement these directly.
  If no new endpoints, state "No new API endpoints" and explain why.
-->

| Method | Path | Auth | Request Body | Response | Purpose |
|--------|------|------|--------------|----------|---------|
| GET | `/api/feature` | requireAuth | - | `Feature[]` | List all |
| POST | `/api/feature` | requireAdminOrOwner | `{ name: string }` | `Feature` | Create |
| DELETE | `/api/feature/:id` | requireAdminOrOwner | - | `void` | Delete |

## WebSocket Events

<!--
  List every new WS message type. If no real-time features, state 
  "No new WebSocket events" and explain why.
-->

### Client -> Server

| Type | Payload | Purpose |
|------|---------|---------|
| `feature:action` | `{ fieldId: string }` | [What it triggers] |

### Server -> Client

| Type | Payload | Purpose |
|------|---------|---------|
| `feature:event` | `{ data: FeatureData }` | [What it notifies] |

## Electron IPC (if applicable)

<!--
  Only include this section if the feature requires Electron main process involvement.
  If not needed, omit this section entirely.
-->

### IPC Channels

| Channel | Direction | Handler | Return Type |
|---------|-----------|---------|-------------|
| `feature-action` | renderer -> main | `module.function()` | `ReturnType` |

### Preload API Addition

```typescript
// Added to contextBridge.exposeInMainWorld('electronAPI', { ... })
featureAction: (param: string) => ipcRenderer.invoke('feature-action', param),
```

## Error Handling

<!--
  Use the project's existing error classes from packages/backend/src/utils/errors.ts:
  AppError, NotFoundError, ConflictError, ValidationError, ForbiddenError, UnauthorizedError
-->

### Error Scenarios

1. **[Scenario]**
   - **Error Class**: [NotFoundError / ConflictError / etc.]
   - **Handling**: [What the backend does]
   - **User Impact**: [What the user sees -- toast message, UI state change, etc.]

2. **[Scenario]**
   - **Error Class**: [Error class]
   - **Handling**: [What the backend does]
   - **User Impact**: [What the user sees]

## Verification Strategy

<!--
  This project has no automated test framework. Be honest about what
  verification looks like. Manual testing checklists are expected.
  If the feature is backend-only, `npm run build` may be sufficient.
-->

### Build Verification

- `npm run build` must pass with zero errors after implementation

### Manual Testing Checklist

1. [Specific user action] -> [Expected result]
2. [Specific user action] -> [Expected result]
3. [Edge case] -> [Expected behavior]

### Parity / Migration Checks (if applicable)

<!--
  Include this subsection only if replacing or migrating existing functionality.
  Omit entirely for greenfield features.
-->

| Existing Behavior | New Implementation | Verify |
|---|---|---|
| [Old function/flow] | [New function/flow] | [How to confirm parity] |

## Implementation Order

<!--
  This is mandatory. Define the build sequence with dependency rationale.
  The tasks document will follow this ordering.
-->

1. **[Component/layer]** -- [Why first: foundation, no dependencies]
2. **[Component/layer]** -- Depends on (1)
3. **[Component/layer]** -- Depends on (1), (2)
4. **[Component/layer]** -- Wires everything together
5. **[Cleanup/verification]** -- Final step

Each step can be verified independently before proceeding to the next.

## Migration / Backward Compatibility (if applicable)

<!--
  Include this section only if the feature changes existing behavior,
  replaces an existing system, or needs to coexist with legacy functionality.
  Omit entirely for purely additive features.
-->

[Describe how existing functionality is preserved during and after the migration.
 Note any backward compatibility requirements or single-user mode considerations.]
