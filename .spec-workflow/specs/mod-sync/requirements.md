# Requirements Document -- Server-Client Mod Synchronization

## Introduction

Add automatic mod synchronization when a user joins a shared Minecraft server. When clicking "Join" on a shared server, the client fetches the server's mod manifest, compares it with the target client instance's installed mods, computes a diff (what to install, update, remove, or disable), and presents a confirmation dialog showing exactly what will change. After user confirmation, the client downloads missing mods from trusted sources (Modrinth CDN or the community server itself), verifies SHA-1 hashes, and launches Minecraft with the correct mod configuration.

This is a capstone feature that ties together server-side mod management (Epic 2), client-side mod management (Epic 4), and shared server infrastructure (Epic 7) into a seamless one-click join experience. The core principle is **server-driven manifest, client-side reconciliation**: the host provides a canonical mod list, and the joining client computes what needs to change locally.

### Key Design Principles

- **Server-driven manifest**: The community server (host) provides a canonical mod manifest with hashes and download URLs.
- **Client-side reconciliation**: The desktop app compares the manifest with the local instance and computes the diff.
- **Hash verification**: All downloaded files must match SHA-1 hashes from the manifest.
- **User confirmation required**: Never auto-install without showing the user what will change.
- **Non-destructive**: Client-only mods (minimaps, shaders) are preserved unless explicitly marked incompatible.
- **Trusted sources only**: Downloads are restricted to Modrinth CDN and the community server itself.

## Alignment with Product Vision

This epic is the capstone of the mod management stack. After Epic 2 (Server Mods) enables hosts to manage server-side mods, Epic 4 (Client Mods) enables players to manage client-side mods, and Epic 7 (Shared Servers) enables server discovery and joining, Epic 9 closes the loop by automatically synchronizing mods when a player joins a shared server. No more manual mod matching, version hunting, or "why can't I connect?" troubleshooting.

Dependencies: Epic 2 (Server Mods -- installed_mods table, ModModel), Epic 4 (Client Mods -- client instance mod tracking, InstalledMod type), Epic 7 (Shared Servers -- community routes, server sharing infrastructure).

---

## Requirements

### REQ-1: Server Mod Manifest Generation

**User Story:** As a server host, I want my server to automatically generate a mod manifest from its installed mods, so that joining players can see exactly what mods are required.

#### Acceptance Criteria

1. WHEN a mod manifest is requested for a server THEN the system SHALL generate a ServerModManifest containing the server ID, name, Minecraft version, mod loader type and version, and a list of all enabled mods with their file names, SHA-1 hashes, file sizes, and download URLs.
2. WHEN a mod has a Modrinth ID and version ID THEN the system SHALL generate a Modrinth CDN download URL for that mod.
3. WHEN a mod does not have a Modrinth ID THEN the system SHALL generate a download URL pointing to the community server's own file endpoint.
4. WHEN a mod is disabled on the server THEN it SHALL NOT appear in the manifest.
5. WHEN the manifest is generated THEN it SHALL include a `generatedAt` ISO timestamp.
6. WHEN a mod has side "server" or "both" THEN it SHALL be categorized as a required mod in the manifest.
7. WHEN a mod has side "client" THEN it SHALL be categorized as an optional mod in the manifest.

---

### REQ-2: Manifest API Endpoint

**User Story:** As a client application, I want to fetch a server's mod manifest via API, so that I can determine what mods are needed to join.

#### Acceptance Criteria

1. WHEN a user requests the manifest for a shared server THEN the system SHALL return the ServerModManifest as JSON via `GET /api/community/servers/:id/mod-manifest`.
2. WHEN a user does not have access to the shared server THEN the system SHALL return a 403 Forbidden error.
3. WHEN a user requests a mod file by hash for a non-Modrinth mod THEN the system SHALL serve the file via `GET /api/community/servers/:serverId/mods/:hash/download`.
4. WHEN a mod file download is requested THEN the system SHALL validate the resolved file path is within the server directory to prevent path traversal.
5. WHEN a user does not have access to the server THEN mod file download requests SHALL return a 403 Forbidden error.

---

### REQ-3: Diff Computation

**User Story:** As a player, I want the app to automatically compare the server's required mods with my local mods, so that I can see exactly what needs to change before joining.

#### Acceptance Criteria

1. WHEN the client compares the manifest with local instance mods THEN the system SHALL produce a ModSyncDiff containing five categories: toInstall, toUpdate, toRemove, toDisable, and toKeep.
2. WHEN a required mod from the manifest is not present locally (by hash or Modrinth ID) THEN it SHALL be categorized as toInstall.
3. WHEN a required mod matches by Modrinth ID but has a different hash (different version) THEN it SHALL be categorized as toUpdate with both the current and target versions shown.
4. WHEN a local mod has side "client" and is not in the manifest or incompatible list THEN it SHALL be categorized as toKeep (client-only mods are preserved).
5. WHEN a local mod has side "server" or "both" and is not in the manifest THEN it SHALL be categorized as toRemove with a warning.
6. WHEN a local mod's Modrinth ID appears in the manifest's incompatibleMods list THEN it SHALL be categorized as toDisable.
7. WHEN optional mods are listed in the manifest THEN they SHALL be included in the diff as optionalAvailable for the user to choose.
8. WHEN a local mod has an unknown side THEN it SHALL be categorized as toKeep (safe default).

---

### REQ-4: User Confirmation Dialog

**User Story:** As a player, I want to review all mod changes before they are applied, so that I can make an informed decision about joining a server.

