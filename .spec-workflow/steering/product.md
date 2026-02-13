# Product Overview

## Product Purpose

MC Server Manager is a self-hosted application for managing Minecraft Java Edition servers. It provides a browser-based dashboard and an Electron desktop app to create, configure, start/stop, and monitor Minecraft servers running on the local machine or home server.

The product is evolving from a single-user server management tool into a **self-hosted community platform** that supports multiple users, social features, and game launching -- a private alternative to public Minecraft server hosting services.

## Target Users

### Primary: Self-Hosting Server Operators
- Technically capable enough to run a home server or VPS
- Want a GUI instead of SSH + command line for server management
- Run 1-5 Minecraft servers for their friend group or small community
- Expect things to "just work" after initial setup

### Secondary: Community Members (Players)
- Friends/players invited by the server operator
- Use the desktop app to launch Minecraft and chat
- Not necessarily technical -- need simple UX
- Care about: joining games, chatting with friends, seeing who's online

## Key Features

### Implemented
1. **Server Management**: Create, configure, start/stop, restart Minecraft Java servers via web dashboard
2. **Live Console**: Real-time server console with command input (WebSocket-based, virtualized rendering with @tanstack/react-virtual)
3. **Server Properties Editor**: Edit server.properties through the UI
4. **Multi-Server Support**: Run multiple servers simultaneously, each with independent configuration
5. **System Monitoring**: Java detection, system info, server status tracking
6. **Server Mod Management**: Search Modrinth, install/update/remove server mods, dependency resolution, modpack import/export (.mrpack)
7. **Electron Desktop App**: Window management, system tray, close-to-tray, backend lifecycle management
8. **Microsoft Auth + Game Launching**: Sign in with Microsoft account (device code flow), launch Minecraft from the app, manage game instances and versions
9. **Client Mod Management**: Manage client-side mods on game instances, Modrinth search, dependency resolution, modpack support
10. **Multi-User Foundation**: User registration (invite-only), roles (owner/admin/member), JWT auth with refresh tokens, per-server permissions, TLS/HTTPS, rate limiting, CORS, brute-force protection

### In Progress (Specs ready, implementation pending)
- **Friends & Text Chat** (18 tasks): Friend requests, presence tracking (online/in-game/offline), text channels, direct messages, desktop notifications
- **Shared Minecraft Servers** (17 tasks): Share servers with community members, permission model (view/join/manage/admin), whitelist sync, server browser
- **Voice Communication** (15 tasks): LiveKit-based voice channels, push-to-talk, mute/deafen, speaking indicators, audio device selection
- **Mod Sync** (11 tasks): Auto-synchronize mods when joining a shared server, hash verification, trusted source validation, one-click join

### Pipeline (Spec started, design pending)
- **Electron Desktop Builds**: CI/CD pipeline for cross-platform Electron installers via GitHub Actions

## Business Objectives

- **Self-hosted first**: Users own their data and infrastructure. No SaaS dependencies.
- **Community-oriented**: Build features that make small Minecraft communities thrive (chat, friends, shared servers)
- **Desktop + Web**: Full functionality in the browser, enhanced experience in the Electron desktop app (auth, game launching, notifications)
- **Single codebase**: TypeScript everywhere (no Rust, no polyglot complexity)

## Success Metrics

- Feature completeness against the phased build plan (PLAN.md)
- Reliability of server management (zero orphaned processes, clean shutdown)
- Smooth multi-user experience (invite-to-playing flow under 5 minutes)
- Cross-platform desktop builds (Linux, macOS, Windows)

## Product Principles

1. **Self-hosted simplicity**: Setup should be `npm install && npm run dev`. No Docker required, no external services.
2. **Graceful degradation**: Every feature that requires Electron (auth, game launch) must degrade gracefully in the browser with a clear message.
3. **Single-user backward compatibility**: The multi-user system must not break the experience for someone running the app solo without setting up accounts.
4. **Real-time by default**: Server status, console output, chat messages, and presence are all live via WebSocket. No polling.
5. **Dark theme**: The entire UI uses a consistent dark theme (slate-800/900). No light mode.
6. **Minimal external dependencies**: Prefer built-in Node.js/Electron APIs over adding npm packages. When packages are needed, prefer well-maintained, focused libraries.

## Platform & Distribution

- **Web Dashboard**: Accessible at `http://localhost:5173` (dev) or served by the backend in production
- **Electron Desktop App**: Packaged via electron-builder for Windows (NSIS), macOS (DMG), Linux (AppImage + DEB)
- **Backend**: Express server running on the same machine as the Minecraft servers (port 3001)
- **No Cloud**: Everything runs locally. Network access is opt-in (TLS, UPnP port forwarding for friends to connect)

## Future Vision

### Near-term (current spec backlog)
- Complete social features (friends, chat, voice)
- Mod synchronization between server and clients on join
- Shared server management with role-based permissions
- Automated cross-platform desktop builds via GitHub Actions

### Longer-term (not yet specified)
- **Backup & Restore**: Scheduled world backups with point-in-time recovery
- **Plugin Management**: Browse, install, and update server plugins from the dashboard
- **Scheduled Tasks**: Restart schedules, backup schedules, announcement schedules
- **Remote Access**: Tunnel/relay for accessing the dashboard without port forwarding
- **Analytics**: Player activity, server performance graphs, uptime tracking

## Epic Dependency Chain

```
Epic 1: Server Management (MVP) ✅
Epic 2: Server Mod Management ✅
  └── depends on: Epic 1
Epic 3: Client Launcher ✅ (reimplemented in Electron)
  └── depends on: Desktop Shell
Epic 4: Client Mod Management ✅ (reimplemented in Electron)
  └── depends on: Epic 2, Epic 3
Epic 5: Multi-User Foundation ✅
  └── depends on: Epic 1
Epic 6: Friends & Text Chat 🔜
  └── depends on: Epic 5
Epic 7: Shared Minecraft Servers 🔜
  └── depends on: Epic 5, optionally Epic 3
Epic 8: Voice Communication 🔜
  └── depends on: Epic 5
Epic 9: Mod Sync 🔜
  └── depends on: Epic 2, Epic 4, Epic 7
```
