# Requirements Document -- Voice Communication

## Introduction

Add Discord-like voice channels to MC Server Manager using LiveKit, an open-source WebRTC infrastructure. Users can create voice channels, join or leave them, and communicate with low-latency audio. LiveKit runs as a sidecar process alongside the Express backend, handling all WebRTC complexity (NAT traversal, codec negotiation, adaptive bitrate, echo cancellation). The frontend uses the LiveKit JS Client SDK to connect and stream audio.

This is audio-only for v1. Video calling and screen sharing are explicitly deferred to future versions. Voice chat is the core use case for gaming communities.

Dependencies: Epic 5 (Multi-User Foundation) for user accounts and authentication. LiveKit server binary bundled as a Tauri sidecar.

Prerequisite for: Epic 9 (Mod Sync -- voice channels enhance the shared server experience).

---

## Requirements

### REQ-1: Voice Channel CRUD

**User Story:** As an authenticated user, I want to create and manage voice channels, so that my community has dedicated spaces for voice conversations.

#### Acceptance Criteria

1. WHEN an authenticated user creates a voice channel with a name THEN the system SHALL persist it with a unique ID, optional description, configurable max participants (default 50), and sort position.
2. WHEN an authenticated user lists voice channels THEN the system SHALL return all voice channels sorted by position ascending, then by creation time ascending.
3. WHEN an authenticated user updates a voice channel THEN the system SHALL allow changing the name, description, max participants, and position.
4. WHEN an authenticated user deletes a voice channel THEN the system SHALL remove it from the database and disconnect any active participants.
5. WHEN a voice channel is created THEN the created_by field SHALL reference the authenticated user who created it.

---

### REQ-2: Join and Leave Voice Channels

**User Story:** As a user, I want to join and leave voice channels, so that I can participate in voice conversations with my community.

#### Acceptance Criteria

1. WHEN a user clicks "Join" on a voice channel THEN the system SHALL request a LiveKit access token from the backend and connect to the LiveKit server room corresponding to that channel.
2. WHEN a user successfully joins a voice channel THEN the system SHALL enable their microphone and begin transmitting audio to other participants in the room.
3. WHEN a user joins a voice channel while already in another channel THEN the system SHALL automatically disconnect from the previous channel before joining the new one.
4. WHEN a user clicks "Leave" or disconnects THEN the system SHALL disconnect from the LiveKit room and stop transmitting audio.
5. WHEN a user joins a voice channel THEN all other participants in that channel SHALL see the new participant appear in the participant list.
6. WHEN a user leaves a voice channel THEN all remaining participants SHALL see that user removed from the participant list.

---

### REQ-3: Audio Transmission via WebRTC

**User Story:** As a user in a voice channel, I want my audio to be transmitted to all other participants in real time, so that we can have a natural conversation.

#### Acceptance Criteria

1. WHEN a user is in a voice channel with their microphone enabled THEN their audio SHALL be transmitted to all other participants via LiveKit's Selective Forwarding Unit (SFU).
2. WHEN a user receives audio from remote participants THEN the system SHALL automatically attach audio elements for playback.
3. WHEN a remote participant disconnects or their track is unsubscribed THEN the system SHALL detach and clean up the associated audio elements.
4. WHEN audio is being captured THEN the system SHALL apply echo cancellation, noise suppression, and automatic gain control by default.
5. WHEN multiple participants are speaking THEN LiveKit SHALL forward all audio streams independently (no server-side mixing).

---

### REQ-4: Push-to-Talk

**User Story:** As a user, I want a push-to-talk mode so that my microphone is only active while I hold a key, reducing background noise.

#### Acceptance Criteria

1. WHEN the user holds the push-to-talk key (default: Ctrl+Space) THEN the system SHALL enable the microphone and transmit audio.
2. WHEN the user releases the push-to-talk key THEN the system SHALL disable the microphone (re-mute if the user was muted before).
3. WHEN the push-to-talk key is pressed THEN it SHALL work as a global shortcut even when the application window is not focused, via Tauri global shortcut plugin.
4. WHEN push-to-talk events are received from Tauri THEN the system SHALL distinguish between KeyDown (unmute) and KeyUp (re-mute) events.

---

### REQ-5: Mute and Deafen Controls

**User Story:** As a user in a voice channel, I want to mute my microphone or deafen all audio output, so that I can control my audio experience.

#### Acceptance Criteria

1. WHEN a user toggles mute THEN the system SHALL disable or enable microphone transmission via the LiveKit local participant API.
2. WHEN a user toggles deafen THEN the system SHALL mute all remote audio tracks (no incoming audio playback).
3. WHEN a user is muted THEN the mute button SHALL visually indicate the muted state (red background with MicOff icon).
4. WHEN a user is deafened THEN the deafen button SHALL visually indicate the deafened state (red background with VolumeX icon).
5. WHEN the mute or deafen state changes THEN the system SHALL persist this in the frontend voice store and reflect it immediately in the UI.

---

### REQ-6: Voice Activity Display

**User Story:** As a user in a voice channel, I want to see who is currently speaking, so that I can follow the conversation.

#### Acceptance Criteria

1. WHEN a participant is speaking THEN the system SHALL display a green pulsing indicator next to their name in the participant list.
2. WHEN a participant stops speaking THEN the indicator SHALL return to the default inactive state (gray dot).
3. WHEN the active speakers change THEN the system SHALL update the participant list in real time using LiveKit's ActiveSpeakersChanged event.
4. WHEN a participant is muted THEN a muted icon (MicOff) SHALL appear next to their name in the participant list.

