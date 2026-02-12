# Epic 8 — Voice Communication

> **Prerequisite for**: Epic 9 (Mod Sync) — voice channels enhance the shared server experience
> **Standalone value**: Discord-like voice chat for your gaming group, fully self-hosted
> **Dependencies**: Epic 5 (Multi-User) for authentication and user management

---

## Executive Summary

Add Discord-like voice channels to MC Server Manager using LiveKit, an open-source WebRTC infrastructure. Users can create voice channels, join/leave them, and communicate with low-latency audio. LiveKit runs as a sidecar process alongside the Express backend, handling all WebRTC complexity (NAT traversal, codec negotiation, adaptive bitrate, echo cancellation).

### Key Decisions

- **LiveKit over custom WebRTC**: LiveKit is production-grade, handles TURN/STUN, scales to 50+ participants, and has excellent client SDKs. Building this from scratch would take months.
- **Audio-only for v1**: Video calling and screen sharing are deferred to future versions. Voice chat is the core use case for gaming communities.
- **Sidecar deployment**: LiveKit server runs as a separate Go binary managed by Tauri, similar to the Express backend. Single-binary deployment, no Docker required.
- **JWT-based access**: Backend generates short-lived LiveKit tokens using `livekit-server-sdk`. No direct client-to-LiveKit auth.
- **Push-to-talk via Tauri**: Global keyboard shortcuts (e.g., `Ctrl+Space`) for push-to-talk, even when the app is not focused.

---

## Architecture

### Current Architecture (Post-Epic 5)
```
Tauri Desktop App
├── React Frontend
├── Express Backend (port 3001)
│   ├── User auth & sessions
│   ├── Friends, presence
│   └── Text chat (WebSocket)
└── SQLite
```

### Target Architecture
```
Tauri Desktop App
├── React Frontend
│   └── LiveKit JS Client SDK
│       └── WebRTC (audio tracks)
├── Express Backend (port 3001)
│   ├── User auth & sessions
│   ├── Voice channel CRUD
│   └── LiveKit token generation
├── LiveKit Server (sidecar, port 7880 WSS)
│   ├── WebRTC SFU (Selective Forwarding Unit)
│   ├── TURN server (NAT traversal)
│   └── Ports 50000-60000 UDP (media)
└── SQLite
    └── voice_channels table
```

**Data flow:**
1. User clicks "Join Voice Channel" in frontend
2. Frontend requests token: `POST /api/voice/token { channelId }`
3. Backend validates user session, generates JWT with `livekit-server-sdk`
4. Frontend connects to LiveKit: `room.connect(wsUrl, token)`
5. Frontend publishes microphone: `room.localParticipant.setMicrophoneEnabled(true)`
6. LiveKit forwards audio to all other participants in the room

---

## Phase 8A: LiveKit Server Deployment

### 8A.1: Download and bundle LiveKit server binary

LiveKit distributes single-binary releases for all platforms. Download the appropriate binary for each target platform and bundle it with Tauri.

Create `packages/desktop/scripts/download-livekit.ts`:

```typescript
import { execSync } from 'child_process';
import { createWriteStream, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const LIVEKIT_VERSION = '1.7.2'; // Update as needed

const TARGETS = {
  'x86_64-unknown-linux-gnu': 'livekit_1.7.2_linux_amd64',
  'aarch64-unknown-linux-gnu': 'livekit_1.7.2_linux_arm64',
  'x86_64-apple-darwin': 'livekit_1.7.2_darwin_amd64',
  'aarch64-apple-darwin': 'livekit_1.7.2_darwin_arm64',
  'x86_64-pc-windows-msvc': 'livekit_1.7.2_windows_amd64.exe',
} as const;

const rustTarget = execSync('rustc -Vv')
  .toString()
  .match(/host: (.+)/)?.[1]
  ?.trim() ?? '';

const livekitBinary = TARGETS[rustTarget as keyof typeof TARGETS];
if (!livekitBinary) {
  throw new Error(`Unsupported target: ${rustTarget}`);
}

const binariesDir = join(__dirname, '../src-tauri/binaries');
mkdirSync(binariesDir, { recursive: true });

const url = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${livekitBinary}`;
const outputPath = join(binariesDir, `livekit-server-${rustTarget}${process.platform === 'win32' ? '.exe' : ''}`);

console.log(`Downloading LiveKit server from ${url}...`);

