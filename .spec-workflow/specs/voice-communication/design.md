# Design Document -- Voice Communication

## Overview

Add LiveKit-based voice channels to MC Server Manager. Users create voice channels, join them to communicate with low-latency audio via WebRTC. LiveKit runs as a sidecar Go binary managed by Tauri, handling all WebRTC complexity (SFU, TURN, codec negotiation). The backend generates short-lived JWT tokens for LiveKit access. The frontend uses the livekit-client SDK to connect, publish microphone audio, and subscribe to remote audio tracks. Push-to-talk is implemented via Tauri global shortcuts. Audio-only for v1.

## Steering Document Alignment

No steering docs exist. This design follows existing project conventions (Express routes, Zod validation, SQLite models, Zustand stores, Tailwind UI) and adds LiveKit as a new infrastructure component managed identically to the backend sidecar.

## Code Reuse Analysis

### Existing Components to Leverage
- **Auth middleware (`packages/backend/src/middleware/auth.ts`)**: All voice routes require `requireAuth`. Token generation validates user session.
- **Error classes (`packages/backend/src/utils/errors.ts`)**: `NotFoundError` for missing channels, `ValidationError` for bad input. Standard Express error middleware catches these.
- **Zod validation**: All voice route handlers use Zod schemas following existing patterns.
- **Settings model**: LiveKit credentials and port configuration stored in existing `settings` key-value table. Reuse `getSetting`/`setSetting` functions.
- **Zustand store pattern (`packages/frontend/src/stores/serverStore.ts`)**: Pattern for new `voiceStore.ts`. LiveKit room events write directly to store.
- **Pino logger**: Existing logger for LiveKit lifecycle and voice event logging.
- **Tauri sidecar pattern (`packages/desktop/src-tauri/src/lib.rs`)**: LiveKit sidecar follows the identical spawn/kill pattern as the backend sidecar.
- **API client pattern (`packages/frontend/src/api/client.ts`)**: Voice API client follows existing fetch wrapper patterns with Authorization header.

### Integration Points
- **`users` table**: Foreign key target for voice_channels.created_by. User identity and display name used in LiveKit tokens.
- **Express app (`app.ts`)**: Mount new voice routes at `/api/voice`.
- **Tauri `lib.rs`**: Add LiveKit sidecar spawn alongside backend sidecar. Add to AppState. Update quit handler.
- **Tauri `tauri.conf.json`**: Register livekit-server in externalBin array.
- **Backend `index.ts`**: Generate LiveKit config YAML on startup, ensure credentials exist.
- **Frontend routing**: Voice UI components integrated into existing layout.

## Architecture

### LiveKit Data Flow

```
User clicks "Join Voice Channel"
  --> Frontend: POST /api/voice/token with channelId
  --> Backend: validates session, validates channel exists
  --> Backend: generates LiveKit JWT (livekit-server-sdk AccessToken)
  --> Backend: returns token + wsUrl to frontend
  --> Frontend: room = new Room(); room.connect(wsUrl, token)
  --> Frontend: room.localParticipant.setMicrophoneEnabled(true)
  --> LiveKit SFU: forwards audio tracks to all room participants
  --> Remote participants: receive audio via WebRTC, auto-attached to DOM
```

### Sidecar Lifecycle

```
Tauri app starts
  --> spawn backend sidecar (port 3001)
  --> backend writes livekit-config.yaml (credentials, ports)
  --> spawn livekit-server sidecar (reads config, port 7880)
  --> LiveKit ready for WebRTC connections

Tauri app quits
  --> kill LiveKit sidecar first
  --> kill backend sidecar (stops MC servers)
  --> exit
```

### Token Security Model

```
Frontend (no LiveKit credentials)
   --> POST /api/voice/token (with session cookie/JWT)
   --> Backend (holds API key + secret)
   --> generates scoped LiveKit JWT (room-specific, 6h TTL)
   --> Frontend uses token to connect to LiveKit
   --> LiveKit validates token signature against configured API key
```

Note: wsUrl is derived from the server's configured domain/IP and TLS mode. Returns wss:// when TLS is enabled, ws:// otherwise. Never hardcoded to localhost.

## Components and Interfaces

