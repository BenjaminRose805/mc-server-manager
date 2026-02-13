# Requirements Document

## Introduction

MC Server Manager currently has electron-builder configuration for Windows (NSIS), macOS (DMG), and Linux (AppImage + DEB), but building installers is a manual, local-machine process. There is no CI/CD pipeline, no code signing, and no automated release publishing. This means distributing the desktop app requires a developer to build on each target OS manually and upload artifacts by hand.

This spec defines a GitHub Actions workflow that automatically builds, optionally signs, and publishes cross-platform Electron installers whenever a release is tagged. It eliminates the manual build process and enables reliable distribution of the desktop app to users on all three platforms.

The workflow must handle the project's native Node modules (better-sqlite3, argon2), the monorepo workspace structure, and the sequential build order (shared -> backend -> frontend -> electron). Code signing and notarization should be supported but gracefully skippable when certificates are not configured, so the workflow is useful from day one without requiring an Apple Developer account or Windows code signing certificate.

## Alignment with Project Direction

Per `product.md`, "Cross-platform desktop builds (Linux, macOS, Windows)" is listed as a success metric, and "Automated cross-platform desktop builds via GitHub Actions" is explicitly in the near-term vision. The product steering doc also lists "Electron Desktop Builds: CI/CD pipeline for cross-platform Electron installers via GitHub Actions" under the Pipeline section.

This feature is purely additive infrastructure -- it does not change any application code, database schema, or API surface. It creates a `.github/workflows/` file and adjusts electron-builder configuration to support CI-driven publishing.

### Dependencies

- **Depends on**: Electron desktop app must be functional (already implemented via `electron-migration` spec)
- **Depended on by**: All future features benefit from automated distribution. Specifically, mod-sync and shared-minecraft-servers will need users to be on matching desktop app versions, making reliable releases critical.

---

## Requirements

### REQ-1: Automated Cross-Platform Build on Tag Push

**User Story:** As a developer, I want the CI pipeline to automatically build installers for all platforms when I push a version tag, so that I don't have to manually build on each OS.

#### Acceptance Criteria

1. WHEN a git tag matching the pattern `v*` (e.g., `v0.2.0`, `v1.0.0-beta.1`) is pushed to the repository THEN the system SHALL trigger build jobs for Windows, macOS, and Linux concurrently.
2. WHEN the build pipeline runs THEN it SHALL execute the full build chain in order: install dependencies, build shared types, build backend, build frontend, build electron, then package with electron-builder.
3. WHEN the Windows build job runs THEN it SHALL produce an NSIS installer (`.exe`) for x64 architecture.
4. WHEN the macOS build job runs THEN it SHALL produce DMG installers for both x64 (Intel) and arm64 (Apple Silicon) architectures.
5. WHEN the Linux build job runs THEN it SHALL produce an AppImage (x64) and a DEB package (x64).
6. WHEN any build job fails THEN other platform builds SHALL continue independently (failure on one platform does not cancel others).
7. WHEN all build jobs complete THEN the system SHALL upload build artifacts (installers, blockmaps) to the GitHub Actions run for download, regardless of whether GitHub Release publishing succeeds.

### REQ-2: Native Module Compilation

**User Story:** As a developer, I want native Node modules (better-sqlite3, argon2) to compile correctly for each platform's Electron runtime, so that the packaged app works without crashes.

#### Acceptance Criteria

1. WHEN the build pipeline installs dependencies THEN it SHALL rebuild native modules against the Electron runtime version (not the system Node.js version).
2. WHEN native module rebuilding runs on Windows THEN it SHALL produce working x64 binaries for better-sqlite3 and argon2.
3. WHEN native module rebuilding runs on macOS THEN it SHALL produce working binaries for both x64 and arm64 architectures.
4. WHEN native module rebuilding runs on Linux THEN it SHALL produce working x64 binaries.
5. IF native module compilation fails on any platform THEN the build job SHALL fail with a clear error message indicating which module failed to compile.

### REQ-3: GitHub Release Publishing

**User Story:** As a developer, I want installers to be automatically published to a GitHub Release when I tag a version, so that users can download the latest version from the repository's releases page.

#### Acceptance Criteria

1. WHEN all platform builds succeed and a `v*` tag triggered the workflow THEN the system SHALL create (or update) a draft GitHub Release for the tag.
2. WHEN the release is created THEN it SHALL include all platform installers as downloadable assets (Windows `.exe`, macOS `.dmg` x2 for Intel/Apple Silicon, Linux `.AppImage` and `.deb`).
3. WHEN the release is created THEN it SHALL be in **draft** state, so the developer can review and manually publish it.
4. WHEN the release is created THEN it SHALL auto-generate release notes from commits since the previous tag.
5. IF a draft release for the tag already exists (from a previous failed/retried run) THEN the system SHALL update the existing draft rather than creating a duplicate.

### REQ-4: macOS Code Signing and Notarization (Optional)