async function download() {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
  
  const fileStream = createWriteStream(outputPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
  
  // Make executable on Unix
  if (process.platform !== 'win32') {
    chmodSync(outputPath, 0o755);
  }
  
  console.log(`LiveKit server downloaded: ${outputPath}`);
}

download();
```

Add to `packages/desktop/package.json`:
```json
{
  "scripts": {
    "download-livekit": "tsx scripts/download-livekit.ts"
  }
}
```

### 8A.2: LiveKit configuration file

LiveKit requires a `config.yaml` file. Generate it at runtime based on app settings.

Create `packages/backend/src/services/livekit-config.ts`:

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export interface LiveKitConfig {
  port: number;
  rtcTcpPort: number;
  rtcPortRangeStart: number;
  rtcPortRangeEnd: number;
  apiKey: string;
  apiSecret: string;
  domain?: string; // For TURN server (optional, for remote access)
}

export function generateLiveKitConfig(config: LiveKitConfig, outputPath: string): void {
  const yaml = `
port: ${config.port}
rtc:
  tcp_port: ${config.rtcTcpPort}
  port_range_start: ${config.rtcPortRangeStart}
  port_range_end: ${config.rtcPortRangeEnd}
  use_external_ip: true
turn:
  enabled: ${config.domain ? 'true' : 'false'}
  ${config.domain ? `domain: ${config.domain}` : ''}
  tls_port: 3478
keys:
  ${config.apiKey}: ${config.apiSecret}
logging:
  level: info
  sample: false
`.trim();

  writeFileSync(outputPath, yaml, 'utf-8');
}

export function generateApiCredentials(): { apiKey: string; apiSecret: string } {
  return {
    apiKey: `api_${randomBytes(16).toString('hex')}`,
    apiSecret: randomBytes(32).toString('base64'),
  };
}
```

### 8A.3: Store LiveKit credentials in settings

Extend the `settings` table to store LiveKit API credentials. These are generated once on first run.

Migration `packages/backend/migrations/008_voice_channels.sql`:

```sql
-- Voice channels table
CREATE TABLE IF NOT EXISTS voice_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  max_participants INTEGER NOT NULL DEFAULT 50,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- LiveKit settings (stored in settings table)
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('livekit_api_key', ''),
  ('livekit_api_secret', ''),
  ('livekit_port', '7880'),
  ('livekit_rtc_tcp_port', '7881'),
  ('livekit_rtc_port_range_start', '50000'),
  ('livekit_rtc_port_range_end', '60000');
```

### 8A.4: Initialize LiveKit credentials on first run

Modify `packages/backend/src/services/settings.ts`:

```typescript
import { generateApiCredentials } from './livekit-config.js';

export async function ensureLiveKitCredentials(): Promise<void> {
  const apiKey = await getSetting('livekit_api_key');
  
  if (!apiKey || apiKey === '') {
    const { apiKey: newKey, apiSecret: newSecret } = generateApiCredentials();
    await setSetting('livekit_api_key', newKey);
    await setSetting('livekit_api_secret', newSecret);
    logger.info('Generated new LiveKit API credentials');
  }
}
```

Call this in `packages/backend/src/index.ts` during startup:

```typescript
import { ensureLiveKitCredentials } from './services/settings.js';

// After database initialization
await ensureLiveKitCredentials();
```

**Files created**: `packages/desktop/scripts/download-livekit.ts`, `packages/backend/src/services/livekit-config.ts`, `packages/backend/migrations/008_voice_channels.sql`
**Files modified**: `packages/backend/src/services/settings.ts`, `packages/backend/src/index.ts`, `packages/desktop/package.json`

---

## Phase 8B: Tauri LiveKit Sidecar Management

### 8B.1: Spawn LiveKit server from Tauri

Similar to the backend sidecar, Tauri spawns and manages the LiveKit server process.

Modify `packages/desktop/src-tauri/src/lib.rs`:

```rust
use std::path::PathBuf;
use std::fs;

struct AppState {
    backend_child: Mutex<Option<CommandChild>>,
    livekit_child: Mutex<Option<CommandChild>>, // NEW
}

fn spawn_livekit(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();
    let data_dir = app.path().app_data_dir()?;
    
    // LiveKit config path
    let config_path = data_dir.join("livekit-config.yaml");
    
    // Wait for backend to generate config (backend writes this file on startup)
    // Poll for up to 10 seconds
    for _ in 0..20 {
        if config_path.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    
    if !config_path.exists() {
        return Err("LiveKit config not generated by backend".into());
    }
    
    let sidecar = shell
        .sidecar("binaries/livekit-server")
        .expect("Failed to create LiveKit sidecar command")
        .args(["--config", config_path.to_str().unwrap()]);
    
    let (mut rx, child) = sidecar.spawn()?;
    
    let state = app.state::<AppState>();
    *state.livekit_child.lock().unwrap() = Some(child);
    
    // Forward logs
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[livekit] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[livekit] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(
                        "LiveKit process terminated: code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                }
                _ => {}
            }
        }
    });
    
    Ok(())
}

// In setup():
spawn_backend(app.handle())?;
spawn_livekit(app.handle())?; // NEW
```

### 8B.2: Backend writes LiveKit config on startup

Modify `packages/backend/src/index.ts`:

```typescript
import { generateLiveKitConfig } from './services/livekit-config.js';
import { join } from 'path';

// After ensureLiveKitCredentials()
const livekitConfig = {
  port: parseInt(await getSetting('livekit_port') || '7880'),
  rtcTcpPort: parseInt(await getSetting('livekit_rtc_tcp_port') || '7881'),
  rtcPortRangeStart: parseInt(await getSetting('livekit_rtc_port_range_start') || '50000'),
  rtcPortRangeEnd: parseInt(await getSetting('livekit_rtc_port_range_end') || '60000'),
  apiKey: await getSetting('livekit_api_key') || '',
  apiSecret: await getSetting('livekit_api_secret') || '',
  domain: await getSetting('livekit_domain'), // Optional, for remote access
};

const configPath = join(process.env.TAURI_DATA_DIR || './data', 'livekit-config.yaml');
generateLiveKitConfig(livekitConfig, configPath);
logger.info(`LiveKit config written to ${configPath}`);
```

### 8B.3: Graceful shutdown

Update the quit handler in `lib.rs` to kill both sidecars:

```rust
// In tray menu "quit" handler:
let state = app.state::<AppState>();

// Kill LiveKit first
if let Some(child) = state.livekit_child.lock().unwrap().take() {
    let _ = child.kill();
}

// Then backend (which stops MC servers)
if let Some(child) = state.backend_child.lock().unwrap().take() {
    let _ = child.kill();
}

app.exit(0);
```

### 8B.4: Update Tauri config

Add LiveKit binary to `tauri.conf.json`:

```json
{
  "bundle": {
    "externalBin": [
      "binaries/mc-server-backend",
      "binaries/livekit-server"
    ]
  }
}
```

**Files modified**: `packages/desktop/src-tauri/src/lib.rs`, `packages/backend/src/index.ts`, `packages/desktop/src-tauri/tauri.conf.json`

---

## Phase 8C: Backend Voice Channel API

### 8C.1: Voice channel model

Create `packages/backend/src/models/voice-channel.ts`:

```typescript
import { db } from '../database.js';
import { nanoid } from 'nanoid';

export interface VoiceChannel {
  id: string;
  name: string;
  description: string | null;
  max_participants: number;
  position: number;
  created_by: string;
  created_at: number;
}

export function getAllVoiceChannels(): VoiceChannel[] {
  const stmt = db.prepare('SELECT * FROM voice_channels ORDER BY position ASC, created_at ASC');
  return stmt.all() as VoiceChannel[];
}

export function getVoiceChannelById(id: string): VoiceChannel | null {
  const stmt = db.prepare('SELECT * FROM voice_channels WHERE id = ?');
  return stmt.get(id) as VoiceChannel | null;
}

export function createVoiceChannel(
  name: string,
  createdBy: string,
  options?: { description?: string; maxParticipants?: number; position?: number }
): VoiceChannel {
  const id = nanoid();
  const now = Date.now();
  
  const stmt = db.prepare(`
    INSERT INTO voice_channels (id, name, description, max_participants, position, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    name,
    options?.description || null,
    options?.maxParticipants || 50,
    options?.position || 0,
    createdBy,
    now
  );
  
  return getVoiceChannelById(id)!;
}