### Component 1: LiveKit Config Service (`packages/backend/src/services/livekit-config.ts`)
- **Purpose**: Generate LiveKit YAML configuration file and manage API credentials
- **Interfaces**: `generateLiveKitConfig(config, outputPath)`, `generateApiCredentials()`, `ensureLiveKitCredentials()`
- **Dependencies**: Node fs, crypto, settings model
- **Reuses**: Settings model for credential storage

### Component 2: Voice Channel Model (`packages/backend/src/models/voice-channel.ts`)
- **Purpose**: CRUD for voice_channels table
- **Interfaces**: `getAllVoiceChannels()`, `getVoiceChannelById(id)`, `createVoiceChannel(name, createdBy, options)`, `updateVoiceChannel(id, updates)`, `deleteVoiceChannel(id)`
- **Dependencies**: Database module, nanoid
- **Reuses**: Existing model patterns (prepared statements, snake_case columns)

### Component 3: Voice Token Service (`packages/backend/src/services/voice-token.ts`)
- **Purpose**: Generate LiveKit access tokens for authenticated users
- **Interfaces**: `generateVoiceToken(userId, username, channelId): Promise with token and wsUrl to frontend (wsUrl derived from configured server address and TLS mode, NOT hardcoded localhost)`
- **Dependencies**: livekit-server-sdk AccessToken, settings model, voice channel model
- **Reuses**: Settings model for API credentials

### Component 4: Voice Routes (`packages/backend/src/routes/voice.ts`)
- **Purpose**: REST API for voice channel CRUD and token generation
- **Endpoints**: `GET /api/voice/channels`, `POST /api/voice/channels`, `PATCH /api/voice/channels/:id`, `DELETE /api/voice/channels/:id`, `POST /api/voice/token`
- **POST /token**: Validates user is active and channel is not at capacity before issuing token.
- **Dependencies**: Voice channel model, voice token service, auth middleware, Zod
- **Reuses**: Route handler patterns, Zod validation, auth middleware

### Component 5: Voice Store (`packages/frontend/src/stores/voiceStore.ts`)
- **Purpose**: Zustand store for voice state -- channels, current room, participants, mute/deafen, connection status
- **Interfaces**: `setChannels`, `joinChannel(channelId, token, wsUrl)`, `leaveChannel`, `toggleMute`, `toggleDeafen`, `setParticipantSpeaking`, `setParticipantAudioLevel`
- **Dependencies**: Zustand, livekit-client Room
- **Reuses**: Store pattern from serverStore.ts

### Component 6: Voice API Client (`packages/frontend/src/api/voice.ts`)
- **Purpose**: Frontend API layer for voice endpoints
- **Interfaces**: `getVoiceChannels()`, `createVoiceChannel(name, options)`, `deleteVoiceChannel(id)`, `getVoiceToken(channelId)`
- **Dependencies**: API client base
- **Reuses**: Fetch wrapper patterns from existing API clients

### Component 7: VoiceChannelList Component (`packages/frontend/src/components/voice/VoiceChannelList.tsx`)
- **Purpose**: Sidebar listing all voice channels with join/leave buttons, active participants, and audio controls
- **Dependencies**: voiceStore, voice API client, lucide-react icons (Volume2, VolumeX, Headphones, Mic, MicOff, PhoneOff, Plus)
- **Reuses**: Tailwind dark theme patterns, lucide-react icons

### Component 8: VoiceSettings Component (`packages/frontend/src/components/voice/VoiceSettings.tsx`)
- **Purpose**: Audio device selection UI (input/output device dropdowns)
- **Dependencies**: livekit-client Room.getLocalDevices, voiceStore
- **Reuses**: Tailwind form patterns

### Component 9: Push-to-Talk Hook (`packages/frontend/src/hooks/usePushToTalk.ts`)
- **Purpose**: Listen for Tauri global shortcut events and toggle microphone
- **Dependencies**: @tauri-apps/api/event, voiceStore
- **Reuses**: Tauri event listener pattern

### Component 10: LiveKit Download Script (`packages/desktop/scripts/download-livekit.ts`)
- **Purpose**: Download platform-specific LiveKit server binary during build
- **Dependencies**: Node fetch, fs, child_process (for rustc target detection)
- **Reuses**: None (new build script)

