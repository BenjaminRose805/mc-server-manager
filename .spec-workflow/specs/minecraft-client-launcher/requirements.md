# Requirements Document -- Minecraft Client Launcher

## Introduction

Build a complete Minecraft client launcher into the desktop application. Users can authenticate with Microsoft accounts, select any Minecraft version, create isolated game instances (profiles), and launch the game -- all from the same interface used to manage servers.

This epic depends on the Tauri desktop shell (Epic 1) for native OS access: secure credential storage (OS keychain), Java process spawning, and file management. The existing Express backend stores instance configurations in SQLite while the Tauri Rust core handles authentication, file I/O, and process launching.

## Alignment with Product Vision

The client launcher transforms MC Server Manager from a server-only tool into a complete Minecraft management platform. Users no longer need a separate launcher (official Minecraft Launcher, MultiMC, Prism) -- they can manage servers AND launch the game from one app. This is prerequisite for:
- Epic 4 (Client Mod Management) -- managing mods on game instances
- Epic 9 (Mod Sync) -- automatically syncing mods between server and client when joining

---

## Requirements

### REQ-1: Microsoft Authentication

**User Story:** As a player, I want to sign in with my Microsoft account, so that I can launch Minecraft with my purchased license.

#### Acceptance Criteria

1. WHEN the user initiates sign-in THEN the system SHALL display a device code and verification URL for the Microsoft OAuth2 device code flow.
2. WHEN the user completes authentication on the Microsoft website THEN the system SHALL perform the full authentication chain: Microsoft OAuth2 -> Xbox Live -> XSTS -> Minecraft Services.
3. WHEN authentication completes THEN the system SHALL retrieve the Minecraft profile (UUID, username) and store it as a launcher account.
4. WHEN authentication tokens are obtained THEN the system SHALL store the Minecraft access token and Microsoft refresh token in the OS keychain (not in SQLite or on disk).
5. WHEN a stored access token expires THEN the system SHALL automatically refresh it using the stored refresh token before launching.
6. WHEN the user has multiple Microsoft accounts THEN the system SHALL allow managing and switching between them.
7. WHEN the user removes an account THEN the system SHALL delete all associated tokens from the OS keychain.
8. IF the user does not own Minecraft THEN the system SHALL display a clear error after the Minecraft profile check fails.

---

### REQ-2: Game Instance Management

**User Story:** As a player, I want to create isolated game instances (profiles), so that I can have different Minecraft versions, mods, and settings without them interfering with each other.

#### Acceptance Criteria

1. WHEN the user creates an instance THEN the system SHALL prompt for: name, Minecraft version, optional mod loader (Fabric/Forge/NeoForge/Quilt), and memory allocation.
2. WHEN an instance is created THEN the system SHALL create an isolated directory containing: `saves/`, `resourcepacks/`, `mods/`, `shaderpacks/`, `options.txt`, and `servers.dat`.
3. WHEN the user lists instances THEN the system SHALL display: name, Minecraft version, mod loader, last played time, and total playtime.
4. WHEN the user updates an instance THEN the system SHALL allow changing: name, memory allocation (min/max RAM), resolution, custom JVM arguments, and custom game arguments.
5. WHEN the user deletes an instance THEN the system SHALL remove the instance directory and all its contents after confirmation.
6. WHEN libraries, assets, and game JARs are downloaded THEN they SHALL be shared across all instances to save disk space.

---

### REQ-3: Version & Asset Management

**User Story:** As a player, I want to select any Minecraft version (including snapshots), so that I can play the version I prefer.

#### Acceptance Criteria

1. WHEN the user browses versions THEN the system SHALL display all Minecraft versions from the official Mojang version manifest, categorized by type (release, snapshot, old_beta, old_alpha).
2. WHEN a version is selected THEN the system SHALL download and cache the version JSON, verifying its SHA-1 hash.
3. WHEN the game is prepared to launch THEN the system SHALL download: the client JAR, all required libraries (platform-filtered), the asset index, and all asset objects.
4. WHEN assets are downloaded THEN the system SHALL store them in a shared hash-based directory structure matching Mojang's format (`objects/{hash[:2]}/{hash}`).
5. WHEN libraries are downloaded THEN each library's SHA-1 hash SHALL be verified after download.
6. WHEN downloads are in progress THEN the system SHALL report progress (current/total items) to the frontend.
7. IF a download fails THEN the system SHALL retry once before reporting an error.

---

### REQ-4: Java Version Management

**User Story:** As a player, I want the launcher to automatically use the correct Java version for my Minecraft version, so that I don't need to manage Java installations manually.

#### Acceptance Criteria

