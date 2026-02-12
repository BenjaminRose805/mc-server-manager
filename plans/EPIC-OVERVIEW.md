# MC Server Manager — Epic Overview

## Vision

Transform MC Server Manager from a **local server management tool** into a **self-hosted Minecraft community platform**: a Tauri desktop app that launches Minecraft, manages mods, and connects to community "servers" (social hubs) with friends, chat, voice, and shared Minecraft servers.

### User Experience

**Host (server owner):**
- Installs the desktop app, which runs a community server (the existing Express backend, evolved)
- Creates Minecraft servers, installs mods, builds modpacks
- Invites friends via invite links/codes
- Creates text channels and voice channels for their community

**Member (friend):**
- Installs the same desktop app, connects to the host's community server
- Browses shared Minecraft servers, one-click joins with auto-mod-sync
- Uses local launcher features independently (launch MC, manage mods)
- Chats, voice calls, sees who's online

### Architecture Evolution

```
CURRENT (Implemented)
=====================
Browser SPA ──HTTP/WS──► Express Backend ──► SQLite
                              │
                              └──► Java child processes (MC servers)


FUTURE (Full Vision)
====================
┌─────────────────────────────────┐
│  Tauri Desktop App              │
│  ┌───────────────────────────┐  │
│  │ React Frontend            │  │  ◄── Existing UI, evolved
│  └───────────┬───────────────┘  │
│              │ Tauri IPC        │
│  ┌───────────▼───────────────┐  │
│  │ Tauri Core (Rust)         │  │  ◄── Local operations:
│  │ • MC client launching     │  │      game launching, file I/O,
│  │ • Java management         │  │      mod management, MS auth
│  │ • Local file management   │  │
│  └───────────────────────────┘  │
└──────────┬──────────────────────┘
           │ HTTPS/WSS (remote)
           ▼
┌──────────────────────────────────┐
│  Community Server (self-hosted)  │  ◄── The HOST runs this
│  Express Backend (existing +)    │
│  • User accounts & auth         │
│  • Friends, presence            │
│  • Text chat (WebSocket)        │
│  • MC server management         │
│  • Permission system            │
│  ├───► SQLite (users, chat, etc)│
│  ├───► Java child processes     │
│  └───► LiveKit (voice server)   │  ◄── Sidecar or separate
└──────────────────────────────────┘
```

**Two modes coexist in every desktop app:**
- **Local mode** — Manages local MC installations, launches the game, manages mods. Works offline, no server needed.
- **Connected mode** — Connects to a community server for social features and shared MC servers.

---

## Epic Plan Files

Each epic has its own detailed plan file. They are designed to be implementable independently (respecting the dependency graph).

| Epic | File | Summary |
|------|------|---------|
| 1 | [EPIC-1-tauri-desktop.md](./EPIC-1-tauri-desktop.md) | Migrate from browser SPA to Tauri desktop app |
| 2 | [EPIC-2-server-mods.md](./EPIC-2-server-mods.md) | Mod loader installation, mod management, and full modpack support for servers |
| 3 | [EPIC-3-client-launcher.md](./EPIC-3-client-launcher.md) | Full Minecraft client launcher (MS auth, version management, game launching) |
| 4 | [EPIC-4-client-mods.md](./EPIC-4-client-mods.md) | Mod management for client instances (mirrors Epic 2 patterns) |
| 5 | [EPIC-5-multi-user.md](./EPIC-5-multi-user.md) | User accounts, authentication, networking, permissions |
| 6 | [EPIC-6-friends-chat.md](./EPIC-6-friends-chat.md) | Friends system, presence, text chat channels |
| 7 | [EPIC-7-shared-servers.md](./EPIC-7-shared-servers.md) | Shared Minecraft server access, server browser, access control |
| 8 | [EPIC-8-voice.md](./EPIC-8-voice.md) | Voice communication via LiveKit |
| 9 | [EPIC-9-mod-sync.md](./EPIC-9-mod-sync.md) | Server-client mod synchronization on join |

