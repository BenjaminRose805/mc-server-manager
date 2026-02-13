# Product Overview

<!--
  MC Server Manager -- Product Steering Template
  
  This template is pre-seeded with MC Server Manager context.
  When creating the actual steering doc, fill in the bracketed sections
  and update any information that has changed since this template was written.
-->

## Product Purpose

MC Server Manager is a self-hosted application for managing Minecraft Java Edition servers. It provides a browser-based dashboard and an Electron desktop app to create, configure, start/stop, and monitor Minecraft servers running on the local machine or home server.

The product is evolving from a single-user server management tool into a **self-hosted community platform** that supports multiple users, social features, and game launching -- a private alternative to public Minecraft server hosting services.

[Update with any shifts in product direction since this template was written]

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

[Update if user personas have shifted]

## Key Features

### Implemented
1. **Server Management**: Create, configure, start/stop, restart Minecraft Java servers via web dashboard
2. **Live Console**: Real-time server console with command input (WebSocket-based, virtualized rendering)
3. **Server Properties Editor**: Edit server.properties through the UI
4. **Multi-Server Support**: Run multiple servers simultaneously, each with independent configuration
5. **System Monitoring**: Java detection, system info, server status tracking
6. **Electron Desktop App**: Window management, system tray, close-to-tray, backend lifecycle
7. **Microsoft Auth + Game Launching**: Sign in with Microsoft account, launch Minecraft from the app
8. **Multi-User Foundation**: User registration (invite-only), roles (owner/admin/member), JWT auth, per-server permissions, TLS/HTTPS, rate limiting

### Planned / In Progress
- **Friends & Text Chat**: Friend requests, presence tracking, text channels, DMs
- **Mod Sync**: Synchronize mod packs between server and connected clients
- **Shared Minecraft Servers**: Multiple users managing the same servers with permissions
- **Voice Communication**: In-app voice chat between players
- **Client Mod Management**: Manage and install client-side mods

[Update as features are completed or new features are planned]

## Business Objectives

- **Self-hosted first**: Users own their data and infrastructure. No SaaS dependencies.
- **Community-oriented**: Build features that make small Minecraft communities thrive (chat, friends, shared servers)
- **Desktop + Web**: Full functionality in the browser, enhanced experience in the Electron desktop app (auth, game launching, notifications)
- **Single codebase**: TypeScript everywhere (no Rust, no polyglot complexity)

## Success Metrics

- [Define what "success" means for this project. Since it's a personal/community project, metrics might include: feature completeness against the plan, reliability of server management, user adoption within the target community]

## Product Principles

1. **Self-hosted simplicity**: Setup should be `npm install && npm run dev`. No Docker required, no external services.
2. **Graceful degradation**: Every feature that requires Electron (auth, game launch) must degrade gracefully in the browser with a clear message.
3. **Single-user backward compatibility**: The multi-user system must not break the experience for someone running the app solo without setting up accounts.
4. **Real-time by default**: Server status, console output, chat messages, and presence are all live via WebSocket. No polling.
5. **Dark theme**: The entire UI uses a consistent dark theme (slate-800/900). No light mode.

## Platform & Distribution

- **Web Dashboard**: Accessible at `http://localhost:5173` (dev) or served by the backend in production
- **Electron Desktop App**: Packaged via electron-builder for Windows, macOS, Linux
- **Backend**: Express server running on the same machine as the Minecraft servers
- **No Cloud**: Everything runs locally. Network access is opt-in (TLS, UPnP port forwarding for friends to connect)

## Future Vision

### Near-term (current spec backlog)
- Complete social features (friends, chat, voice)
- Mod synchronization between server and clients
- Shared server management with role-based permissions

### Longer-term (not yet specified)
- **Backup & Restore**: Scheduled world backups with point-in-time recovery
- **Plugin Management**: Browse, install, and update server plugins from the dashboard
- **Scheduled Tasks**: Restart schedules, backup schedules, announcement schedules
- **Remote Access**: Tunnel/relay for accessing the dashboard without port forwarding
- **Analytics**: Player activity, server performance graphs, uptime tracking

[Update as the roadmap evolves]