### Component 11: Tauri LiveKit Sidecar (modify `packages/desktop/src-tauri/src/lib.rs`)
- **Purpose**: Spawn and manage LiveKit server process lifecycle
- **Dependencies**: Tauri shell plugin, existing AppState
- **Reuses**: Backend sidecar spawn pattern

## Data Models

### voice_channels table

```sql
CREATE TABLE IF NOT EXISTS voice_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  max_participants INTEGER NOT NULL DEFAULT 50,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
```

### LiveKit settings (in existing settings table)

Settings keys stored as key-value pairs in the existing `settings` table:
- `livekit_api_key` -- API key for token generation (auto-generated)
- `livekit_api_secret` -- API secret for token signing (auto-generated)
- `livekit_port` -- WebSocket port (default 7880)
- `livekit_rtc_tcp_port` -- RTC TCP port (default 7881)
- `livekit_rtc_port_range_start` -- UDP port range start (default 50000)
- `livekit_rtc_port_range_end` -- UDP port range end (default 60000)
- `livekit_domain` -- Optional domain for TURN server (remote access)

### Shared TypeScript Types

```typescript
// Voice channel types
export interface VoiceChannel {
  id: string;
  name: string;
  description: string | null;
  maxParticipants: number;
  position: number;
  createdBy: string;
  createdAt: string;
}

export interface CreateVoiceChannelRequest {
  name: string;
  description?: string;
  maxParticipants?: number;
  position?: number;
}

export interface UpdateVoiceChannelRequest {
  name?: string;
  description?: string;
  maxParticipants?: number;
  position?: number;
}

export interface VoiceTokenRequest {
  channelId: string;
}

export interface VoiceTokenResponse {
  token: string;
  wsUrl: string;
}

// Voice participant (frontend only, derived from LiveKit events)
export interface VoiceParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  audioLevel: number;
}
```

## Error Handling

### Error Scenarios

1. **Token request for non-existent channel**
   - **Handling**: Return 404 NotFoundError. Voice route checks channel exists before generating token.
   - **User Impact**: "Voice channel not found" error toast.

2. **LiveKit credentials not configured**
   - **Handling**: Return 500 Error with message "LiveKit credentials not configured". Should not happen in normal flow since credentials are auto-generated.
   - **User Impact**: Voice features unavailable, error shown in UI.

3. **LiveKit server not running or unreachable**
   - **Handling**: LiveKit client SDK connection fails. Frontend catches error, sets error state in voiceStore.
   - **User Impact**: "Failed to join voice channel" error toast. User can retry.

4. **WebRTC not supported in browser/webview**
   - **Handling**: Check for `navigator.mediaDevices.getUserMedia` at runtime. If unavailable, disable voice features.
   - **User Impact**: Voice channel join buttons disabled with tooltip explaining incompatibility.

5. **Microphone permission denied**
   - **Handling**: LiveKit SDK throws on setMicrophoneEnabled. Frontend catches and shows error.
   - **User Impact**: "Microphone access denied" error toast. User can still listen (subscribe) but not speak.

6. **LiveKit sidecar fails to start**
   - **Handling**: Tauri logs the error. Backend generates config but LiveKit does not start. Token generation succeeds but frontend connection fails.
   - **User Impact**: Voice features unavailable until app restart. Clear error in UI.

7. **Unexpected LiveKit sidecar termination**
   - **Handling**: Tauri logs termination code and signal. Active voice connections drop. Frontend receives Disconnected event, resets voice store.
   - **User Impact**: "Disconnected from voice channel" notification. User can rejoin manually.

## File Structure