---

## Dependency Graph

```
Epic 1 (Tauri Desktop)
  │
  ├──► Epic 2 (Server Mods) ◄── can start ASAP, servers already exist
  │
  ├──► Epic 3 (Client Launcher)
  │      │
  │      └──► Epic 4 (Client Mods)
  │
  └──► Epic 5 (Multi-User Foundation)
         │
         ├──► Epic 6 (Friends & Chat)
         │
         ├──► Epic 7 (Shared Servers)
         │      │
         │      └──► Epic 9 (Mod Sync) ◄── also needs Epic 2 + Epic 4
         │
         └──► Epic 8 (Voice)
```

### Parallelization Opportunities

After Epic 1 (Tauri) is complete:
- **Epic 2** (server mods) and **Epic 3** (client launcher) are fully independent — can run in parallel
- **Epic 5** (multi-user) can start in parallel with Epics 2-4 if desired

After Epic 5 (multi-user) is complete:
- **Epics 6, 7, and 8** are independent of each other — can run in parallel

**Epic 9** (mod sync) is the capstone — it requires Epics 2, 4, and 7.

---

## Recommended Execution Order

| Order | Epic | Rationale |
|-------|------|-----------|
| 1st | **Epic 1: Tauri Desktop** | Foundation. Unblocks everything. Relatively contained. |
| 2nd | **Epic 2: Server Mods** | Builds on existing server infrastructure. High standalone value. |
| 3rd | **Epic 3: Client Launcher** | Big but independent. Core product differentiator. |
| 4th | **Epic 4: Client Mods** | Natural extension of Epic 2 patterns applied to client instances. |
| 5th | **Epic 5: Multi-User** | The platform pivot. Biggest architectural change. |
| 6th | **Epic 6: Friends & Chat** | First social feature. Extends existing WebSocket infrastructure. |
| 7th | **Epic 7: Shared Servers** | Connects community + MC servers. Enables one-click join. |
| 8th | **Epic 8: Voice** | Cherry on top. LiveKit handles the heavy lifting. |
| 9th | **Epic 9: Mod Sync** | Polish. Auto-syncs mods when joining a shared server. |

---

## Distribution Plan (Future)

This is noted for architectural awareness — decisions now should not block this future.

- **Phase A (Now)**: Build and share with friends. Direct `.msi`/`.dmg`/`.AppImage` downloads from GitHub Releases.
- **Phase B (Later)**: Company website, public distribution, code signing, auto-update via Tauri's built-in updater.
- **Phase C (Future)**: Potential paid features (premium community features, cloud backup, etc.)

Architectural implications:
- Code signing will be needed eventually (Tauri supports this in the build pipeline)
- Auto-update should be designed in from Epic 1 but can be wired up later
- The app should work without any central service (fully self-hosted)
- Microsoft Azure app registration is needed for MC auth (Epic 3) — capacity limits may matter at scale

---

## Cross-Cutting Concerns

These apply across multiple epics and should be kept in mind during each:

### Security
- TLS/HTTPS is mandatory once network-facing (Epic 5)
- All user input validated (Zod — already established)
- Path traversal protection for any file access (established in PHASE2_PLAN)
- Rate limiting on public-facing endpoints (Epic 5)
- Token-based auth with proper expiry and refresh (Epic 5)

### Cross-Platform
- Windows, macOS, Linux support (Tauri handles this)
- Java path detection across platforms (already implemented)
- File path handling via `path.join()` (already established)

### Data Migration
- Each epic that changes the DB schema must include migrations
- Migrations must be backward-compatible within a major version
- The custom migration runner (already built) handles this

### Performance
- Ring buffer pattern (1000 lines) for console output — already established
- Virtualized rendering for long lists — already established
- WebSocket batching for high-volume events — already established
- These patterns should be applied to new features (chat messages, mod lists, etc.)
