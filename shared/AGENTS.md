# AGENTS.md -- Shared Package

Shared TypeScript type definitions used by both the backend and frontend packages. This is the contract layer between the two -- any interface change here affects both sides.

## Package Info

- **Name**: `@mc-server-manager/shared`
- **Entry**: `src/index.ts` (single file, all exports)
- **Build**: `tsc` -> `dist/` (must be built before backend)
- **Composite**: `true` (TypeScript project references)

## Structure

```
src/
  index.ts    -- All types, interfaces, constants, and utility functions
```

Everything is in a single file. This is intentional -- the shared surface is small enough that splitting would add complexity without benefit.

## Type Categories

### Server Types
- `ServerType` -- `'vanilla' | 'paper' | 'fabric' | 'forge'`
- `ServerStatus` -- `'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'`
- `Server` -- Database record shape (id, name, type, mcVersion, jarPath, directory, javaPath, jvmArgs, port, autoStart, createdAt, updatedAt)
- `ServerWithStatus` -- `Server` extended with runtime fields (status, playerCount, players, uptime)
- `CreateServerRequest` / `UpdateServerRequest` -- API request shapes

### WebSocket Protocol Types
- `WsMessage` -- Base message with `type` discriminator
- Client -> Server: `WsSubscribe`, `WsUnsubscribe`, `WsCommand`
- Server -> Client: `WsConsoleLine`, `WsConsoleHistory`, `WsStatusChange`, `WsStats`, `WsError`
- Union types: `WsClientMessage`, `WsServerMessage`

### System Types
- `JavaInfo` -- Java detection result (found, path, version)
- `SystemInfo` -- Platform info (platform, arch, memory, CPUs)

### Version/Download Types
- `McVersion` -- Minecraft version entry (id, type, releaseTime)
- `DownloadJob` -- Download progress state (status, progress, bytes, filePath)
- `DownloadRequest` -- Download initiation request
- `MojangVersionManifest` / `MojangVersionEntry` -- Raw Mojang API response shapes

### Server Properties Types
- `PropertyType` -- `'string' | 'number' | 'boolean' | 'select'`
- `PropertyDefinition` -- Metadata for a single server.properties key
- `PropertyGroup` -- Grouped property definitions (gameplay, network, world, advanced)
- `ServerPropertiesResponse` / `UpdateServerPropertiesRequest` -- API shapes

### Settings Types
- `AppSettings` -- App-level settings (javaPath, dataDir, defaultJvmArgs, maxConsoleLines)
- `JvmPreset` -- Predefined JVM argument sets

## Constants

### `JVM_PRESETS`
Five predefined JVM argument presets:
- 2 GB Light, 4 GB Medium, 8 GB Heavy
- 4 GB Aikar's Flags, 8 GB Aikar's Flags (optimized GC for Paper/Spigot)

### `MC_JAVA_COMPAT`
Java version compatibility table for Minecraft versions:
- MC 1.21+ requires Java 21+
- MC 1.17-1.20.x requires Java 17+
- MC 1.0-1.16.x requires Java 8+

## Utility Functions

- `compareMcVersions(a, b)` -- Semver-ish comparison for MC version strings (handles 1.9, 1.20.1, etc.)
- `getMinJavaForMcVersion(mcVersion)` -- Looks up minimum Java version for an MC version
- `getJavaMajorVersion(version)` -- Extracts major version from Java version string (handles both `1.8.0_392` and `21.0.1` formats)
- `checkJavaMcCompat(javaVersion, mcVersion)` -- Returns null if compatible, or a warning message if not

## Conventions

- All exports are named (no default exports)
- Types use `interface` for object shapes, `type` for unions/aliases
- Constants are `UPPER_SNAKE_CASE`
- This package must be built before backend (TypeScript project references enforce this)
- Changes here require rebuilding downstream packages