export function deleteVoiceChannel(id: string): void {
  const stmt = db.prepare('DELETE FROM voice_channels WHERE id = ?');
  stmt.run(id);
}

export function updateVoiceChannel(
  id: string,
  updates: { name?: string; description?: string; maxParticipants?: number; position?: number }
): void {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.maxParticipants !== undefined) {
    fields.push('max_participants = ?');
    values.push(updates.maxParticipants);
  }
  if (updates.position !== undefined) {
    fields.push('position = ?');
    values.push(updates.position);
  }
  
  if (fields.length === 0) return;
  
  values.push(id);
  const stmt = db.prepare(`UPDATE voice_channels SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}
```

### 8C.2: Voice channel routes

Create `packages/backend/src/routes/voice.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import * as VoiceChannelModel from '../models/voice-channel.js';
import { AccessToken } from 'livekit-server-sdk';
import { getSetting } from '../services/settings.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

const router = Router();

// All voice routes require authentication
router.use(requireAuth);

// List all voice channels
router.get('/channels', (req, res) => {
  const channels = VoiceChannelModel.getAllVoiceChannels();
  res.json(channels);
});

// Create voice channel
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxParticipants: z.number().int().min(2).max(100).optional(),
  position: z.number().int().optional(),
});

router.post('/channels', async (req, res) => {
  const body = createChannelSchema.parse(req.body);
  const channel = VoiceChannelModel.createVoiceChannel(body.name, req.user!.id, body);
  res.status(201).json(channel);
});

// Update voice channel
router.patch('/channels/:id', async (req, res) => {
  const channel = VoiceChannelModel.getVoiceChannelById(req.params.id);
  if (!channel) throw new NotFoundError('Voice channel not found');
  
  const body = createChannelSchema.partial().parse(req.body);
  VoiceChannelModel.updateVoiceChannel(req.params.id, body);
  
  const updated = VoiceChannelModel.getVoiceChannelById(req.params.id);
  res.json(updated);
});

// Delete voice channel
router.delete('/channels/:id', (req, res) => {
  const channel = VoiceChannelModel.getVoiceChannelById(req.params.id);
  if (!channel) throw new NotFoundError('Voice channel not found');
  
  VoiceChannelModel.deleteVoiceChannel(req.params.id);
  res.status(204).send();
});

// Generate LiveKit token for joining a channel
const tokenSchema = z.object({
  channelId: z.string(),
});

router.post('/token', async (req, res) => {
  const { channelId } = tokenSchema.parse(req.body);
  
  const channel = VoiceChannelModel.getVoiceChannelById(channelId);
  if (!channel) throw new NotFoundError('Voice channel not found');
  
  const apiKey = await getSetting('livekit_api_key');
  const apiSecret = await getSetting('livekit_api_secret');
  
  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit credentials not configured');
  }
  
  const at = new AccessToken(apiKey, apiSecret, {
    identity: req.user!.id,
    name: req.user!.username,
    ttl: '6h', // Token valid for 6 hours
  });
  
  at.addGrant({
    roomJoin: true,
    room: channelId,
    canPublish: true,
    canSubscribe: true,
  });
  
  const token = await at.toJwt();
  
  res.json({
    token,
    wsUrl: `ws://localhost:7880`, // TODO: Make configurable for remote access
  });
});