---

### REQ-7: LiveKit Sidecar Management

**User Story:** As a system operator, I want the LiveKit server to be automatically managed alongside the application, so that voice communication works without manual server setup.

#### Acceptance Criteria

1. WHEN the Tauri application starts THEN it SHALL spawn the LiveKit server binary as a sidecar process with the generated configuration file.
2. WHEN the backend starts THEN it SHALL generate a LiveKit configuration YAML file containing port settings and API credentials.
3. WHEN the application starts for the first time THEN the backend SHALL auto-generate LiveKit API key and secret credentials and store them in the settings table.
4. WHEN the Tauri application is quit THEN it SHALL kill the LiveKit sidecar process before killing the backend sidecar.
5. WHEN the LiveKit sidecar process terminates unexpectedly THEN the system SHALL log the termination with exit code and signal information.
6. WHEN the LiveKit binary is not found at the expected sidecar path THEN the system SHALL log an error (voice features will be unavailable).

---

### REQ-8: LiveKit Token Generation

**User Story:** As the system, I need to generate short-lived LiveKit access tokens so that only authenticated users can join voice channels.

#### Acceptance Criteria

1. WHEN a user requests to join a voice channel THEN the backend SHALL generate a JWT access token using the livekit-server-sdk with the user's identity and display name.
2. WHEN a token is generated THEN it SHALL grant roomJoin, canPublish, and canSubscribe permissions scoped to the specific channel (room).
3. WHEN a token is generated THEN it SHALL have a time-to-live of 6 hours.
4. WHEN a token request is made for a non-existent channel THEN the backend SHALL return a 404 NotFoundError.
5. WHEN LiveKit API credentials are not configured THEN the token endpoint SHALL return a 500 error with a clear message.
6. WHEN a token is generated THEN the backend SHALL also return the LiveKit WebSocket URL so the frontend can connect.

---

### REQ-9: Audio Device Selection

**User Story:** As a user, I want to select which microphone and speaker to use for voice chat, so that I can use my preferred audio devices.

#### Acceptance Criteria

1. WHEN a user opens voice settings THEN the system SHALL enumerate all available audio input and output devices using the LiveKit Room API.
2. WHEN a user selects a different input device THEN the system SHALL switch the active microphone via LiveKit's switchActiveDevice method without disconnecting from the room.
3. WHEN a user selects a different output device THEN the system SHALL switch the active speaker via LiveKit's switchActiveDevice method without disconnecting from the room.
4. WHEN no devices are available THEN the system SHALL display a meaningful fallback label ("Unknown Device").

---

## Non-Functional Requirements

### Performance
- Audio latency from microphone to remote speaker SHALL be at most 200ms under normal network conditions.
- The LiveKit SFU architecture SHALL support at most 50 concurrent participants per voice channel.
- Voice activity detection and speaker change events SHALL update the UI within 100ms.
- The LiveKit client SDK SHALL use adaptive bitrate streaming to maintain audio quality under variable network conditions.

### Audio Quality
- Echo cancellation, noise suppression, and automatic gain control SHALL be enabled by default via LiveKit audio capture defaults.
- LiveKit SHALL handle codec negotiation automatically (Opus codec preferred for voice).
- The system SHALL support simultaneous audio from multiple speakers without server-side mixing (SFU forwarding).

### Security
- All voice channel API endpoints SHALL require JWT authentication (from Epic 5).
- LiveKit access tokens SHALL be generated server-side only -- clients never have direct access to LiveKit API credentials.
- LiveKit API key and secret SHALL be auto-generated on first run and stored in the settings table (never hardcoded).
- LiveKit tokens SHALL be scoped to a specific room (channel) with explicit publish/subscribe grants.
- Token time-to-live SHALL be limited to 6 hours.

### Reliability
- LiveKit sidecar process SHALL be gracefully shut down when the application exits.
- The backend SHALL write the LiveKit configuration file before the Tauri sidecar attempts to start LiveKit (polling with timeout).
- If the LiveKit server is unreachable, the frontend SHALL display a clear error message and allow the user to retry.
- Disconnection from a voice channel SHALL cleanly detach all audio elements and reset the voice store state.

### Deployment
- LiveKit server SHALL run as a single Go binary sidecar managed by Tauri -- no Docker required.
- The LiveKit binary SHALL be downloaded per-platform during the build process via a dedicated download script.
- The LiveKit binary SHALL be registered in Tauri's externalBin configuration alongside the backend sidecar.
- For v1, the system SHALL target local network use. Remote access (TURN server, TLS) is a future enhancement.

### Compatibility
- WebRTC audio SHALL work on macOS (WKWebView, macOS 11+), Windows (WebView2/Chromium), and Linux (WebKitGTK 2.38+).
- The system SHALL detect WebRTC support at runtime via navigator.mediaDevices.getUserMedia and show an error if unavailable.
- Minimum Linux distribution versions: Ubuntu 22.04+, Fedora 36+, Debian 12+.

### Ports and Networking
- LiveKit WebSocket SHALL default to port 7880 (TCP).
- LiveKit RTC over TCP SHALL default to port 7881.
- WebRTC media streams SHALL use UDP port range 50000 to 60000.
- All LiveKit port settings SHALL be configurable via the settings table.