### New Files
```
packages/desktop/scripts/download-livekit.ts                 # Download LiveKit binary
packages/backend/migrations/012_voice_channels.sql           # Voice channels table + settings
packages/backend/src/services/livekit-config.ts              # LiveKit config generation
packages/backend/src/services/voice-token.ts                 # LiveKit token generation
packages/backend/src/models/voice-channel.ts                 # Voice channel CRUD model
packages/backend/src/routes/voice.ts                         # Voice REST API
packages/frontend/src/stores/voiceStore.ts                   # Voice Zustand store
packages/frontend/src/api/voice.ts                           # Voice API client
packages/frontend/src/components/voice/VoiceChannelList.tsx  # Voice channel sidebar
packages/frontend/src/components/voice/VoiceSettings.tsx     # Audio device selection
packages/frontend/src/hooks/usePushToTalk.ts                 # Push-to-talk hook
shared/src/index.ts                                          # (modify) Add voice types
```

### Modified Files
```
packages/backend/src/index.ts                                # Generate LiveKit config on startup
packages/backend/src/app.ts                                  # Mount voice routes
packages/backend/src/services/settings.ts                    # ensureLiveKitCredentials()
packages/backend/package.json                                # Add livekit-server-sdk
packages/frontend/package.json                               # Add livekit-client
packages/frontend/src/App.tsx                                # Integrate voice UI
packages/desktop/src-tauri/src/lib.rs                        # LiveKit sidecar + global shortcut
packages/desktop/src-tauri/tauri.conf.json                   # Add livekit-server to externalBin
packages/desktop/src-tauri/Cargo.toml                        # Add global-shortcut plugin
packages/desktop/package.json                                # Add download-livekit script
```

## Dependencies

### New Backend npm Packages
- `livekit-server-sdk` (^2.7.0) -- Server-side LiveKit JWT generation. Required for token endpoint.

### New Frontend npm Packages
- `livekit-client` (^2.6.0) -- LiveKit WebRTC client SDK. Required for connecting to rooms and managing audio tracks.

### New Rust Crates (Tauri)
- `tauri-plugin-global-shortcut` (2.x) -- Global keyboard shortcuts for push-to-talk.

### External Binary
- `livekit-server` (1.7.2+) -- LiveKit SFU binary, downloaded per-platform via build script. Bundled as Tauri sidecar.

## Network Requirements

When voice communication is used with remote users, the following ports must be accessible:

| Port | Protocol | Purpose |
|------|----------|---------|
| 7880 (configurable) | TCP/WebSocket | LiveKit signaling |
| 7881 (configurable) | TCP | RTC over TCP fallback |
| 50000-60000 (configurable) | UDP | WebRTC media streams |

**Firewall Configuration**: These ports must be open on the host's firewall for remote users to connect. If UPnP is enabled (Epic 5), the app will attempt to forward port 7880 automatically. The UDP range is needed for optimal audio quality but the TCP fallback (port 7881) works if UDP is blocked.

**NAT Traversal**: LiveKit includes built-in TURN support. When `livekit_domain` is configured in settings, LiveKit enables its TURN server for NAT traversal. For LAN-only use, TURN is not needed.

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual verification.
- Key verification: token generation with correct grants, voice channel CRUD, config YAML generation.

### Integration Testing
- **LiveKit startup**: Tauri spawns LiveKit, config.yaml generated, server listens on port 7880.
- **Voice channel CRUD**: Create, list, update, delete channels via REST API.
- **Token generation**: Backend generates valid JWT, frontend can connect to LiveKit with it.
- **Join/leave flow**: Join channel, see participant list update, leave channel, participant removed.
- **Audio transmission**: Speak into mic, other participants hear audio with low latency (at most 200ms).
- **Mute/deafen**: Mute stops outgoing audio, deafen stops incoming audio, UI reflects state.
- **Speaking indicators**: Active speakers show green pulsing indicator in real-time.
- **Push-to-talk**: Ctrl+Space unmutes while held, re-mutes on release (even when app unfocused).
- **Device selection**: Switch input/output devices without disconnecting from room.
- **Graceful shutdown**: Close app, LiveKit process killed, voice connections dropped cleanly.

### End-to-End Testing
- Full voice flow: Authenticate, create channel, join channel, verify audio works between two participants, mute/unmute, leave channel, delete channel.
- Multi-participant: 5+ users in same channel, all audio streams working, speaking indicators correct.
- Cross-platform: Test on macOS (WKWebView), Windows (WebView2), Linux (WebKitGTK 4.1+).
- Error recovery: Kill LiveKit mid-session, verify frontend shows error, rejoin works after restart.
