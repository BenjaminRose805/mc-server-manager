# Design Document

## Overview

This spec adds a GitHub Actions workflow that automatically builds, optionally signs, and publishes Electron desktop installers for Windows, macOS, and Linux. The workflow triggers on `v*` tag pushes and manual dispatch. It handles the monorepo build chain (shared -> backend -> frontend -> electron), rebuilds native modules (better-sqlite3, argon2) per platform, and publishes artifacts to draft GitHub Releases.

This is purely CI/CD infrastructure -- no application runtime code changes. The deliverables are: one workflow YAML file, updated electron-builder configuration, a macOS entitlements file, and cleanup of the existing native module hacks.

## Steering Document Alignment

Per `product.md`: "Automated cross-platform desktop builds via GitHub Actions" is in the near-term vision and "Cross-platform desktop builds" is a success metric. Per `tech.md`: electron-builder 25.x is the packaging tool, with targets for NSIS (Windows), DMG (macOS x64+arm64), and AppImage+DEB (Linux x64). Per `structure.md`: the electron package lives at `packages/electron/` with build config embedded in its `package.json`.

## Code Reuse Analysis

### Existing Code to Leverage

- **`packages/electron/package.json` (build section)**: Already has complete electron-builder config with platform targets, asar settings, extraResources mappings, and NSIS options. The CI workflow will invoke this config as-is with minimal modifications.
- **`package.json` (root)**: Has `build:electron:win`, `build:electron:mac`, `build:electron:linux` scripts that chain the full build. The workflow will call a simplified version of these.
- **`packages/electron/release/builder-debug.yml`**: Debug output from a previous local Windows build. Confirms the NSIS installer pipeline works. This file is gitignored and irrelevant to CI.

### Integration Points

- **GitHub Actions**: New `.github/workflows/build-electron.yml` triggers on tag push and workflow_dispatch.
- **electron-builder publish config**: Currently `"publish": null`. Will be changed to GitHub provider so electron-builder can upload artifacts to releases.
- **npm workspaces**: `npm ci` at root installs all workspace dependencies. Build scripts already handle the shared -> backend -> frontend -> electron chain.

### Shared Types Already Available

No shared types are affected. This spec does not touch runtime code.

## Architecture

```
Developer pushes v* tag
        |
        v
GitHub Actions triggers build-electron.yml
        |
        +----> [ubuntu-latest]  --> npm ci --> build all --> electron-builder --linux --> upload
        |
        +----> [macos-latest]   --> npm ci --> build all --> electron-builder --mac   --> upload
        |
        +----> [windows-latest] --> npm ci --> build all --> electron-builder --win   --> upload
        |
        v
All 3 jobs complete
        |
        v
[ubuntu-latest] Release job --> Download all artifacts --> Create/update draft GitHub Release
```

### Design Principles Applied

- **Separate jobs per platform**: Each OS builds natively (no cross-compilation). Native modules compile against the target platform's Electron headers. Code signing secrets are scoped per platform.
- **Dedicated release job**: A fourth job (`release`) runs after all builds succeed, downloads artifacts, and creates a single draft release. This avoids race conditions from three jobs publishing simultaneously.
- **Graceful degradation**: Code signing is optional. When secrets are missing, signing steps are skipped using GitHub Actions conditional expressions (`if: env.MAC_CERTIFICATE != ''`).

## Components and Interfaces

### Component 1: Workflow File (`.github/workflows/build-electron.yml`)

- **Purpose**: GitHub Actions workflow that orchestrates cross-platform Electron builds and release publishing.
- **Structure**:

```yaml
name: Build Electron App

on:
  push:
    tags: ['v*']
  workflow_dispatch: {}

permissions:
  contents: write  # Needed for release creation

jobs:
  build-linux:
    runs-on: ubuntu-latest
    # Steps: checkout, setup-node, cache, npm ci, build chain, 
    # electron-builder install-app-deps, electron-builder --linux --publish never,
    # upload-artifact

  build-macos:
    runs-on: macos-latest
    # Steps: same as linux, plus conditional code signing + notarization
    # env: CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID

  build-windows:
    runs-on: windows-latest
    # Steps: same as linux, plus conditional code signing
    # env: WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD

  release:
    runs-on: ubuntu-latest
    needs: [build-linux, build-macos, build-windows]
    if: startsWith(github.ref, 'refs/tags/v')
    # Steps: download all artifacts, create/update draft release with softprops/action-gh-release
```

- **Dependencies**: GitHub Actions runners, actions/checkout@v4, actions/setup-node@v4, actions/cache@v4, actions/upload-artifact@v4, actions/download-artifact@v4, softprops/action-gh-release@v2
- **Reuses**: Root `package.json` build scripts