export default router;
```

### 8C.3: Register voice routes

Modify `packages/backend/src/index.ts`:

```typescript
import voiceRoutes from './routes/voice.js';

app.use('/api/voice', voiceRoutes);
```

### 8C.4: Install livekit-server-sdk

Add to `packages/backend/package.json`:

```json
{
  "dependencies": {
    "livekit-server-sdk": "^2.7.0"
  }
}
```

**Files created**: `packages/backend/src/models/voice-channel.ts`, `packages/backend/src/routes/voice.ts`
**Files modified**: `packages/backend/src/index.ts`, `packages/backend/package.json`

---

## Phase 8D: Frontend LiveKit Client Integration

### 8D.1: Install livekit-client

Add to `packages/frontend/package.json`:

```json
{
  "dependencies": {
    "livekit-client": "^2.6.0"
  }
}
```

### 8D.2: Voice channel store

Create `packages/frontend/src/stores/voiceStore.ts`:

```typescript
import { create } from 'zustand';
import { Room, RoomEvent, Track, RemoteParticipant, LocalParticipant } from 'livekit-client';

interface VoiceChannel {
  id: string;
  name: string;
  description: string | null;
  max_participants: number;
  position: number;
  created_by: string;
  created_at: number;
}

interface Participant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  audioLevel: number;
}

interface VoiceState {
  channels: VoiceChannel[];
  currentChannelId: string | null;
  room: Room | null;
  participants: Map<string, Participant>;
  localMuted: boolean;
  localDeafened: boolean;
  isConnecting: boolean;
  error: string | null;
  
  // Actions
  setChannels: (channels: VoiceChannel[]) => void;
  joinChannel: (channelId: string, token: string, wsUrl: string) => Promise<void>;
  leaveChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setParticipantSpeaking: (identity: string, speaking: boolean) => void;
  setParticipantAudioLevel: (identity: string, level: number) => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  channels: [],
  currentChannelId: null,
  room: null,
  participants: new Map(),
  localMuted: false,
  localDeafened: false,
  isConnecting: false,
  error: null,
  
  setChannels: (channels) => set({ channels }),
  
  joinChannel: async (channelId, token, wsUrl) => {
    const { room: existingRoom } = get();
    
    // Leave existing room if any
    if (existingRoom) {
      existingRoom.disconnect();
    }
    
    set({ isConnecting: true, error: null });
    
    try {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      // Event handlers
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          document.body.appendChild(audioElement);
        }
      });
      
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach(el => el.remove());
      });
      
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const { participants } = get();
        const newParticipants = new Map(participants);
        
        // Reset all to not speaking
        newParticipants.forEach(p => p.isSpeaking = false);
        
        // Mark active speakers
        speakers.forEach(speaker => {
          const p = newParticipants.get(speaker.identity);
          if (p) p.isSpeaking = true;
        });
        
        set({ participants: newParticipants });
      });
      
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        const { participants } = get();
        const newParticipants = new Map(participants);
        newParticipants.set(participant.identity, {
          identity: participant.identity,
          name: participant.name || participant.identity,
          isSpeaking: false,
          isMuted: false,
          audioLevel: 0,
        });
        set({ participants: newParticipants });
      });
      
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        const { participants } = get();
        const newParticipants = new Map(participants);
        newParticipants.delete(participant.identity);
        set({ participants: newParticipants });
      });
      
      room.on(RoomEvent.Disconnected, () => {
        set({ currentChannelId: null, room: null, participants: new Map() });
      });
      
      // Connect
      await room.connect(wsUrl, token);
      
      // Enable microphone
      await room.localParticipant.setMicrophoneEnabled(true);
      
      set({
        room,
        currentChannelId: channelId,
        isConnecting: false,
        participants: new Map(),
      });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to join channel',
        isConnecting: false,
      });
    }
  },
  
  leaveChannel: () => {
    const { room } = get();
    if (room) {
      room.disconnect();
    }
    set({ currentChannelId: null, room: null, participants: new Map() });
  },
  
  toggleMute: async () => {
    const { room, localMuted } = get();
    if (!room) return;
    
    const newMuted = !localMuted;
    await room.localParticipant.setMicrophoneEnabled(!newMuted);
    set({ localMuted: newMuted });
  },
  
  toggleDeafen: () => {
    const { room, localDeafened } = get();
    if (!room) return;
    
    const newDeafened = !localDeafened;
    
    // Deafen = mute output (mute all remote tracks)
    room.remoteParticipants.forEach(participant => {
      participant.audioTrackPublications.forEach(pub => {
        if (pub.track) {
          pub.track.detach().forEach(el => {
            (el as HTMLAudioElement).muted = newDeafened;
          });
        }
      });
    });
    
    set({ localDeafened: newDeafened });
  },
  
  setParticipantSpeaking: (identity, speaking) => {
    const { participants } = get();
    const p = participants.get(identity);
    if (p) {
      p.isSpeaking = speaking;
      set({ participants: new Map(participants) });
    }
  },
  
  setParticipantAudioLevel: (identity, level) => {
    const { participants } = get();
    const p = participants.get(identity);
    if (p) {
      p.audioLevel = level;
      set({ participants: new Map(participants) });
    }
  },
}));
```

### 8D.3: Voice channel API client

Create `packages/frontend/src/api/voice.ts`:

```typescript
import { BASE_URL } from './client';

