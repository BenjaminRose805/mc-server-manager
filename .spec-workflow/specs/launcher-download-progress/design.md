# Design Document

## Overview

This feature converts the game instance preparation flow from a single blocking HTTP request into an async job-based system that mirrors the existing server JAR download architecture. The `POST /api/launcher/prepare/:id` endpoint currently downloads the version JSON, client JAR, ~50 libraries, and ~2000 assets synchronously before returning — with no progress feedback. The new design introduces a `PrepareJob` stored in memory (same as `DownloadJob`), a polling endpoint, cancellation via `AbortController`, and one-per-instance guards. The frontend's existing `DownloadProgress` component receives real data instead of hardcoded zeroes.

The scope also includes removing dead code: the unused `DownloadProgressInfo` type in shared, and the hardcoded indeterminate props in `InstanceDetail.tsx`.

## Steering Document Alignment

Per `product.md`: This supports the "real-time by default" principle — long-running operations must give users visibility. Per `tech.md`: The async job pattern with in-memory storage and polling already exists for server downloads; this reuses that pattern rather than inventing a new one. Per `structure.md`: New backend code goes in `services/` and `routes/`, following the `Routes → Services → File I/O` layering. No new database tables needed (jobs are ephemeral, same as `DownloadJob`).

## Code Reuse Analysis

### Existing Code to Leverage

- **`packages/backend/src/services/download.ts`**: The in-memory job store pattern (`Map<jobId, Job>`), one-per-entity guard (`Map<entityId, jobId>`), `AbortController` map, TTL cleanup, and fire-and-forget async pattern. This is the template for the new prepare service.
- **`packages/backend/src/services/version-service.ts`**: `downloadVersionJson()` and `downloadGameJar()` — already work correctly, just need an `AbortSignal` threaded through their `fetch()` calls.
- **`packages/backend/src/services/asset-service.ts`**: `downloadAssets(versionJson, onProgress?)` — already accepts an `onProgress` callback, just never wired up.
- **`packages/backend/src/services/library-service.ts`**: `downloadLibraries(versionJson, onProgress?)` — same, already has the callback.
- **`packages/backend/src/routes/downloads.ts`**: Route structure (POST to start, GET to poll, DELETE to cancel) — will mirror this exactly for prepare jobs.
- **`packages/frontend/src/pages/CreateServer.tsx` (lines 1110-1208)**: The `setInterval`-based polling loop with `downloadJobIdRef`, `pollRef`, cleanup on unmount, and cancel handler. This is the exact frontend pattern to replicate in `InstanceDetail.tsx`.
- **`packages/frontend/src/components/launcher/DownloadProgress.tsx`**: Already has the UI for phase labels, progress bar, cancel button, and indeterminate state. Just needs real props.
- **`packages/frontend/src/api/client.ts`**: `startDownload()` and `getDownloadStatus()` methods show the pattern for adding `startPrepare()` and `getPrepareStatus()`.

### Integration Points

- **`packages/backend/src/routes/launcher.ts`**: The existing `POST /prepare/:id` handler (lines 126-156) will be replaced with the async job kickoff.
- **`packages/backend/src/app.ts`**: Route mounting — new prepare routes will be added to the existing launcher router (no new router needed).
- **`packages/frontend/src/pages/InstanceDetail.tsx`**: The `handleLaunch` function (line 500) will change from `await api.prepareLaunch(id)` to the start-then-poll pattern.
- **`packages/electron/src/launcher.ts`**: The `launchGame()` function calls `POST /api/launcher/prepare/:id` directly. With the new async flow, Electron will call the frontend's HTTP API (which polls), or the Electron launcher will need to poll the prepare job itself. Since the frontend already handles preparation before calling `window.electronAPI.launchGame()`, the Electron side just receives the `PrepareResponse` data and spawns the game — **no Electron changes needed**.

### Shared Types Already Available

- `DownloadJob`, `DownloadJobStatus` — conceptual reference but these are server-specific. We'll create a parallel `PrepareJob` / `PrepareJobStatus` type.
- `PrepareResponse` — already exists, will be embedded in the completed job.
- `DownloadProgressInfo` — exists but is dead code. Will be removed.
- `LauncherInstance` — used to look up instance details.