1. WHEN the launcher starts THEN the system SHALL detect all installed Java installations by scanning: `JAVA_HOME`, system PATH, and common installation directories per platform.
2. WHEN a game instance requires a Java version not installed THEN the system SHALL offer to download it automatically from Eclipse Adoptium.
3. WHEN Java is downloaded THEN the system SHALL extract and store it in the app data directory under `launcher/runtime/java-{version}/`.
4. WHEN launching a game THEN the system SHALL select the correct Java version based on the Minecraft version: Java 8 for MC 1.16 and below, Java 17 for MC 1.18-1.20.4, Java 21 for MC 1.20.5+.
5. WHEN the user specifies a custom Java path for an instance THEN the system SHALL use that path instead of auto-detection.

---

### REQ-5: Game Launching

**User Story:** As a player, I want to click "Play" on an instance and have Minecraft launch with the correct version, account, and settings.

#### Acceptance Criteria

1. WHEN the user clicks launch THEN the system SHALL: verify the access token, download any missing game files, extract native libraries, construct the full launch command, and spawn the Java process.
2. WHEN the game launches THEN the system SHALL pass: the correct classpath (libraries + game JAR), main class, authentication tokens (access token, UUID, username), game directory (instance path), assets directory, asset index name, version name, and window resolution if configured.
3. WHEN native libraries are required THEN the system SHALL extract them to a temporary directory specific to the launch instance.
4. WHEN a game is running THEN the system SHALL track it as an active process with the instance ID, PID, and start time.
5. WHEN a game process exits THEN the system SHALL update the instance's last played timestamp and total playtime.
6. WHEN a game is already running for an instance THEN the system SHALL prevent launching a second instance of the same profile.
7. WHEN the user specifies custom JVM arguments THEN they SHALL be included in the launch command between the default JVM args and the main class.

---

### REQ-6: Launcher Frontend UI

**User Story:** As a player, I want a clear, intuitive launcher interface, so that I can manage my instances and launch the game easily.

#### Acceptance Criteria

1. WHEN the user navigates to the launcher section THEN the system SHALL display a grid or list of game instances with icons, names, versions, and last played times.
2. WHEN the user selects an instance THEN the system SHALL show a detail view with: a prominent "Play" button, instance settings, mod list (if applicable), and playtime statistics.
3. WHEN no accounts are configured THEN the system SHALL prompt the user to sign in before allowing game launches.
4. WHEN the user creates a new instance THEN the system SHALL present a step-by-step wizard: version selection -> mod loader (optional) -> configuration (name, memory) -> confirm.
5. WHEN a game is preparing to launch (downloading files) THEN the system SHALL show a progress indicator with: total files, downloaded files, and current download speed.
6. WHEN authentication is in progress THEN the system SHALL display the device code prominently with a link/button to open the verification URL.

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Authentication (Rust), Java management (Rust), instance CRUD (backend), version/asset management (backend), and game launching (Rust) SHALL each be separate modules.
- **Modular Design**: The Rust core modules (`auth.rs`, `java.rs`, `launcher.rs`) SHALL be independent and testable. Backend services follow the existing pattern of separate service files.
- **Dependency Management**: Frontend SHALL communicate with Rust core via Tauri IPC for auth and launching, and with the Express backend via HTTP for instance CRUD and version data.
- **Clear Interfaces**: Tauri IPC commands SHALL have typed request/response contracts exposed to the frontend via `@tauri-apps/api`.

### Performance
- Asset downloads SHALL use parallel fetching with a concurrency limit of 10 to avoid overwhelming the network.
- The version manifest SHALL be cached for 1 hour to avoid redundant API calls.
- Library and asset files already downloaded SHALL be skipped (hash-based deduplication).
- Game launch time (from click to process spawn, excluding downloads) SHALL be under 5 seconds.

### Security
- Authentication tokens SHALL NEVER be stored in SQLite, localStorage, or any unencrypted file -- OS keychain only.
- The Microsoft OAuth2 client ID SHALL be for personal/dev use. Production distribution may require Mojang approval.
- The Rust core SHALL be the ONLY component with access to authentication tokens -- the JavaScript layer SHALL never handle tokens directly.
- All downloaded files (JARs, libraries, assets) SHALL have their SHA-1 hashes verified.

### Reliability
- IF the OS keychain is unavailable THEN the system SHALL fall back to encrypted file storage with a clear warning.
- IF asset downloads partially fail THEN the system SHALL report which assets are missing and allow retry.
- IF the game crashes THEN the system SHALL still update playtime and clear the running process state.
- The launcher SHALL NOT interfere with the existing server management functionality.

### Usability
- The authentication flow SHALL clearly guide the user through the device code process with one-click to open the verification URL.
- Version selection SHALL default to showing releases only, with an option to show snapshots and legacy versions.
- Instance creation SHALL have sensible defaults: latest release, 2-4 GB RAM, no mod loader.
- The launcher SHALL show estimated disk space required before downloading a new version.