**User Story:** As a developer, I want the option to code-sign and notarize macOS builds, so that users don't see "app is damaged" or Gatekeeper warnings when they install.

#### Acceptance Criteria

1. IF macOS code signing secrets are configured in the repository (`MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`) THEN the macOS build SHALL sign the application with a Developer ID Application certificate.
2. IF macOS notarization secrets are additionally configured (`APPLE_TEAM_ID` plus either Apple ID credentials or API Key credentials) THEN the macOS build SHALL submit the signed app for Apple notarization and staple the ticket to the DMG.
3. IF macOS code signing secrets are NOT configured THEN the macOS build SHALL still produce unsigned DMG installers without failing.
4. WHEN code signing is active THEN the build SHALL use hardened runtime with appropriate entitlements for Electron apps (JIT, unsigned executable memory, dyld environment variables, library validation exemption).
5. WHEN notarization fails (e.g., Apple service outage, invalid credentials) THEN the build SHALL fail with a clear error identifying the notarization step as the failure point.

### REQ-5: Windows Code Signing (Optional)

**User Story:** As a developer, I want the option to code-sign Windows builds, so that users don't see SmartScreen warnings when they install.

#### Acceptance Criteria

1. IF Windows code signing secrets are configured in the repository (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) THEN the Windows build SHALL sign the installer and executable.
2. IF Windows code signing secrets are NOT configured THEN the Windows build SHALL still produce unsigned NSIS installers without failing.
3. WHEN code signing is active THEN the build SHALL use SHA-256 signing hash algorithm.

### REQ-6: Build Caching

**User Story:** As a developer, I want CI builds to use caching for npm dependencies and Electron binaries, so that builds are faster and consume fewer GitHub Actions minutes.

#### Acceptance Criteria

1. WHEN the build pipeline runs THEN it SHALL cache npm dependencies between runs (invalidated when `package-lock.json` changes).
2. WHEN the build pipeline runs THEN it SHALL cache Electron binaries and electron-builder resources (NSIS, AppImage tools, etc.) between runs.
3. WHEN cache is available from a previous run THEN the dependency installation step SHALL be significantly faster than a cold build.
4. IF cache is unavailable (first run, cache expired, lockfile changed) THEN the build SHALL still succeed by downloading everything fresh.

### REQ-7: Manual Workflow Trigger

**User Story:** As a developer, I want to manually trigger the build workflow for any branch, so that I can test packaging changes without creating a tag.

#### Acceptance Criteria

1. WHEN a developer triggers the workflow manually via GitHub Actions UI (workflow_dispatch) THEN the system SHALL build all platforms.
2. WHEN triggered manually THEN the system SHALL upload build artifacts to the workflow run for download.
3. WHEN triggered manually (without a tag) THEN the system SHALL NOT create a GitHub Release.

### REQ-8: Electron-Builder Configuration Updates

**User Story:** As a developer, I want the electron-builder configuration to support CI-driven builds, so that the same config works both locally and in CI.

#### Acceptance Criteria

1. WHEN electron-builder runs in CI THEN it SHALL use GitHub as the publish provider (reading the `GH_TOKEN` environment variable).
2. WHEN electron-builder runs locally (no `GH_TOKEN`) THEN it SHALL still build installers without attempting to publish, preserving the current local development workflow.
3. WHEN the configuration is updated THEN the existing local build scripts (`build:electron:win`, `build:electron:mac`, `build:electron:linux`) SHALL continue to work as before.
4. WHEN electron-builder packages the app THEN native module rebuild settings SHALL be configured to work correctly (removing the manual `prebuild-install` hack in the current `dist:win` script).

---

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility**: Each new file handles one domain (one model, one service, one route file, one component concern)
- **Modular Design**: Components, services, and models are isolated and reusable across the app
- **Transport Separation**: Business logic lives in services, not in route handlers or WebSocket handlers
- **Clear Interfaces**: New modules export typed functions; Electron features flow through the contextBridge preload script

### Performance
- Cached builds (with warm npm + electron cache) should complete each platform job in under 15 minutes.
- All three platform builds run in parallel to minimize total wall-clock time.
- No performance-critical runtime paths are affected by this spec (infrastructure only).

### Security
- Code signing certificates and Apple credentials must be stored as encrypted GitHub repository secrets, never committed to source code.
- The `GITHUB_TOKEN` used for release publishing must have only the minimum required permissions (contents: write).
- No secrets shall be logged or exposed in workflow output.

### Reliability
- Failure on one platform must not block other platforms from building and uploading their artifacts.
- Workflow must be idempotent: re-running on the same tag must update the existing draft release, not create duplicates.
- All existing application functionality is completely unaffected -- this spec only adds CI infrastructure and adjusts electron-builder config.

### Usability
- Workflow file should be well-commented explaining each step, especially the code signing and native module sections.
- GitHub Release draft should include platform-labeled download links so users can easily find the correct installer.
- Developers should be able to set up the workflow incrementally: first without signing (just builds), then add signing secrets later.
