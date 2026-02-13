# Requirements Document -- Friends & Text Chat

## Introduction

Add social features to the MC Server Manager community platform: a friend system with presence tracking, direct messages, and text channels. This transforms the application from a server management tool into a lightweight social hub where gaming groups can coordinate, chat, and see who's online and what they're playing.

This epic extends the existing WebSocket infrastructure (already handling console output) with new message types for chat, presence, and friend events. No new transport layer is needed.

## Alignment with Product Vision

After Epic 5 (Multi-User Foundation), users can authenticate and connect to a shared community server. Epic 6 adds the social layer: friends, presence awareness, and real-time text communication. This makes the platform a natural gathering place for gaming groups rather than just a server dashboard.

Prerequisite for: Epic 9 (Mod Sync -- friend-based server sharing).
Dependencies: Epic 5 (Multi-User Foundation) for user accounts and authentication.

---

## Requirements

### REQ-1: Friend Requests

**User Story:** As a user, I want to send friend requests to other community members, so that I can build my friends list and see when they are online.

#### Acceptance Criteria

1. WHEN a user sends a friend request by username THEN the system SHALL create a pending friendship record and notify the recipient in real time via WebSocket.
2. WHEN a user receives a friend request THEN the system SHALL display it in a pending requests list and show a desktop notification.
3. WHEN the recipient accepts a friend request THEN the system SHALL create a bidirectional friendship (both directions stored) and notify both users.
4. WHEN the recipient rejects a friend request THEN the system SHALL mark the request as rejected and notify the sender.
5. WHEN a user sends a friend request to themselves THEN the system SHALL reject it with a clear error.
6. WHEN a user sends a duplicate friend request (already pending, accepted, or reverse pending) THEN the system SHALL reject it with a specific error message.

---

### REQ-2: Friends List

**User Story:** As a user, I want to see my friends list with their online status, so that I can know who is available to play.

#### Acceptance Criteria

1. WHEN a user views their friends list THEN the system SHALL display all accepted friends with their username, display name, and current presence status.
2. WHEN a user removes a friend THEN the system SHALL delete both direction friendship records and notify the other user.
3. WHEN the friends list is displayed THEN friends SHALL be sorted by presence status (online/in-game first, then offline) and alphabetically within each group.

---

### REQ-3: Presence Tracking

**User Story:** As a user, I want to see whether my friends are online, offline, or in a Minecraft game, so that I can coordinate gameplay.

#### Acceptance Criteria

1. WHEN a user connects via WebSocket THEN the system SHALL set their presence to "online" and broadcast the update to all their friends.
2. WHEN a user disconnects (WebSocket close) THEN the system SHALL set their presence to "offline" and broadcast the update to all their friends.
3. WHEN a user joins a Minecraft server (detected via player join log parsing) THEN the system SHALL set their presence to "in-game" with the server name, and broadcast to friends.
4. WHEN a user leaves a Minecraft server THEN the system SHALL set their presence back to "online" and broadcast to friends.
5. WHEN a user views a friend's profile THEN the system SHALL display a presence indicator badge (green for online, yellow for in-game, gray for offline).
6. WHEN the application reconnects after a network interruption THEN the system SHALL re-establish correct presence state for all friends.

---

### REQ-4: Text Channels

**User Story:** As an admin, I want to create text channels for the community, so that members have shared spaces to chat by topic.

#### Acceptance Criteria

1. WHEN an owner or admin creates a text channel THEN the system SHALL create it with a name and optional description, and automatically add all community members.
2. WHEN a new user joins the community THEN they SHALL be automatically added to all existing text channels.
3. WHEN a user views the channel list THEN the system SHALL display all text channels they are a member of, with unread message counts.
4. WHEN an owner or admin deletes a text channel THEN the system SHALL remove it and all associated messages and read markers.
5. WHEN a member attempts to create or delete a text channel THEN the system SHALL deny the action with a 403 error.

---

### REQ-5: Direct Messages

**User Story:** As a user, I want to send direct messages to my friends, so that we can have private conversations.

#### Acceptance Criteria

