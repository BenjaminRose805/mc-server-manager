# Requirements Document

## Introduction

When a user clicks "Play" on a game instance, the backend's `POST /api/launcher/prepare/:id` endpoint downloads the client JAR, hundreds of library JARs, and thousands of asset files before the game can launch. Today this entire multi-gigabyte download pipeline runs as a single blocking HTTP request with **no progress feedback, no cancellation, and no concurrency guard**. The frontend shows a hardcoded indeterminate spinner (`DownloadProgress` component rendered with `{ phase: "version", current: 0, total: 0 }`).

Meanwhile, the server JAR download system (`POST /api/downloads` + `GET /api/downloads/:jobId`) already implements a proper async job pattern with progress tracking, polling, cancellation via `AbortController`, one-per-entity guards, and TTL-based cleanup. The backend's `AssetService` and `LibraryService` already accept `onProgress` callbacks that are simply never wired up in the route handler.

This spec converts the launcher prepare flow to use the same async job pattern as server downloads, wires up the existing progress callbacks, exposes real progress to the frontend via polling (matching the existing server download UX), adds cancellation support, and cleans up the dead/vestigial code left over from the current half-implemented state.

## Alignment with Project Direction

This feature aligns with the product principle of **"real-time by default"** -- users should always have visibility into long-running operations. It also supports the **"things just work"** expectation by providing cancellation (so users aren't stuck waiting) and concurrency guards (so double-clicks don't corrupt state). The launcher is a core part of the desktop app experience (Epic 3), and first-launch UX -- where every file must be downloaded -- is currently the worst user-facing gap.

This also improves code quality by removing dead code paths and unifying the download architecture. Both server setup and game preparation use the same conceptual operation (download files from Mojang/mirrors with progress), and they should share the same job pattern rather than having two divergent implementations.

### Dependencies

- **Depends on**: None -- the server download job system and launcher services already exist
- **Depended on by**: Mod Sync spec (which needs to prepare game instances before syncing mods)

---

## Requirements

### REQ-1: Async Prepare Job with Progress

**User Story:** As a player, I want to see real download progress (phase, file count, percentage) when preparing a game instance, so that I know what's happening and how long it will take.

#### Acceptance Criteria

1. WHEN the user initiates a game launch (prepare) THEN the system SHALL create an async prepare job and return a job ID immediately (HTTP 202), rather than blocking until all downloads complete.
2. WHEN a prepare job is active THEN the system SHALL expose its progress via a polling endpoint (analogous to `GET /api/downloads/:jobId`), reporting: status (`pending`, `downloading:version`, `downloading:libraries`, `downloading:assets`, `completed`, `failed`), current/total counts for the active phase, and overall percentage.
3. WHEN libraries or assets are being downloaded THEN the system SHALL use the existing `onProgress` callbacks on `LibraryService.downloadLibraries()` and `AssetService.downloadAssets()` to update the job's progress in real time.
4. WHEN a prepare job completes successfully THEN the system SHALL return the same `PrepareResponse` data (classpath, mainClass, assetIndex, assetsDir, gameJarPath) that the current blocking endpoint returns, stored on the completed job.
5. WHEN a prepare job fails THEN the system SHALL record the error message on the job and set status to `failed`.

### REQ-2: Frontend Progress Display

**User Story:** As a player, I want the download progress overlay to show real phase names, file counts, and a progress bar, so that I can tell whether the prepare is at 10% or 90%.

#### Acceptance Criteria

1. WHEN a prepare job is in progress THEN the frontend SHALL poll the job status endpoint and update the `DownloadProgress` component with real phase, current, total, and percentage values.
2. WHEN the phase changes (e.g., from libraries to assets) THEN the progress display SHALL update the phase label and reset the sub-progress counts to reflect the new phase.
3. WHEN the prepare job completes THEN the frontend SHALL dismiss the progress overlay and proceed to launch the game (in Electron) or show the "requires desktop app" message (in browser).
4. WHEN the prepare job fails THEN the frontend SHALL dismiss the overlay and show a toast with the error message.