### Component 2: Updated electron-builder Config (`packages/electron/package.json`)

- **Purpose**: Update the `build` section to support CI publishing and fix native module handling.
- **Changes**:

```jsonc
{
  "build": {
    // CHANGE: Enable publish to GitHub
    "publish": {
      "provider": "github",
      "releaseType": "draft"
    },
    // CHANGE: Enable native module rebuild (remove the disable flags)
    "npmRebuild": true,
    // KEEP: Everything else stays the same (targets, asar, extraResources, etc.)
  },
  "scripts": {
    // CHANGE: Remove the prebuild-install hack from dist:win
    "dist:win": "electron-builder --win",
    // KEEP: dist, rebuild unchanged
  }
}
```

- **Dependencies**: No new dependencies
- **Reuses**: All existing electron-builder config (targets, files, extraResources)

### Component 3: macOS Entitlements (`packages/electron/build/entitlements.mac.plist`)

- **Purpose**: Required for macOS hardened runtime. Grants permissions Electron apps need to function.
- **Content**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

- **Dependencies**: Referenced by electron-builder mac config via `entitlements` and `entitlementsInherit` keys
- **Reuses**: Standard Electron entitlements

## Data Models

No new data models. This spec does not touch the database or shared types.

## API Endpoints

No new API endpoints. This spec does not touch the backend HTTP/WS server.

## WebSocket Events

No new WebSocket events. This spec is infrastructure only.

## Error Handling

### Error Scenarios

1. **Native module compilation failure**
   - **Handling**: The `electron-builder install-app-deps` step will fail with a non-zero exit code, logging the compiler error output.
   - **User Impact**: GitHub Actions marks the job as failed. Developer sees the exact compilation error in the workflow logs.

2. **Code signing secrets missing**
   - **Handling**: Conditional `if` expressions skip signing steps entirely. The build produces unsigned installers.
   - **User Impact**: None -- the workflow succeeds. Unsigned installers are uploaded.

3. **macOS notarization failure (Apple service issue)**
   - **Handling**: electron-builder's notarization step will fail with Apple's error response.
   - **User Impact**: macOS build job fails. The developer can re-run the workflow or check Apple's service status.

4. **GitHub Release already exists for tag**
   - **Handling**: `softprops/action-gh-release` with `draft: true` will update the existing draft release rather than creating a duplicate.
   - **User Impact**: None -- idempotent behavior.

5. **One platform build fails, others succeed**
   - **Handling**: Each platform is an independent job. The `release` job requires all three to succeed (`needs: [build-linux, build-macos, build-windows]`), so no partial release is created. Individual platform artifacts are still uploaded to the workflow run.
   - **User Impact**: Developer sees which platform failed. Successful platforms' artifacts are still downloadable from the workflow run (not from a release).

## Verification Strategy

### Build Verification

- The workflow YAML must pass GitHub Actions syntax validation (no YAML errors on push)
- `npm run build` must pass locally with zero errors after electron-builder config changes
- Local `npm run dist -w @mc-server-manager/electron -- --linux` (or `--win`/`--mac` depending on dev machine) must still work

### Manual Testing Checklist

1. Push a test tag `v0.0.0-test.1` -> workflow triggers, all 3 platform jobs start
2. Linux job completes -> produces `.AppImage` and `.deb` in workflow artifacts
3. macOS job completes -> produces `.dmg` files (x64 + arm64) in workflow artifacts
4. Windows job completes -> produces `.exe` NSIS installer in workflow artifacts
5. Release job runs -> draft GitHub Release created with all artifacts attached
6. Trigger `workflow_dispatch` manually (no tag) -> builds complete, artifacts uploaded, NO release created
7. Re-push same tag -> draft release is updated (not duplicated)
8. Run without signing secrets -> builds succeed with unsigned installers
9. Local `build:electron:win` / `build:electron:mac` / `build:electron:linux` scripts still work

## Implementation Order

1. **macOS entitlements file** -- No dependencies. Create `packages/electron/build/entitlements.mac.plist`. Pure file creation.
2. **electron-builder config updates** -- Update `packages/electron/package.json`: change `publish` from `null` to GitHub provider, set `npmRebuild: true`, remove `prebuild-install` hack from `dist:win`, add entitlements references to `mac` section. Verify local build still works.
3. **GitHub Actions workflow** -- Create `.github/workflows/build-electron.yml` with all 4 jobs (build-linux, build-macos, build-windows, release). This is the main deliverable. Depends on (1) and (2) being committed.
4. **Verification** -- Push a test tag and validate all jobs. Confirm artifacts and draft release.

Each step can be verified independently before proceeding to the next.