## Architecture

```
Frontend (InstanceDetail.tsx)                    Backend (launcher routes)
─────────────────────────────────────           ──────────────────────────────
                                                
1. User clicks "Play"                           
   POST /api/launcher/prepare/:id ───────────►  Create PrepareJob (in-memory)
   ◄──── 202 { id, status: "pending" }          Fire async runPrepare()
                                                   ├── VersionService.downloadVersionJson()
2. Poll loop (500ms interval)                      ├── VersionService.downloadGameJar()
   GET /api/launcher/prepare/jobs/:jobId ────►     ├── LibraryService.downloadLibraries(onProgress)
   ◄──── { status, phase, current, total }         └── AssetService.downloadAssets(onProgress)
                                                        (updates job object in-place)
3. Job completes                                
   GET returns { status: "completed",           
     result: PrepareResponse }                  
   → Dismiss overlay                            
   → Call electronAPI.launchGame()              
                                                
4. (Optional) User cancels                      
   DELETE /api/launcher/prepare/jobs/:jobId ──►  AbortController.abort()
   → Job marked failed, user can retry          
```

### Design Principles Applied

- **Single File Responsibility**: `prepare-service.ts` handles job lifecycle; route handler is thin; frontend polling logic stays in `InstanceDetail.tsx`.
- **Transport Separation**: All download orchestration lives in the service. Routes only validate and delegate. No business logic in route handlers.
- **Pattern Reuse Over Invention**: Every pattern (job map, abort map, guard map, polling, TTL cleanup) is copied from the existing server download system, not reinvented.

## Components and Interfaces

### Component 1: Shared Types (`shared/src/index.ts`)

- **Purpose**: Define the `PrepareJob` type that both backend and frontend use.
- **Interfaces**:
  ```typescript
  export type PreparePhase =
    | "pending"
    | "version"        // downloading version JSON + client JAR
    | "libraries"      // downloading library JARs
    | "assets"         // downloading asset objects
    | "completed"
    | "failed";

  export interface PrepareJob {
    id: string;
    instanceId: string;
    mcVersion: string;
    phase: PreparePhase;
    /** 0-100 overall progress across all phases */
    progress: number;
    /** Current item count within the active phase (e.g., 45 of 200 libraries) */
    phaseCurrent: number;
    /** Total item count within the active phase */
    phaseTotal: number;
    /** The prepare result, populated on completion */
    result: PrepareResponse | null;
    error?: string;
    createdAt: number;
  }
  ```
- **Changes**: Also remove `DownloadProgressInfo` interface (dead code).
- **Dependencies**: `PrepareResponse` (already exists in shared)
- **Reuses**: Modeled after `DownloadJob` but with phase-based tracking instead of byte-based.

### Component 2: Prepare Service (`packages/backend/src/services/prepare-service.ts`)

- **Purpose**: Manages prepare job lifecycle — creation, execution, progress tracking, cancellation, cleanup.
- **Interfaces**:
  ```typescript
  /** Get a prepare job by ID */
  export function getPrepareJob(jobId: string): PrepareJob | undefined;

  /** Start an async prepare job for an instance. Returns the job immediately. */
  export function startPrepare(instanceId: string, mcVersion: string): PrepareJob;

  /** Cancel an in-progress prepare job. Returns true if cancelled. */
  export function cancelPrepare(jobId: string): boolean;

  /** Clean up completed/failed jobs older than TTL. */
  export function cleanupOldPrepareJobs(): void;
  ```
- **Internal state** (mirrors `download.ts`):
  ```typescript
  const jobs = new Map<string, PrepareJob>();
  const activeInstancePrepares = new Map<string, string>(); // instanceId -> jobId
  const abortControllers = new Map<string, AbortController>(); // jobId -> controller
  const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
  ```
