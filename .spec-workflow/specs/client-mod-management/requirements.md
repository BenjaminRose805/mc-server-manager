# Requirements Document -- Client Mod Management

## Introduction

Extend the existing server mod management system (Epic 2) to also work with client game instances (Epic 3). Users can search Modrinth for client-side mods, install them to any managed instance, resolve dependencies, manage mod loaders (Fabric client installation), and import/export modpacks -- using the same interface and backend services as server mods.

This epic depends on Epic 2 (Server Mods) for the Modrinth client, dependency resolver, and modpack parser, and on Epic 3 (Client Launcher) for instance management. The core approach is generalization -- refactoring the mod services to operate on a `ModTarget` abstraction that represents either a server or an instance.

## Alignment with Product Vision

Client mod management completes the "manage everything from one app" experience. Once a user can manage both server mods and client mods from MC Server Manager, they never need to open a separate mod manager (like Modrinth App or CurseForge). This is prerequisite for:
- Epic 9 (Mod Sync) -- automatically synchronizing mods between server and client when joining a shared server

---

## Requirements

### REQ-1: Generalized Mod Service (ModTarget Abstraction)

**User Story:** As a developer, I want the mod management services to work with both servers and instances, so that I don't duplicate business logic between the two.

#### Acceptance Criteria

1. WHEN the ModService is called with a server target THEN it SHALL behave identically to the current server-only implementation.
2. WHEN the ModService is called with an instance target THEN it SHALL install mods to the instance's `mods/` directory and track them with `instance_id` in the database.
3. WHEN a mod is installed THEN the database record SHALL have either `server_id` or `instance_id` set (mutually exclusive, enforced by CHECK constraint).
4. WHEN the ModpackService imports a `.mrpack` for an instance THEN it SHALL apply `overrides/` to the instance directory (not `server-overrides/`).
5. WHEN the ModpackService exports an instance as `.mrpack` THEN it SHALL include instance mods and config files in the correct format.

---

### REQ-2: Client-Side Mod Filtering

**User Story:** As a player, I want to search for mods that work on the client, so that I don't accidentally install server-only mods on my game instance.

#### Acceptance Criteria

1. WHEN the user searches for mods in the instance mod manager THEN the system SHALL filter results to mods with `client_side: required` or `client_side: optional` from Modrinth.
2. WHEN a mod is marked as `server_side: required` and `client_side: unsupported` THEN it SHALL NOT appear in instance mod search results.
3. WHEN the user searches for mods in the server mod manager THEN the existing behavior SHALL be unchanged (no client-side filtering).

---

### REQ-3: Client Mod Loader Installation

**User Story:** As a player, I want to install Fabric on my game instance, so that I can run Fabric mods when I launch Minecraft.

#### Acceptance Criteria

1. WHEN the user installs Fabric on an instance THEN the system SHALL download the Fabric profile JSON from the Fabric Meta API and save it to the instance's versions directory.
2. WHEN Fabric is installed THEN the system SHALL download all required Fabric libraries to the shared libraries directory.
3. WHEN Fabric is installed THEN the instance record SHALL be updated with the loader type, loader version, and Fabric version ID.
4. WHEN the instance is launched after Fabric installation THEN the game SHALL use Fabric's main class and include Fabric libraries in the classpath.
5. WHEN the user removes a mod loader from an instance THEN the system SHALL revert the instance to vanilla configuration.
6. IF no mod loader is installed on an instance THEN the mod install UI SHALL prompt the user to install one before installing mods.

---

### REQ-4: Instance Mod CRUD

**User Story:** As a player, I want to install, remove, enable/disable, and update mods on my game instances, so that I can customize my Minecraft experience.

#### Acceptance Criteria

1. WHEN the user installs a mod on an instance THEN the system SHALL download the mod JAR to the instance's `mods/` directory, verify its hash, resolve required dependencies, and record it in the database.
2. WHEN the user removes a mod from an instance THEN the system SHALL delete the JAR file, remove the database record, and warn if other mods depend on it.
3. WHEN the user enables/disables a mod THEN the system SHALL rename the file between `.jar` and `.jar.disabled`.
4. WHEN the user checks for updates THEN the system SHALL use Modrinth's batch hash lookup to find newer versions compatible with the instance's MC version and loader.
5. WHEN updates are applied THEN the system SHALL download new JARs, replace old ones, and update database records.
6. WHEN a user manually adds/removes mod files in the instance `mods/` directory THEN the sync operation SHALL reconcile the database with the filesystem, identifying new mods via Modrinth hash lookup.

---

### REQ-5: Instance Mod Manager UI

**User Story:** As a player, I want a mod management interface in the instance detail view, so that I can browse, install, and manage mods for each game instance.

#### Acceptance Criteria

1. WHEN the user views an instance's detail page THEN the system SHALL display a Mods tab showing all installed mods with name, version, size, and enable/disable/remove actions.
2. WHEN the user opens the mod search panel THEN the system SHALL display Modrinth search results filtered for client-compatible mods matching the instance's MC version and loader.
3. WHEN a mod has required dependencies THEN the system SHALL show a confirmation dialog listing all dependencies before installation.
4. WHEN updates are available THEN the system SHALL show an update count badge and an updates panel listing all available updates.
5. WHEN the instance has no mod loader installed THEN the system SHALL show a loader setup prompt instead of the mod search.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: The ModTarget abstraction SHALL be the ONLY change to the existing mod service interface. All business logic remains in ModService.
- **Modular Design**: Instance mod routes SHALL be in a separate route file (`instance-mods.ts`), not mixed with server mod routes.
- **No Duplication**: Frontend mod management components SHALL be generalized to accept a `targetType` prop rather than duplicating server components for instances.
- **Backward Compatibility**: All existing server mod management functionality SHALL continue to work identically after the refactor.

### Performance
- Client mod search, install, and update operations SHALL have the same performance characteristics as server mod operations (same Modrinth client, same caching).
- Fabric library downloads SHALL be skipped if already present in the shared libraries directory.

### Security
- Mod files SHALL have their SHA-1 hashes verified after download (same as server mods).
- Instance mod operations SHALL only affect the target instance's directory -- no cross-instance file access.

### Reliability
- The `syncModsDirectory` reconciliation SHALL work for instance mods with the same reliability as server mods.
- IF a mod loader installation fails partway THEN the instance SHALL remain in a consistent state (either fully installed or reverted).

### Usability
- The instance mod manager SHALL look and feel identical to the server mod manager so users don't need to learn a different interface.
- Client-side filtering SHALL be automatic -- users don't need to manually toggle a "client only" filter.