export interface VoiceChannel {
  id: string;
  name: string;
  description: string | null;
  max_participants: number;
  position: number;
  created_by: string;
  created_at: number;
}

export interface VoiceToken {
  token: string;
  wsUrl: string;
}

export async function getVoiceChannels(): Promise<VoiceChannel[]> {
  const res = await fetch(`${BASE_URL}/api/voice/channels`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch voice channels');
  return res.json();
}

export async function createVoiceChannel(
  name: string,
  options?: { description?: string; maxParticipants?: number }
): Promise<VoiceChannel> {
  const res = await fetch(`${BASE_URL}/api/voice/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, ...options }),
  });
  if (!res.ok) throw new Error('Failed to create voice channel');
  return res.json();
}

export async function deleteVoiceChannel(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/voice/channels/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete voice channel');
}

export async function getVoiceToken(channelId: string): Promise<VoiceToken> {
  const res = await fetch(`${BASE_URL}/api/voice/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ channelId }),
  });
  if (!res.ok) throw new Error('Failed to get voice token');
  return res.json();
}
```

**Files created**: `packages/frontend/src/stores/voiceStore.ts`, `packages/frontend/src/api/voice.ts`
**Files modified**: `packages/frontend/package.json`

---

## Phase 8E: Voice UI Components

### 8E.1: Voice channel list sidebar

Create `packages/frontend/src/components/VoiceChannelList.tsx`:

```typescript
import { useEffect } from 'react';
import { Volume2, VolumeX, Headphones, Mic, MicOff, PhoneOff, Plus } from 'lucide-react';
import { useVoiceStore } from '../stores/voiceStore';
import { getVoiceChannels, getVoiceToken } from '../api/voice';
import { toast } from 'sonner';