- **`runPrepare()` internal function** orchestrates the phases:
  1. Set phase to `"version"`, call `versionService.downloadVersionJson()` and `versionService.downloadGameJar()`.
  2. Set phase to `"libraries"`, call `libraryService.downloadLibraries(versionJson, onProgress)` where `onProgress` updates `job.phaseCurrent`/`job.phaseTotal` and recalculates `job.progress`.
  3. Set phase to `"assets"`, call `assetService.downloadAssets(versionJson, onProgress)` with same pattern.
  4. Build the `PrepareResponse` object, set `job.result`, set phase to `"completed"`.
  - On error: set phase to `"failed"`, record `job.error`.
  - On abort: set phase to `"failed"`, set `job.error = "Cancelled"`.
- **Progress calculation**: Overall progress is weighted: version phase = 5%, libraries = 25%, assets = 70% (assets are the bulk). Within each phase, linear by item count.
- **Dependencies**: `VersionService`, `AssetService`, `LibraryService` (existing instances from the launcher router), `nanoid`, `logger`.
- **Reuses**: Exact same job map / abort / guard / TTL pattern from `download.ts`.

### Component 3: AbortSignal Threading in Download Services

- **Purpose**: Allow `fetch()` calls in `VersionService`, `AssetService`, and `LibraryService` to be cancelled.
- **Changes**:
  - `VersionService.downloadVersionJson(versionId, signal?)` — pass `signal` to `fetch()` calls.
  - `VersionService.downloadGameJar(versionId, signal?)` — pass `signal` to `fetch()`.
  - `AssetService.downloadAssets(versionJson, onProgress?, signal?)` — pass `signal` to `fetch()` in `downloadAsset()`.
  - `LibraryService.downloadLibraries(versionJson, onProgress?, signal?)` — pass `signal` to `fetch()` in `downloadArtifact()`.
- **All parameters are optional** — existing callers (if any besides the prepare route) continue to work without changes.
- **Dependencies**: None new. Just adding an optional `AbortSignal` parameter.

### Component 4: Launcher Route Updates (`packages/backend/src/routes/launcher.ts`)

- **Purpose**: Replace the blocking `POST /prepare/:id` with async job endpoints.
- **Changes to existing routes**:
  - `POST /prepare/:id` → Now returns `202 { PrepareJob }` instead of blocking until completion.
- **New route**:
  - `GET /prepare/jobs/:jobId` → Returns `PrepareJob` (poll for progress).
  - `DELETE /prepare/jobs/:jobId` → Cancels a prepare job.
- **Interfaces**:
  ```typescript
  // POST /api/launcher/prepare/:id — Start async prepare
  // Response: 202 PrepareJob

  // GET /api/launcher/prepare/jobs/:jobId — Poll progress
  // Response: 200 PrepareJob

  // DELETE /api/launcher/prepare/jobs/:jobId — Cancel
  // Response: 200 { message: string, jobId: string }
  ```
- **Dependencies**: `prepare-service.ts`, `instance-service.ts` (existing), error classes.
- **Reuses**: Exact same route structure as `routes/downloads.ts`.

### Component 5: Frontend API Client (`packages/frontend/src/api/client.ts`)

- **Purpose**: Add methods for the new prepare job endpoints.
- **Changes**:
  ```typescript
  // Modify existing:
  prepareLaunch(instanceId: string): Promise<PrepareJob> {
    // Now returns a PrepareJob instead of PrepareResponse
    return request<PrepareJob>(`/api/launcher/prepare/${instanceId}`, { method: 'POST' });
  }

  // Add new:
  getPrepareStatus(jobId: string): Promise<PrepareJob> {
    return request<PrepareJob>(`/api/launcher/prepare/jobs/${jobId}`);
  }

  cancelPrepare(jobId: string): Promise<void> {
    return request(`/api/launcher/prepare/jobs/${jobId}`, { method: 'DELETE' });
  }
  ```
- **Dependencies**: Existing `request` helper.
- **Reuses**: Same pattern as `startDownload()` / `getDownloadStatus()` / `cancelDownload()`.

### Component 6: InstanceDetail Polling Logic (`packages/frontend/src/pages/InstanceDetail.tsx`)