1. WHEN a user initiates a DM with a friend THEN the system SHALL find or create a DM channel between the two users.
2. WHEN a DM channel is created THEN it SHALL have exactly two members and no public name (displayed as the other user's name).
3. WHEN a user views their channel list THEN DM channels SHALL appear alongside text channels, showing the other user's display name and presence.
4. DM channels SHALL NOT be deletable (conversations are permanent).
5. WHEN a user sends a DM to a non-friend THEN the system SHALL deny the action (friendship required for DMs).

---

### REQ-6: Messaging

**User Story:** As a user, I want to send and receive text messages in channels and DMs, so that I can communicate with my community.

#### Acceptance Criteria

1. WHEN a user sends a message in a channel THEN the system SHALL persist it and broadcast it to all channel members in real time via WebSocket.
2. WHEN a user opens a channel THEN the system SHALL load the most recent 50 messages and support pagination (load more on scroll up).
3. WHEN a message is received THEN it SHALL display the sender's display name, avatar placeholder, message content, and relative timestamp.
4. Messages SHALL support basic Markdown: **bold**, *italic*, `inline code`, and [links](url).
5. Messages SHALL have a maximum length of 4000 characters.
6. WHEN a message is sent THEN the channel's `updated_at` timestamp SHALL be updated for sorting the channel list.

---

### REQ-7: Typing Indicators

**User Story:** As a user, I want to see when someone is typing in a channel, so that I know a response is coming.

#### Acceptance Criteria

1. WHEN a user starts typing in a channel THEN a typing indicator event SHALL be broadcast to other channel members via WebSocket.
2. Typing events SHALL be debounced on the client (maximum 1 event per 3 seconds).
3. The typing indicator SHALL automatically clear after 3 seconds of no typing events.
4. WHEN multiple users are typing THEN the indicator SHALL show all typing usernames.
5. The typing indicator SHALL NOT be shown for the user's own typing.

---

### REQ-8: Unread Tracking

**User Story:** As a user, I want to see which channels have unread messages, so that I can quickly find new conversations.

#### Acceptance Criteria

1. WHEN a user opens a channel THEN the system SHALL mark the latest message as read for that user.
2. WHEN a message arrives in a channel the user is not currently viewing THEN the unread count for that channel SHALL increment.
3. WHEN the user views the channel list THEN each channel SHALL display its unread message count (badge).
4. WHEN the user opens a channel with unread messages THEN the unread count SHALL reset to zero.

---

### REQ-9: Desktop Notifications

**User Story:** As a user, I want to receive desktop notifications for new messages and friend requests, so that I don't miss important events.

#### Acceptance Criteria

1. WHEN a message arrives in a channel the user is NOT currently viewing THEN a desktop notification SHALL appear showing the sender name and message preview (first 100 characters).
2. WHEN a friend request is received THEN a desktop notification SHALL appear showing the requester's username.
3. WHEN the app is in the foreground and the user is viewing the active channel THEN no notification SHALL be shown for messages in that channel.
4. Desktop notifications SHALL use the Electron Notification API (native OS notifications).
5. WHEN the user has not granted notification permission THEN the app SHALL request it once on first load.

---

## Non-Functional Requirements

### Performance
- Message list rendering SHALL use virtualization (@tanstack/react-virtual) to handle large message histories without performance degradation.
- Message pagination SHALL load 50 messages per batch. Older messages loaded on scroll.
- The `messages` table SHALL have a composite index on `(channel_id, created_at DESC)` for efficient paginated queries.
- Presence updates SHALL be broadcast only to friends (not all users) to minimize WebSocket traffic.
- Typing indicator events SHALL NOT be persisted in the database.

### Scalability
- The system is designed for small communities (10-50 users). No message broker or Redis required.
- All message persistence uses the existing SQLite database.
- WebSocket broadcasts use in-process fan-out (iterate connected clients).

### Security
- Users can only send messages in channels they are members of.
- DMs require an accepted friendship.
- Only owners/admins can create and delete text channels.
- Message content is validated (non-empty, max 4000 chars) before persistence.
- Markdown rendering uses `react-markdown` with default sanitization (no raw HTML injection).
- All chat/friend/presence API endpoints require JWT authentication (from Epic 5).

### Reliability
- WebSocket auto-reconnect (already implemented) re-establishes presence and chat subscriptions.
- On reconnect, the client re-fetches recent messages to catch up on missed ones.
- Presence state is derived from WebSocket connection state (source of truth) -- no stale state possible.
- Bidirectional friendship storage ensures consistent friend queries regardless of who initiated.

### User Experience
- Friends are sorted by presence (online/in-game first) for quick visibility.
- Channel list sorted by most recent activity.
- Enter key sends messages, Shift+Enter for newlines.
- Markdown formatting help shown below the input field.
- Presence badges use intuitive colors: green (online), yellow/amber (in-game), gray (offline).