#### Acceptance Criteria

1. WHEN the diff contains any changes (toInstall, toUpdate, toRemove, or toDisable is non-empty) THEN the system SHALL display a ModSyncDialog listing all changes grouped by category.
2. WHEN the dialog is shown THEN it SHALL display the estimated total download size for mods to install and update.
3. WHEN the user clicks "Sync and Join" THEN the system SHALL proceed with downloading, installing, and launching.
4. WHEN the user clicks "Cancel" THEN no changes SHALL be made and the server SHALL NOT be joined.
5. WHEN incompatible mods are present THEN the dialog SHALL display them with a red warning icon and explanatory text that they must be disabled.
6. WHEN client-only mods are being kept THEN the dialog SHALL display them in a collapsible section to reduce visual noise.
7. WHEN mods are being removed THEN the dialog SHALL display a warning that they are not required by the server.

---

### REQ-5: Parallel Mod Download with Hash Verification

**User Story:** As a player, I want mod downloads to be fast and verified, so that I can join servers quickly and safely.

#### Acceptance Criteria

1. WHEN mods need to be downloaded THEN the system SHALL download them in parallel with a concurrency limit of 5.
2. WHEN a mod file is downloaded THEN the system SHALL compute its SHA-1 hash and compare it to the expected hash from the manifest.
3. WHEN a hash matches THEN the system SHALL install the mod file to the client instance's mods directory.
4. WHEN a hash does not match THEN the system SHALL delete the downloaded file, report the error, and NOT install the file.
5. WHEN a download URL is not from a trusted source (Modrinth CDN, GitHub, or the community server) THEN the system SHALL reject the download with a security error.
6. WHEN a download fails due to network error THEN the system SHALL report the error for that specific mod without aborting other downloads.

---

### REQ-6: Client-Only Mod Preservation

**User Story:** As a player, I want my client-only mods (minimaps, shaders, performance mods) to be preserved when syncing, so that I keep my preferred gameplay experience.

#### Acceptance Criteria

1. WHEN a local mod has side "client" and is not in the server's incompatible list THEN the system SHALL keep it installed and not modify it.
2. WHEN client-only mods are preserved THEN the sync dialog SHALL show them in a "Keep" section so the user knows they are safe.

---

### REQ-7: Incompatible Mod Handling

**User Story:** As a player, I want incompatible mods to be automatically disabled before joining, so that I do not experience crashes or connection issues.

#### Acceptance Criteria

1. WHEN the manifest lists a mod's Modrinth ID in the incompatibleMods array THEN the system SHALL disable it by renaming the .jar file to .jar.disabled.
2. WHEN incompatible mods are found THEN the sync dialog SHALL clearly show them in a "Disable incompatible" section with a warning.
3. WHEN the user confirms the sync THEN all incompatible mods SHALL be disabled before launching.

---

### REQ-8: One-Click Sync and Launch

**User Story:** As a player, I want to click "Join" on a shared server and have everything handled automatically, so that I can get into the game as quickly as possible.

#### Acceptance Criteria

1. WHEN a user clicks "Join" on a shared server THEN the system SHALL fetch the manifest, compute the diff, and either show the sync dialog (if changes needed) or launch directly (if no changes needed).
2. WHEN no mod changes are needed (local mods already match the manifest) THEN the system SHALL skip the dialog and launch Minecraft directly, auto-connecting to the server.
3. WHEN the sync completes successfully THEN the system SHALL launch Minecraft with the target instance and auto-connect to the server address and port.
4. WHEN no compatible client instance exists for the server's Minecraft version THEN the system SHALL show an error message.

---

### REQ-9: Sync Progress Tracking

**User Story:** As a player, I want to see download and installation progress during sync, so that I know how long I need to wait.

#### Acceptance Criteria

1. WHEN mods are being downloaded THEN the system SHALL display a progress dialog showing the current phase (downloading, verifying, installing), current mod name, and completion count out of total.
2. WHEN progress updates THEN a progress bar SHALL reflect the percentage of completed mods.
3. WHEN the sync completes THEN the progress dialog SHALL briefly show "Complete" before launching.
4. WHEN errors occur during sync THEN the progress dialog SHALL display the error messages.

---

## Non-Functional Requirements

### Performance
- Mod downloads SHALL use parallel fetching with a concurrency limit of 5 to balance speed and resource usage.
- The sync diff computation SHALL be performed entirely on the client side using in-memory comparison (no round-trips to the server beyond the initial manifest fetch).
- The manifest endpoint SHALL generate the manifest from existing database records and mod files without expensive disk scanning.

### Security
- All downloaded mod files SHALL be verified against their SHA-1 hash from the manifest before installation.
- Download URLs SHALL be validated against a whitelist of trusted domains: `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`, and relative community server URLs.
- The mod file download endpoint SHALL validate resolved file paths to prevent path traversal attacks.
- File names in the manifest SHALL be validated to reject path traversal characters (`..`, `/`, `\`).

### User Experience
- The sync dialog SHALL clearly categorize changes (install, update, remove, disable, keep) with distinct icons and colors.
- Client-only mods SHALL be preserved by default to avoid disrupting the player's preferred experience.
- When no changes are needed, the join flow SHALL proceed without interruption.
- The progress dialog SHALL provide enough information for the user to estimate remaining wait time (completed count out of total).
- Error messages SHALL be specific and actionable (e.g., "Hash mismatch for Sodium" not just "Download failed").