- **Purpose**: Replace the `await api.prepareLaunch(id)` call with start + poll + cancel flow.
- **Changes to `handleLaunch()`**:
  1. Call `api.prepareLaunch(id)` → receives `PrepareJob` with `id`.
  2. Store `jobId` in a ref.
  3. Start `setInterval` polling (500ms) on `api.getPrepareStatus(jobId)`.
  4. Update `DownloadProgress` props from the polled job data.
  5. On `phase === "completed"`: clear interval, extract `job.result` (the `PrepareResponse`), proceed to launch.
  6. On `phase === "failed"`: clear interval, show error toast.
- **Cancel handler**: Call `api.cancelPrepare(jobId)`, clear interval, reset state.
- **Reuses**: Exact same pattern as `CreateServer.tsx` lines 1110-1208.

### Component 7: DownloadProgress Wiring (`packages/frontend/src/components/launcher/DownloadProgress.tsx`)

- **Purpose**: The component already works. Just needs the right props from `InstanceDetail.tsx`.
- **Changes**: None to the component itself. The `InstanceDetail.tsx` will now pass real values:
  ```typescript
  <DownloadProgress
    visible={preparing}
    progress={{
      phase: mapPreparePhaseToDisplayPhase(job.phase),
      current: job.phaseCurrent,
      total: job.phaseTotal,
    }}
    onCancel={handleCancel}
  />
  ```
- **Phase mapping**: `PreparePhase` → `DownloadProgress` phase: `"version"` → `"version"`, `"libraries"` → `"libraries"`, `"assets"` → `"assets"`. The pending/completed/failed states don't need mapping since the overlay is hidden for those.

### Component 8: Dead Code Removal

- **`shared/src/index.ts`**: Remove the `DownloadProgressInfo` interface (lines ~890-895). Verify no remaining references.
- **`packages/frontend/src/pages/InstanceDetail.tsx`**: Remove the hardcoded `{ phase: "version", current: 0, total: 0 }` prop (replaced by real data in Component 6).

## Data Models

No new database tables. Prepare jobs are ephemeral in-memory objects (same as `DownloadJob`). They don't survive backend restarts — this is acceptable because cached files persist on disk and a retry is fast.

## API Endpoints

| Method | Path | Auth | Request Body | Response | Purpose |
|--------|------|------|--------------|----------|---------|
| POST | `/api/launcher/prepare/:id` | inherit | - | `202 PrepareJob` | Start async prepare (changed from blocking) |
| GET | `/api/launcher/prepare/jobs/:jobId` | inherit | - | `200 PrepareJob` | Poll prepare progress (new) |
| DELETE | `/api/launcher/prepare/jobs/:jobId` | inherit | - | `200 { message, jobId }` | Cancel prepare (new) |

## WebSocket Events

No new WebSocket events. Progress is delivered via HTTP polling (matching the existing server download pattern). WebSocket could be added later as an optimization but is out of scope — polling at 500ms is adequate for a progress bar.

## Error Handling

### Error Scenarios

1. **Instance not found**
   - **Error Class**: `NotFoundError`
   - **Handling**: `POST /prepare/:id` returns 404 if instance ID doesn't exist.
   - **User Impact**: Toast "Instance not found".

2. **Duplicate prepare (job already active)**
   - **Error Class**: `ConflictError`
   - **Handling**: `POST /prepare/:id` returns 409 if a prepare job is already active for this instance.
   - **User Impact**: Toast "A download is already in progress for this instance".

3. **Prepare job not found (polling)**
   - **Error Class**: `NotFoundError`
   - **Handling**: `GET /prepare/jobs/:jobId` returns 404. Frontend stops polling.
   - **User Impact**: Toast "Prepare job not found" (edge case — job TTL expired or backend restarted).

4. **Download failure (network error, hash mismatch)**
   - **Error Class**: None (caught internally by `runPrepare`)
   - **Handling**: Job status set to `"failed"` with error message. Frontend detects on next poll.
   - **User Impact**: Progress overlay dismissed, toast with error message.

5. **Cancellation**
   - **Error Class**: None
   - **Handling**: `AbortController.abort()` propagates to all `fetch()` calls. Job marked `"failed"` with `"Cancelled"`.
   - **User Impact**: Overlay dismissed, user can retry immediately.