### REQ-3: Cancellation

**User Story:** As a player, I want to cancel a game preparation that's taking too long, so that I'm not stuck waiting.

#### Acceptance Criteria

1. WHEN a prepare job is in progress THEN the frontend SHALL show a cancel button on the progress overlay.
2. WHEN the user clicks cancel THEN the system SHALL abort all in-flight downloads for that job and set the job status to `failed` with error `"Cancelled"`.
3. WHEN a prepare job is cancelled THEN the system SHALL clean up partial state (remove the job from active tracking) so the user can retry immediately.
4. WHEN the user retries after cancellation THEN a new prepare job SHALL be created from scratch (previously cached/downloaded files are still usable since the services skip existing valid files).

### REQ-4: One-Per-Instance Guard

**User Story:** As a player, I want the system to prevent duplicate prepare jobs for the same instance, so that I don't accidentally trigger parallel downloads.

#### Acceptance Criteria

1. WHEN a prepare job is already active for an instance AND the user attempts to start another THEN the system SHALL reject the request with a conflict error (HTTP 409).
2. WHEN a previous prepare job has completed or failed THEN the system SHALL allow a new prepare job for the same instance.

### REQ-5: Dead Code Cleanup

**User Story:** As a developer, I want dead/vestigial code removed so the codebase accurately reflects the actual implementation.

#### Acceptance Criteria

1. WHEN the migration is complete THEN the old synchronous `POST /api/launcher/prepare/:id` handler SHALL be replaced by the new async job-based flow (not kept alongside it).
2. WHEN the migration is complete THEN the `DownloadProgressInfo` interface in `shared/src/index.ts` SHALL be removed or replaced if it is no longer referenced by any code.
3. WHEN the migration is complete THEN any unused `onProgress` callback parameter signatures that are no longer needed (because progress now flows through the job object) SHALL be cleaned up if the callbacks are replaced by direct job mutation.
4. WHEN the migration is complete THEN the hardcoded `{ phase: "version", current: 0, total: 0 }` prop in `InstanceDetail.tsx` SHALL be replaced by real data from the job.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility**: Each new file handles one domain (one model, one service, one route file, one component concern)
- **Modular Design**: Components, services, and models are isolated and reusable across the app
- **Transport Separation**: Business logic lives in services, not in route handlers or WebSocket handlers
- **Clear Interfaces**: New modules export typed functions; Electron features flow through the contextBridge preload script

### Performance
- Polling interval for progress should be in the range of 500ms-1000ms -- fast enough to feel responsive, not so fast it floods the backend.
- The job pattern should not add meaningful overhead vs the current blocking approach -- the actual download work is identical.
- Completed/failed prepare jobs should be cleaned up on a TTL (matching the 1-hour TTL used by server download jobs) to avoid unbounded memory growth.

### Security
- Feature inherits existing auth middleware if auth is enabled. No additional security requirements.
- Prepare jobs should only be accessible to the user who created them (or any authenticated user, consistent with how server download jobs work today).

### Reliability
- If the backend restarts mid-prepare, in-progress jobs are lost (they're in-memory, same as server download jobs). This is acceptable -- the user retries and cached files are reused.
- Failed downloads for individual files should fail the entire job with a clear error, not silently skip files (the launcher won't work with missing libraries/assets).
- The `AbortController` signal must be threaded through to all `fetch()` calls in `VersionService`, `AssetService`, and `LibraryService` so cancellation actually stops in-flight HTTP requests.

### Usability
- Dark theme consistent with existing app.
- The `DownloadProgress` component already has the right visual design -- it just needs real data.
- First-time instance preparation (no cached files) may take several minutes. The progress display should make this feel manageable rather than broken.
- Subsequent preparations (most files cached) should complete in seconds and the progress overlay should appear/dismiss quickly without jarring transitions.