export function VoiceChannelList() {
  const {
    channels,
    currentChannelId,
    participants,
    localMuted,
    localDeafened,
    isConnecting,
    setChannels,
    joinChannel,
    leaveChannel,
    toggleMute,
    toggleDeafen,
  } = useVoiceStore();
  
  useEffect(() => {
    loadChannels();
  }, []);
  
  async function loadChannels() {
    try {
      const data = await getVoiceChannels();
      setChannels(data);
    } catch (error) {
      toast.error('Failed to load voice channels');
    }
  }
  
  async function handleJoin(channelId: string) {
    try {
      const { token, wsUrl } = await getVoiceToken(channelId);
      await joinChannel(channelId, token, wsUrl);
    } catch (error) {
      toast.error('Failed to join voice channel');
    }
  }
  
  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-700">
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Voice Channels</h2>
          <button
            className="p-1 hover:bg-slate-800 rounded"
            title="Create Channel"
          >
            <Plus className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {channels.map(channel => (
          <div
            key={channel.id}
            className={`p-3 border-b border-slate-800 ${
              currentChannelId === channel.id ? 'bg-slate-800' : 'hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-200">{channel.name}</span>
              </div>
              
              {currentChannelId === channel.id ? (
                <button
                  onClick={leaveChannel}
                  className="p-1 hover:bg-red-600 rounded text-slate-400 hover:text-white"
                  title="Leave"
                >
                  <PhoneOff className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => handleJoin(channel.id)}
                  disabled={isConnecting}
                  className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
                >
                  Join
                </button>
              )}
            </div>
            
            {currentChannelId === channel.id && (
              <div className="mt-2 space-y-1">
                {Array.from(participants.values()).map(p => (
                  <div
                    key={p.identity}
                    className={`flex items-center gap-2 text-xs ${
                      p.isSpeaking ? 'text-green-400' : 'text-slate-400'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${
                      p.isSpeaking ? 'bg-green-400 animate-pulse' : 'bg-slate-600'
                    }`} />
                    <span>{p.name}</span>
                    {p.isMuted && <MicOff className="w-3 h-3" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {currentChannelId && (
        <div className="p-3 border-t border-slate-700 bg-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className={`flex-1 p-2 rounded ${
                localMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
              title={localMuted ? 'Unmute' : 'Mute'}
            >
              {localMuted ? <MicOff className="w-4 h-4 mx-auto" /> : <Mic className="w-4 h-4 mx-auto" />}
            </button>
            
            <button
              onClick={toggleDeafen}
              className={`flex-1 p-2 rounded ${
                localDeafened ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
              title={localDeafened ? 'Undeafen' : 'Deafen'}
            >
              {localDeafened ? <VolumeX className="w-4 h-4 mx-auto" /> : <Headphones className="w-4 h-4 mx-auto" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### 8E.2: Integrate into main layout

Modify the main layout to include the voice channel sidebar. This depends on the exact layout structure from Epic 6 (Friends & Chat), but the general pattern:

```typescript
// In packages/frontend/src/pages/Dashboard.tsx or similar
import { VoiceChannelList } from '../components/VoiceChannelList';

export function Dashboard() {
  return (
    <div className="flex h-screen">
      {/* Existing server list sidebar */}
      <ServerList />
      
      {/* Main content */}
      <div className="flex-1">
        {/* ... */}
      </div>
      
      {/* Voice channel sidebar */}
      <div className="w-64">
        <VoiceChannelList />
      </div>
    </div>
  );
}
```

**Files created**: `packages/frontend/src/components/VoiceChannelList.tsx`
**Files modified**: Main layout component (exact file depends on Epic 6 structure)

---

## Phase 8F: Push-to-Talk via Tauri

### 8F.1: Tauri global shortcut plugin

Add to `packages/desktop/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-global-shortcut = "2"
```

### 8F.2: Register push-to-talk shortcut

Modify `packages/desktop/src-tauri/src/lib.rs`:

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

// In setup():
let app_handle = app.handle().clone();
app.global_shortcut().on_shortcut("Ctrl+Space", move |_app, _shortcut, event| {
    // Emit event to frontend
    app_handle.emit("push-to-talk", event).unwrap();
})?;

app.global_shortcut().register("Ctrl+Space")?;
```

### 8F.3: Frontend push-to-talk handler

Create `packages/frontend/src/hooks/usePushToTalk.ts`:

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useVoiceStore } from '../stores/voiceStore';

export function usePushToTalk() {
  const { room, localMuted } = useVoiceStore();
  
  useEffect(() => {
    if (!room) return;
    
    const unlisten = listen('push-to-talk', async (event: any) => {
      if (event.payload === 'KeyDown') {
        // Unmute while key is held
        await room.localParticipant.setMicrophoneEnabled(true);
      } else if (event.payload === 'KeyUp') {
        // Re-mute when key is released (if user was muted before)
        if (localMuted) {
          await room.localParticipant.setMicrophoneEnabled(false);
        }
      }
    });
    
    return () => {
      unlisten.then(fn => fn());
    };
  }, [room, localMuted]);
}
```

Wire this into the main app:

```typescript
// In App.tsx or similar
import { usePushToTalk } from './hooks/usePushToTalk';

export function App() {
  usePushToTalk();
  
  return (
    // ...
  );
}
```

**Files modified**: `packages/desktop/src-tauri/Cargo.toml`, `packages/desktop/src-tauri/src/lib.rs`
**Files created**: `packages/frontend/src/hooks/usePushToTalk.ts`

---

## Phase 8G: Audio Device Selection

### 8G.1: Device selection UI

Create `packages/frontend/src/components/VoiceSettings.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Room } from 'livekit-client';
import { useVoiceStore } from '../stores/voiceStore';

export function VoiceSettings() {
  const { room } = useVoiceStore();
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  
  useEffect(() => {
    loadDevices();
  }, []);
  
  async function loadDevices() {
    const devices = await Room.getLocalDevices('audioinput');
    setInputDevices(devices);
    
    const outputs = await Room.getLocalDevices('audiooutput');
    setOutputDevices(outputs);
    
    // Set defaults
    if (devices.length > 0) setSelectedInput(devices[0].deviceId);
    if (outputs.length > 0) setSelectedOutput(outputs[0].deviceId);
  }
  
  async function handleInputChange(deviceId: string) {
    setSelectedInput(deviceId);
    if (room) {
      await room.switchActiveDevice('audioinput', deviceId);
    }
  }
  
  async function handleOutputChange(deviceId: string) {
    setSelectedOutput(deviceId);
    if (room) {
      await room.switchActiveDevice('audiooutput', deviceId);
    }
  }
  
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-200 mb-2">
          Input Device
        </label>
        <select
          value={selectedInput}
          onChange={e => handleInputChange(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200"
        >
          {inputDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Unknown Device'}
            </option>
          ))}
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-slate-200 mb-2">
          Output Device
        </label>
        <select
          value={selectedOutput}
          onChange={e => handleOutputChange(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200"
        >
          {outputDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Unknown Device'}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

This can be integrated into a settings modal or a dedicated voice settings page.

**Files created**: `packages/frontend/src/components/VoiceSettings.tsx`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **8A** (LiveKit deployment) | ~3h | LiveKit binary download, config generation, credentials |
| 2 | **8B** (Tauri sidecar) | ~2h | LiveKit spawned by Tauri, graceful shutdown |
| 3 | **8C** (Backend API) | ~3h | Voice channel CRUD, token generation |
| 4 | **8D** (Frontend client) | ~4h | LiveKit client integration, Zustand store |
| 5 | **8E** (Voice UI) | ~4h | Channel list, join/leave, mute/deafen controls |
| 6 | **8F** (Push-to-talk) | ~2h | Global shortcut via Tauri |
| 7 | **8G** (Device selection) | ~2h | Input/output device picker |

**Total: ~20 hours**

---

## Complete File Change Summary

### New Files (15)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/desktop/scripts/download-livekit.ts` | 8A | Download LiveKit binary for current platform |
| `packages/backend/src/services/livekit-config.ts` | 8A | Generate LiveKit config.yaml |
| `packages/backend/migrations/008_voice_channels.sql` | 8A | Voice channels table, LiveKit settings |
| `packages/backend/src/models/voice-channel.ts` | 8C | Voice channel CRUD model |
| `packages/backend/src/routes/voice.ts` | 8C | Voice channel API routes, token generation |
| `packages/frontend/src/stores/voiceStore.ts` | 8D | Zustand store for voice state |
| `packages/frontend/src/api/voice.ts` | 8D | Voice API client |
| `packages/frontend/src/components/VoiceChannelList.tsx` | 8E | Voice channel sidebar UI |
| `packages/frontend/src/hooks/usePushToTalk.ts` | 8F | Push-to-talk global shortcut handler |
| `packages/frontend/src/components/VoiceSettings.tsx` | 8G | Audio device selection UI |

### Modified Files (9)

| File | Phase | Changes |
|------|-------|---------|
| `packages/desktop/package.json` | 8A | Add download-livekit script |
| `packages/backend/src/services/settings.ts` | 8A | ensureLiveKitCredentials() |
| `packages/backend/src/index.ts` | 8A, 8B, 8C | Generate LiveKit config, register voice routes |
| `packages/desktop/src-tauri/src/lib.rs` | 8B, 8F | Spawn LiveKit sidecar, global shortcut |
| `packages/desktop/src-tauri/tauri.conf.json` | 8B | Add livekit-server to externalBin |
| `packages/desktop/src-tauri/Cargo.toml` | 8F | Add global-shortcut plugin |
| `packages/backend/package.json` | 8C | Add livekit-server-sdk |
| `packages/frontend/package.json` | 8D | Add livekit-client |
| Main layout component | 8E | Integrate VoiceChannelList sidebar |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| WebRTC not supported in Tauri WebView on older Linux systems | Document minimum WebKitGTK version (4.1+). Provide fallback message if WebRTC APIs are unavailable. Test on Ubuntu 20.04, 22.04, Fedora 38+. |
| NAT traversal fails for users behind strict firewalls | LiveKit's TURN server handles most cases. Document port requirements (7880 TCP, 50000-60000 UDP). Provide troubleshooting guide for port forwarding. |
| LiveKit server crashes or fails to start | Log all LiveKit stdout/stderr. Implement health check endpoint. Show clear error in UI if LiveKit is unreachable. |

### Medium

| Risk | Mitigation |
|------|------------|
| Audio quality issues (echo, noise) | LiveKit client SDK has built-in echo cancellation, noise suppression, auto-gain control. Expose these as settings if needed. |
| High CPU usage with many participants | LiveKit's SFU architecture scales well. Test with 10+ participants. Document recommended max participants (50 is conservative). |
| Port 7880 already in use | Make LiveKit port configurable via settings. Detect conflicts at startup. |
| Push-to-talk conflicts with other apps | Allow customizable shortcut in settings. Provide clear UI for shortcut configuration. |

### Low

| Risk | Mitigation |
|------|------------|
| LiveKit binary size (~30MB) | Acceptable for desktop app. Tauri's compression helps. |
| Token expiry during long sessions | Tokens are valid for 6 hours. Implement auto-refresh if session exceeds this (future enhancement). |
| Audio device changes mid-session | LiveKit SDK handles device changes gracefully. Provide manual refresh button in settings. |

---

## Testing Checklist

1. **LiveKit server startup**: Tauri spawns LiveKit, config.yaml is generated, server listens on port 7880
2. **Voice channel CRUD**: Create, list, update, delete channels via API
3. **Token generation**: Backend generates valid JWT, frontend can connect to LiveKit
4. **Join/leave channel**: User can join a channel, see other participants, leave cleanly
5. **Audio transmission**: Speak into mic, other participants hear audio with low latency (<200ms)
6. **Mute/deafen**: Mute stops mic, deafen stops output, UI reflects state
7. **Speaking indicators**: Active speakers show visual indicator in real-time
8. **Push-to-talk**: Ctrl+Space unmutes while held, re-mutes on release
9. **Device selection**: Switching input/output devices works without reconnecting
10. **Graceful shutdown**: Closing app disconnects from voice, stops LiveKit server
11. **Multiple participants**: 5+ users in same channel, audio quality remains good
12. **WebRTC compatibility**: Test on macOS (WKWebView), Windows (WebView2), Linux (WebKitGTK 4.1+)
13. **Firewall traversal**: Test behind NAT, verify TURN server works
14. **Error handling**: Kill LiveKit server mid-session, frontend shows error and allows reconnect

---

## Future Enhancements (Post-v1)

These are explicitly out of scope for Epic 8 but noted for future consideration:

1. **Video calling**: Add camera tracks, video grid UI
2. **Screen sharing**: Share application window or entire screen
3. **Recording**: Server-side recording of voice channels (LiveKit Egress)
4. **Noise gate**: Advanced audio processing (threshold-based muting)
5. **Spatial audio**: 3D positional audio for immersive experience
6. **Voice activity detection tuning**: Adjustable sensitivity for speaking detection
7. **Per-user volume control**: Adjust volume for individual participants
8. **Channel permissions**: Restrict who can join/speak in specific channels
9. **Persistent voice channels**: Channels that persist across server restarts
10. **Mobile app support**: Extend to iOS/Android via Tauri Mobile (future)

---

## WebRTC Compatibility Notes

### macOS (WKWebView)
- Full WebRTC support since macOS 11 (Big Sur)
- getUserMedia, RTCPeerConnection, RTCDataChannel all supported
- No known issues with LiveKit client SDK

### Windows (WebView2/Chromium)
- Full WebRTC support (WebView2 is Chromium-based)
- Identical behavior to Chrome browser
- No known issues

### Linux (WebKitGTK)
- Requires WebKitGTK 4.1+ (webkit2gtk-4.1)
- WebRTC support added in WebKitGTK 2.38+
- PipeWire capturer required for screen sharing (not needed for audio-only)
- Minimum distro versions:
  - Ubuntu 22.04+
  - Fedora 36+
  - Debian 12+

**Detection**: Check for `navigator.mediaDevices.getUserMedia` at runtime. Show error if unavailable.

---

## Firewall & Port Requirements

### For Local Network Use (Default)
- **7880 TCP**: LiveKit WebSocket (WSS) — must be accessible to clients
- **7881 TCP**: LiveKit RTC over TCP (fallback if UDP blocked)
- **50000-60000 UDP**: WebRTC media streams (audio packets)

### For Remote Access (Optional)
- **3478 TCP/UDP**: TURN server (NAT traversal)
- Requires public IP or domain name
- Set `livekit_domain` in settings
- May require port forwarding on router

**Recommendation**: For v1, focus on local network use. Remote access can be added later with proper TURN/STUN configuration and TLS certificates.

---

## Database Schema

```sql
CREATE TABLE voice_channels (
  id TEXT PRIMARY KEY,              -- nanoid
  name TEXT NOT NULL,               -- "General Voice", "Gaming Room"
  description TEXT,                 -- Optional description
  max_participants INTEGER NOT NULL DEFAULT 50,
  position INTEGER NOT NULL DEFAULT 0,  -- Sort order
  created_by TEXT NOT NULL,         -- User ID (foreign key)
  created_at INTEGER NOT NULL,      -- Unix timestamp
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- LiveKit settings (in existing settings table)
-- livekit_api_key: API key for token generation
-- livekit_api_secret: API secret for token generation
-- livekit_port: WebSocket port (default 7880)
-- livekit_rtc_tcp_port: RTC TCP port (default 7881)
-- livekit_rtc_port_range_start: UDP port range start (default 50000)
-- livekit_rtc_port_range_end: UDP port range end (default 60000)
-- livekit_domain: Optional domain for TURN server
```

---

## API Routes

```
GET    /api/voice/channels           -- List all voice channels
POST   /api/voice/channels           -- Create voice channel
PATCH  /api/voice/channels/:id       -- Update voice channel
DELETE /api/voice/channels/:id       -- Delete voice channel
POST   /api/voice/token               -- Generate LiveKit token for joining
```

**Request/Response Examples:**

```typescript
// POST /api/voice/channels
{
  "name": "General Voice",
  "description": "Main voice channel",
  "maxParticipants": 50
}
// Response: VoiceChannel object

// POST /api/voice/token
{
  "channelId": "abc123"
}
// Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "wsUrl": "ws://localhost:7880"
}
```

---

## Tech Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| Voice server | LiveKit | 1.7.2+ |
| Backend SDK | livekit-server-sdk | 2.7.0+ |
| Frontend SDK | livekit-client | 2.6.0+ |
| WebRTC | Native browser APIs | - |
| Audio processing | LiveKit built-in | Echo cancellation, noise suppression, AGC |
| Global shortcuts | tauri-plugin-global-shortcut | 2.0+ |

All other technologies inherited from existing stack (TypeScript, Express, React, Zustand, Tailwind).