6. **Cancel request on non-active job**
   - **Error Class**: `AppError` (409)
   - **Handling**: `DELETE /prepare/jobs/:jobId` returns 409 if job is already completed/failed.
   - **User Impact**: No-op (frontend shouldn't show cancel button for completed jobs).

## Verification Strategy

### Build Verification

- `npm run build` must pass with zero errors after implementation.
- `npm run build -w shared` must pass (type changes).
- No TypeScript errors in changed files (verify via `lsp_diagnostics`).

### Manual Testing Checklist

1. **First launch of new version** (no cached files): Click Play → progress overlay appears with "Downloading version", then "Downloading libraries (X/Y)", then "Downloading assets (X/Y)" → game launches (Electron) or "requires desktop app" message (browser). Progress bar should advance steadily.
2. **Second launch of same version** (all cached): Click Play → progress overlay appears briefly (seconds), all phases complete quickly → game launches.
3. **Cancel mid-download**: Click Play → wait for assets phase → click Cancel → overlay dismisses, toast shows "Cancelled" → click Play again → new job starts, progress resumes from where cached files left off.
4. **Double-click Play**: Click Play twice rapidly → first click starts job, second click gets 409 conflict toast.
5. **Backend restart during prepare**: Start a prepare → restart backend → frontend polling gets 404 → toast error → user retries successfully.

### Parity / Migration Checks

| Existing Behavior | New Implementation | Verify |
|---|---|---|
| `POST /prepare/:id` blocks until done, returns `PrepareResponse` | `POST /prepare/:id` returns `PrepareJob` immediately; `PrepareResponse` is in `job.result` on completion | Frontend extracts `job.result` after polling shows `completed` |
| `DownloadProgress` shows indeterminate spinner | `DownloadProgress` shows real phase/count/percentage | Visual inspection during first-launch download |
| No cancel button wired | Cancel button calls `DELETE /prepare/jobs/:jobId` | Click cancel, verify job stops and overlay dismisses |
| No concurrency guard | `ConflictError` on duplicate prepare | Double-click Play, verify 409 toast |

## Implementation Order

1. **Shared types** — Add `PreparePhase` and `PrepareJob` to `shared/src/index.ts`. Remove `DownloadProgressInfo`. No dependencies.
2. **AbortSignal threading** — Add optional `signal` parameter to `VersionService`, `AssetService`, `LibraryService` fetch calls. No dependencies beyond (1) for types.
3. **Prepare service** — Create `prepare-service.ts` with job lifecycle, progress wiring, cancellation. Depends on (1) for types and (2) for signal support.
4. **Route updates** — Modify `POST /prepare/:id` and add `GET/DELETE /prepare/jobs/:jobId`. Depends on (3).
5. **Frontend API + polling** — Update `client.ts` methods, rewrite `InstanceDetail.tsx` `handleLaunch` with polling loop, wire real props to `DownloadProgress`. Depends on (1) for types and (4) for API.
6. **Dead code cleanup + verification** — Remove `DownloadProgressInfo`, remove hardcoded props, verify build passes. Depends on all previous steps.

Each step can be verified independently (`npm run build -w <package>` + `lsp_diagnostics`) before proceeding.

## Migration / Backward Compatibility

The `POST /api/launcher/prepare/:id` endpoint changes its response contract from `PrepareResponse` (synchronous) to `PrepareJob` (async, 202). This is a **breaking change** to this endpoint.

**Impact assessment:**
- The only consumer of this endpoint is `packages/electron/src/launcher.ts` (`fetchJson<PrepareResponse>(...)`), called via `packages/frontend/src/pages/InstanceDetail.tsx` which calls `api.prepareLaunch(id)`.
- The Electron launcher's `launchGame()` function calls `POST /api/launcher/prepare/:id` directly. However, looking at the actual flow: the frontend calls `api.prepareLaunch(id)` first, THEN calls `window.electronAPI.launchGame(id, accountId)`. The Electron `launchGame()` also calls prepare internally.
- **Solution**: The Electron `launchGame()` function needs to be updated. Since the frontend now handles preparation (start job → poll → get result), the Electron launcher should accept the `PrepareResponse` data instead of calling prepare itself. This avoids the Electron side needing its own polling logic. The `launchGame()` IPC signature changes to accept the prepare result directly.
- This is an internal API — no external consumers.
