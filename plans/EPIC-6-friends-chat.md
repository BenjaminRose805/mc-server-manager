# Epic 6 — Friends & Text Chat

> **Prerequisite for**: Epic 9 (Mod Sync — friend-based server sharing)
> **Standalone value**: Lightweight social hub for your gaming group — chat, see who's online, coordinate gameplay
> **Dependencies**: Epic 5 (Multi-User Foundation) for user accounts and authentication

---

## Executive Summary

Add social features to the community platform: friend system, presence tracking, direct messages, and text channels. This transforms MC Server Manager from a server management tool into a social hub where your gaming group can coordinate, chat, and see who's online and what they're playing.

### Key Decisions

- **Extend existing WebSocket infrastructure** — The `ws` server already handles real-time messaging for console output. This epic adds new message types for chat, presence, and friend events. No new transport layer needed.
- **SQLite for message persistence** — Chat history stored in the same SQLite database. No separate message broker or Redis. Acceptable for small communities (10-50 users).
- **Presence via connection state + game tracking** — Online/offline derived from WebSocket connection. In-game status derived from MC server player tracking (already implemented). No separate heartbeat protocol.
- **Channel-based architecture** — Both DMs and text channels are modeled as "channels" with different types. Unified message storage and rendering.
- **Basic markdown only** — Bold, italic, code, links. No file uploads, no embeds, no reactions in v1. Keep it simple.
- **Desktop notifications via Tauri** — New message notifications use Tauri's notification plugin (already available from Epic 1).

---

## Architecture

### Current Architecture (Post-Epic 5)

```
┌─────────────────────────────────────┐
│  Tauri Desktop App                  │
│  ┌───────────────────────────────┐  │
│  │ React Frontend                │  │
│  │  • Server management UI       │  │
│  │  • User auth UI               │  │
│  └───────────┬───────────────────┘  │
│              │ HTTPS/WSS             │
│  ┌───────────▼───────────────────┐  │
│  │ Rust Core                     │  │
│  └───────────────────────────────┘  │
└──────────┬──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Community Server (Express Backend)  │
│  • User accounts & auth              │
│  • Permission system                 │
│  • MC server management              │
│  • WebSocket server (console)        │
│  └───► SQLite (users, servers)       │
└──────────────────────────────────────┘
```

### Target Architecture (Post-Epic 6)

```
┌─────────────────────────────────────┐
│  Tauri Desktop App                  │
│  ┌───────────────────────────────┐  │
│  │ React Frontend                │  │
│  │  • Server management UI       │  │
│  │  • User auth UI               │  │
│  │  • Friends list sidebar       │  │  ◄── NEW
│  │  • Chat UI (DMs + channels)   │  │  ◄── NEW
│  │  • Presence indicators        │  │  ◄── NEW
│  └───────────┬───────────────────┘  │
│              │ HTTPS/WSS             │
│  ┌───────────▼───────────────────┐  │
│  │ Rust Core                     │  │
│  │  • Desktop notifications      │  │  ◄── NEW (Tauri plugin)
│  └───────────────────────────────┘  │
└──────────┬──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Community Server (Express Backend)  │
│  • User accounts & auth              │
│  • Permission system                 │
│  • MC server management              │
│  • WebSocket server (extended)       │  ◄── NEW message types
│  │   - Console events (existing)     │
│  │   - Chat messages                 │  ◄── NEW
│  │   - Presence updates              │  ◄── NEW
│  │   - Friend events                 │  ◄── NEW
│  └───► SQLite (extended schema)      │
│       - users, servers (existing)    │
│       - friendships                  │  ◄── NEW
│       - channels                     │  ◄── NEW
│       - messages                     │  ◄── NEW
│       - message_reads                │  ◄── NEW
└──────────────────────────────────────┘
```

### Project Structure Changes

```
packages/
  backend/
    src/
      routes/
        friends.ts                    # NEW — Friend CRUD + requests
        channels.ts                   # NEW — Channel CRUD
        messages.ts                   # NEW — Message history, send
      services/
        friend-manager.ts             # NEW — Friend request logic
        presence-manager.ts           # NEW — Track online users
        channel-manager.ts            # NEW — Channel permissions
        message-manager.ts            # NEW — Message persistence
      ws/
        handlers.ts                   # MODIFIED — Add chat/friend/presence handlers
      models/
        friendship.ts                 # NEW — DB queries for friendships
        channel.ts                    # NEW — DB queries for channels
        message.ts                    # NEW — DB queries for messages
    migrations/
      006_friends_chat.sql            # NEW — All tables for this epic

  frontend/
    src/
      pages/
        Chat.tsx                      # NEW — Main chat view
      components/
        chat/
          ChatSidebar.tsx             # NEW — Friends + channels list
          MessageList.tsx             # NEW — Virtualized message list
          MessageInput.tsx            # NEW — Markdown input
          FriendsList.tsx             # NEW — Friends with presence
          ChannelList.tsx             # NEW — Text channels
          FriendRequestModal.tsx      # NEW — Send/accept requests
          TypingIndicator.tsx         # NEW — "User is typing..."
        presence/
          PresenceBadge.tsx           # NEW — Online/offline/in-game indicator
      stores/
        chatStore.ts                  # NEW — Chat state (messages, channels)
        friendStore.ts                # NEW — Friends + presence state
      api/
        friends.ts                    # NEW — Friend API client
        channels.ts                   # NEW — Channel API client
        messages.ts                   # NEW — Message API client

shared/
  src/
    types/
      chat.ts                         # NEW — Message, Channel types
      friend.ts                       # NEW — Friendship, Presence types
```

---

## Phase 6A: Database Schema & Migrations

### 6A.1: Friendships table

```sql
-- Friendships are bidirectional but stored as directed edges.
-- When user A sends a request to user B:
--   1. Insert (user_id=A, friend_id=B, status='pending')
-- When B accepts:
--   1. Update status='accepted'
--   2. Insert reverse edge (user_id=B, friend_id=A, status='accepted')
-- This allows efficient queries: "SELECT * FROM friendships WHERE user_id=? AND status='accepted'"

CREATE TABLE friendships (
  id            TEXT PRIMARY KEY,                    -- nanoid
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'accepted' | 'rejected'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(user_id, friend_id),                        -- Prevent duplicate requests
  CHECK(user_id != friend_id),                       -- Can't friend yourself
  CHECK(status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX idx_friendships_user ON friendships(user_id, status);
CREATE INDEX idx_friendships_friend ON friendships(friend_id, status);
```

### 6A.2: Channels table

```sql
-- Channels represent both text channels and DM channels.
-- Text channels: type='text', created_by is set, name is set
-- DM channels: type='dm', created_by is NULL, name is NULL (derived from participants)

CREATE TABLE channels (
  id            TEXT PRIMARY KEY,                    -- nanoid
  type          TEXT NOT NULL DEFAULT 'text',        -- 'text' | 'dm'
  name          TEXT,                                -- NULL for DMs
  description   TEXT,                                -- NULL for DMs
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL for DMs
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK(type IN ('text', 'dm')),
  CHECK(
    (type = 'text' AND name IS NOT NULL) OR
    (type = 'dm' AND name IS NULL)
  )
);

CREATE INDEX idx_channels_type ON channels(type);
CREATE INDEX idx_channels_created_by ON channels(created_by);
```

### 6A.3: Channel members table

```sql
-- Many-to-many: users ↔ channels
-- For text channels: all community members are auto-added on channel creation
-- For DM channels: exactly 2 members (the two users in the DM)

CREATE TABLE channel_members (
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON channel_members(user_id);
```

### 6A.4: Messages table

```sql
-- All messages (text channel + DM) stored here.
-- Partitioning by channel_id for efficient queries.

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,                    -- nanoid
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,                       -- Markdown text
  type          TEXT NOT NULL DEFAULT 'text',        -- 'text' | 'system'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at     TEXT,                                -- NULL if never edited
  
  CHECK(type IN ('text', 'system')),
  CHECK(length(content) > 0 AND length(content) <= 4000)  -- 4KB limit
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
```

### 6A.5: Message reads table

```sql
-- Track last read message per user per channel.
-- Used for unread counts and read indicators.

CREATE TABLE message_reads (
  channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_msg_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_message_reads_user ON message_reads(user_id);
```

### 6A.6: Migration file

Create `packages/backend/migrations/006_friends_chat.sql`:

```sql
-- Epic 6: Friends & Text Chat
-- All tables for friend system, presence, and messaging

-- Friendships
CREATE TABLE friendships (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(user_id, friend_id),
  CHECK(user_id != friend_id),
  CHECK(status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX idx_friendships_user ON friendships(user_id, status);
CREATE INDEX idx_friendships_friend ON friendships(friend_id, status);

-- Channels (text channels + DM channels)
CREATE TABLE channels (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'text',
  name          TEXT,
  description   TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK(type IN ('text', 'dm')),
  CHECK(
    (type = 'text' AND name IS NOT NULL) OR
    (type = 'dm' AND name IS NULL)
  )
);

CREATE INDEX idx_channels_type ON channels(type);
CREATE INDEX idx_channels_created_by ON channels(created_by);

-- Channel members
CREATE TABLE channel_members (
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON channel_members(user_id);

-- Messages
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'text',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at     TEXT,
  
  CHECK(type IN ('text', 'system')),
  CHECK(length(content) > 0 AND length(content) <= 4000)
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- Message reads
CREATE TABLE message_reads (
  channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_msg_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_message_reads_user ON message_reads(user_id);
```

**Files created**: `packages/backend/migrations/006_friends_chat.sql`

---

## Phase 6B: Shared TypeScript Types

### 6B.1: Friend types

Create `shared/src/types/friend.ts`:

```typescript
export type FriendshipStatus = 'pending' | 'accepted' | 'rejected';

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export type PresenceStatus = 'online' | 'offline' | 'in-game';

export interface Presence {
  userId: string;
  status: PresenceStatus;
  details?: {
    serverId?: string;      // If in-game
    serverName?: string;    // If in-game
  };
  lastSeen: string;
}

export interface Friend {
  id: string;               // User ID
  username: string;
  displayName: string;
  presence: Presence;
}

export interface FriendRequest {
  id: string;               // Friendship ID
  fromUser: {
    id: string;
    username: string;
    displayName: string;
  };
  createdAt: string;
}
```

### 6B.2: Chat types

Create `shared/src/types/chat.ts`:

```typescript
export type ChannelType = 'text' | 'dm';
export type MessageType = 'text' | 'system';

export interface Channel {
  id: string;
  type: ChannelType;
  name: string | null;      // NULL for DMs
  description: string | null;
  createdBy: string | null; // NULL for DMs
  createdAt: string;
  updatedAt: string;
  
  // Computed fields (not in DB)
  unreadCount?: number;
  lastMessage?: Message;
  members?: ChannelMember[];
}

export interface ChannelMember {
  userId: string;
  username: string;
  displayName: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  content: string;
  type: MessageType;
  createdAt: string;
  editedAt: string | null;
}

export interface MessageRead {
  channelId: string;
  userId: string;
  lastReadMessageId: string;
  updatedAt: string;
}

export interface TypingEvent {
  channelId: string;
  userId: string;
  username: string;
}
```

### 6B.3: WebSocket message types

Add to `shared/src/types/ws.ts` (or create if it doesn't exist):

```typescript
// Existing console/server events from previous epics...

// ============================================================================
// FRIEND EVENTS
// ============================================================================

export interface FriendRequestMessage {
  type: 'friend:request';
  toUserId: string;
}

export interface FriendAcceptMessage {
  type: 'friend:accept';
  friendshipId: string;
}

export interface FriendRejectMessage {
  type: 'friend:reject';
  friendshipId: string;
}

export interface FriendRemoveMessage {
  type: 'friend:remove';
  friendId: string;
}

export interface FriendRequestReceivedEvent {
  type: 'friend:request_received';
  request: FriendRequest;
}

export interface FriendStatusChangedEvent {
  type: 'friend:status_changed';
  friendshipId: string;
  status: FriendshipStatus;
}

export interface FriendListEvent {
  type: 'friend:list';
  friends: Friend[];
}

// ============================================================================
// PRESENCE EVENTS
// ============================================================================

export interface PresenceUpdateEvent {
  type: 'presence:update';
  userId: string;
  presence: Presence;
}

// ============================================================================
// CHAT EVENTS
// ============================================================================

export interface ChatSendMessage {
  type: 'chat:send';
  channelId: string;
  content: string;
}

export interface ChatTypingMessage {
  type: 'chat:typing';
  channelId: string;
}

export interface ChatMessageEvent {
  type: 'chat:message';
  message: Message;
}

export interface ChatHistoryEvent {
  type: 'chat:history';
  channelId: string;
  messages: Message[];
  hasMore: boolean;
}

export interface ChatTypingEvent {
  type: 'chat:typing';
  channelId: string;
  userId: string;
  username: string;
}

// ============================================================================
// UNION TYPES
// ============================================================================

export type ClientMessage =
  // Existing server management messages...
  | FriendRequestMessage
  | FriendAcceptMessage
  | FriendRejectMessage
  | FriendRemoveMessage
  | ChatSendMessage
  | ChatTypingMessage;

export type ServerMessage =
  // Existing server management events...
  | FriendRequestReceivedEvent
  | FriendStatusChangedEvent
  | FriendListEvent
  | PresenceUpdateEvent
  | ChatMessageEvent
  | ChatHistoryEvent
  | ChatTypingEvent;
```

**Files created**: `shared/src/types/friend.ts`, `shared/src/types/chat.ts`
**Files modified**: `shared/src/types/ws.ts` (or created), `shared/src/index.ts` (export new types)

---

## Phase 6C: Backend — Friend System

### 6C.1: Friendship model

Create `packages/backend/src/models/friendship.ts`:

```typescript
import { db } from '../services/database.js';
import { nanoid } from 'nanoid';
import type { Friendship, FriendshipStatus } from '@mc-server-manager/shared';

export function createFriendRequest(userId: string, friendId: string): Friendship {
  const id = nanoid();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO friendships (id, user_id, friend_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `);
  
  stmt.run(id, userId, friendId, now, now);
  
  return {
    id,
    userId,
    friendId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateFriendshipStatus(
  friendshipId: string,
  status: FriendshipStatus
): void {
  const stmt = db.prepare(`
    UPDATE friendships
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  
  stmt.run(status, friendshipId);
}

export function createReverseFriendship(friendshipId: string): void {
  // When a friend request is accepted, create the reverse edge
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId) as Friendship;
  
  if (!friendship || friendship.status !== 'accepted') {
    throw new Error('Cannot create reverse friendship for non-accepted request');
  }
  
  const reverseId = nanoid();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO friendships (id, user_id, friend_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'accepted', ?, ?)
    ON CONFLICT(user_id, friend_id) DO UPDATE SET status = 'accepted', updated_at = ?
  `);
  
  stmt.run(reverseId, friendship.friendId, friendship.userId, now, now, now);
}

export function getFriendship(userId: string, friendId: string): Friendship | null {
  const stmt = db.prepare(`
    SELECT * FROM friendships
    WHERE user_id = ? AND friend_id = ?
  `);
  
  return stmt.get(userId, friendId) as Friendship | null;
}

export function getFriendshipById(id: string): Friendship | null {
  const stmt = db.prepare('SELECT * FROM friendships WHERE id = ?');
  return stmt.get(id) as Friendship | null;
}

export function getFriends(userId: string): Friendship[] {
  const stmt = db.prepare(`
    SELECT * FROM friendships
    WHERE user_id = ? AND status = 'accepted'
    ORDER BY updated_at DESC
  `);
  
  return stmt.all(userId) as Friendship[];
}

export function getPendingRequests(userId: string): Friendship[] {
  const stmt = db.prepare(`
    SELECT * FROM friendships
    WHERE friend_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `);
  
  return stmt.all(userId) as Friendship[];
}

export function deleteFriendship(userId: string, friendId: string): void {
  // Delete both directions
  const stmt = db.prepare(`
    DELETE FROM friendships
    WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
  `);
  
  stmt.run(userId, friendId, friendId, userId);
}
```

### 6C.2: Friend manager service

Create `packages/backend/src/services/friend-manager.ts`:

```typescript
import * as friendshipModel from '../models/friendship.js';
import * as userModel from '../models/user.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import type { Friend, FriendRequest } from '@mc-server-manager/shared';
import { presenceManager } from './presence-manager.js';

export class FriendManager {
  async sendFriendRequest(fromUserId: string, toUsername: string): Promise<void> {
    const toUser = userModel.getUserByUsername(toUsername);
    if (!toUser) {
      throw new NotFoundError('User not found');
    }
    
    if (fromUserId === toUser.id) {
      throw new ConflictError('Cannot send friend request to yourself');
    }
    
    // Check if already friends or request exists
    const existing = friendshipModel.getFriendship(fromUserId, toUser.id);
    if (existing) {
      if (existing.status === 'accepted') {
        throw new ConflictError('Already friends');
      }
      if (existing.status === 'pending') {
        throw new ConflictError('Friend request already sent');
      }
    }
    
    // Check reverse direction (they sent you a request)
    const reverse = friendshipModel.getFriendship(toUser.id, fromUserId);
    if (reverse?.status === 'pending') {
      throw new ConflictError('This user has already sent you a friend request');
    }
    
    friendshipModel.createFriendRequest(fromUserId, toUser.id);
  }
  
  async acceptFriendRequest(userId: string, friendshipId: string): Promise<void> {
    const friendship = friendshipModel.getFriendshipById(friendshipId);
    
    if (!friendship) {
      throw new NotFoundError('Friend request not found');
    }
    
    if (friendship.friendId !== userId) {
      throw new ForbiddenError('Not your friend request');
    }
    
    if (friendship.status !== 'pending') {
      throw new ConflictError('Friend request already processed');
    }
    
    friendshipModel.updateFriendshipStatus(friendshipId, 'accepted');
    friendshipModel.createReverseFriendship(friendshipId);
  }
  
  async rejectFriendRequest(userId: string, friendshipId: string): Promise<void> {
    const friendship = friendshipModel.getFriendshipById(friendshipId);
    
    if (!friendship) {
      throw new NotFoundError('Friend request not found');
    }
    
    if (friendship.friendId !== userId) {
      throw new ForbiddenError('Not your friend request');
    }
    
    friendshipModel.updateFriendshipStatus(friendshipId, 'rejected');
  }
  
  async removeFriend(userId: string, friendId: string): Promise<void> {
    const friendship = friendshipModel.getFriendship(userId, friendId);
    
    if (!friendship || friendship.status !== 'accepted') {
      throw new NotFoundError('Not friends');
    }
    
    friendshipModel.deleteFriendship(userId, friendId);
  }
  
  getFriends(userId: string): Friend[] {
    const friendships = friendshipModel.getFriends(userId);
    
    return friendships.map(f => {
      const user = userModel.getUserById(f.friendId);
      if (!user) throw new Error('Friend user not found');
      
      const presence = presenceManager.getPresence(f.friendId);
      
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        presence,
      };
    });
  }
  
  getPendingRequests(userId: string): FriendRequest[] {
    const friendships = friendshipModel.getPendingRequests(userId);
    
    return friendships.map(f => {
      const user = userModel.getUserById(f.userId);
      if (!user) throw new Error('Requester user not found');
      
      return {
        id: f.id,
        fromUser: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
        },
        createdAt: f.createdAt,
      };
    });
  }
}

export const friendManager = new FriendManager();
```

### 6C.3: Friend routes

Create `packages/backend/src/routes/friends.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { friendManager } from '../services/friend-manager.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Send friend request
const sendRequestSchema = z.object({
  username: z.string().min(1).max(32),
});

router.post('/request', async (req, res, next) => {
  try {
    const { username } = sendRequestSchema.parse(req.body);
    await friendManager.sendFriendRequest(req.user!.id, username);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Accept friend request
router.post('/:friendshipId/accept', async (req, res, next) => {
  try {
    await friendManager.acceptFriendRequest(req.user!.id, req.params.friendshipId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Reject friend request
router.post('/:friendshipId/reject', async (req, res, next) => {
  try {
    await friendManager.rejectFriendRequest(req.user!.id, req.params.friendshipId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Remove friend
router.delete('/:friendId', async (req, res, next) => {
  try {
    await friendManager.removeFriend(req.user!.id, req.params.friendId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Get friends list
router.get('/', (req, res, next) => {
  try {
    const friends = friendManager.getFriends(req.user!.id);
    res.json(friends);
  } catch (err) {
    next(err);
  }
});

// Get pending requests
router.get('/requests', (req, res, next) => {
  try {
    const requests = friendManager.getPendingRequests(req.user!.id);
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

export default router;
```

**Files created**: `packages/backend/src/models/friendship.ts`, `packages/backend/src/services/friend-manager.ts`, `packages/backend/src/routes/friends.ts`
**Files modified**: `packages/backend/src/app.ts` (register `/api/friends` route)

---

## Phase 6D: Backend — Presence System

### 6D.1: Presence manager service

Create `packages/backend/src/services/presence-manager.ts`:

```typescript
import type { Presence, PresenceStatus } from '@mc-server-manager/shared';
import { EventEmitter } from 'events';

interface PresenceData {
  userId: string;
  status: PresenceStatus;
  details?: {
    serverId?: string;
    serverName?: string;
  };
  lastSeen: string;
}

export class PresenceManager extends EventEmitter {
  private presences = new Map<string, PresenceData>();
  
  setOnline(userId: string): void {
    const presence: PresenceData = {
      userId,
      status: 'online',
      lastSeen: new Date().toISOString(),
    };
    
    this.presences.set(userId, presence);
    this.emit('presence:changed', presence);
  }
  
  setOffline(userId: string): void {
    const existing = this.presences.get(userId);
    
    const presence: PresenceData = {
      userId,
      status: 'offline',
      lastSeen: new Date().toISOString(),
    };
    
    this.presences.set(userId, presence);
    this.emit('presence:changed', presence);
  }
  
  setInGame(userId: string, serverId: string, serverName: string): void {
    const presence: PresenceData = {
      userId,
      status: 'in-game',
      details: { serverId, serverName },
      lastSeen: new Date().toISOString(),
    };
    
    this.presences.set(userId, presence);
    this.emit('presence:changed', presence);
  }
  
  getPresence(userId: string): Presence {
    const data = this.presences.get(userId);
    
    if (!data) {
      return {
        userId,
        status: 'offline',
        lastSeen: new Date().toISOString(),
      };
    }
    
    return data;
  }
  
  getAllPresences(): Map<string, Presence> {
    return new Map(this.presences);
  }
}

export const presenceManager = new PresenceManager();
```

### 6D.2: Wire presence to WebSocket connections

Modify `packages/backend/src/ws/index.ts`:

```typescript
// Existing imports...
import { presenceManager } from '../services/presence-manager.js';

// In the WebSocket connection handler:
ws.on('connection', (socket, req) => {
  const userId = authenticateWebSocket(req);  // From Epic 5
  
  if (!userId) {
    socket.close(1008, 'Unauthorized');
    return;
  }
  
  // Set user online
  presenceManager.setOnline(userId);
  
  // Store userId on socket for later reference
  (socket as any).userId = userId;
  
  socket.on('close', () => {
    presenceManager.setOffline(userId);
  });
  
  // Existing message handlers...
});
```

### 6D.3: Wire presence to MC server player tracking

Modify `packages/backend/src/services/server-manager.ts`:

```typescript
// In the ServerProcess class, when parsing player join/leave:

// When a player joins:
private handlePlayerJoin(username: string): void {
  // Existing logic to track player...
  
  // Find user by MC username (requires linking MC username to user account)
  const user = userModel.getUserByMinecraftUsername(username);
  if (user) {
    presenceManager.setInGame(user.id, this.serverId, this.serverName);
  }
}

// When a player leaves:
private handlePlayerLeave(username: string): void {
  // Existing logic...
  
  const user = userModel.getUserByMinecraftUsername(username);
  if (user) {
    presenceManager.setOnline(user.id);  // Back to online (not in-game)
  }
}
```

**Note**: This requires linking Minecraft usernames to user accounts. This can be added to the `users` table as a `minecraft_username` column (nullable). Users can set it in their profile settings.

**Files created**: `packages/backend/src/services/presence-manager.ts`
**Files modified**: `packages/backend/src/ws/index.ts`, `packages/backend/src/services/server-manager.ts`

---

## Phase 6E: Backend — Channels & Messages

### 6E.1: Channel model

Create `packages/backend/src/models/channel.ts`:

```typescript
import { db } from '../services/database.js';
import { nanoid } from 'nanoid';
import type { Channel, ChannelType, ChannelMember } from '@mc-server-manager/shared';

export function createChannel(
  type: ChannelType,
  name: string | null,
  description: string | null,
  createdBy: string | null
): Channel {
  const id = nanoid();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO channels (id, type, name, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, type, name, description, createdBy, now, now);
  
  return {
    id,
    type,
    name,
    description,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function getChannelById(id: string): Channel | null {
  const stmt = db.prepare('SELECT * FROM channels WHERE id = ?');
  return stmt.get(id) as Channel | null;
}

export function getTextChannels(): Channel[] {
  const stmt = db.prepare(`
    SELECT * FROM channels
    WHERE type = 'text'
    ORDER BY created_at ASC
  `);
  
  return stmt.all() as Channel[];
}

export function getUserChannels(userId: string): Channel[] {
  const stmt = db.prepare(`
    SELECT c.* FROM channels c
    JOIN channel_members cm ON cm.channel_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `);
  
  return stmt.all(userId) as Channel[];
}

export function getDMChannel(user1Id: string, user2Id: string): Channel | null {
  const stmt = db.prepare(`
    SELECT c.* FROM channels c
    JOIN channel_members cm1 ON cm1.channel_id = c.id AND cm1.user_id = ?
    JOIN channel_members cm2 ON cm2.channel_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'dm'
    LIMIT 1
  `);
  
  return stmt.get(user1Id, user2Id) as Channel | null;
}

export function addChannelMember(channelId: string, userId: string): void {
  const stmt = db.prepare(`
    INSERT INTO channel_members (channel_id, user_id)
    VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `);
  
  stmt.run(channelId, userId);
}

export function getChannelMembers(channelId: string): ChannelMember[] {
  const stmt = db.prepare(`
    SELECT u.id as userId, u.username, u.display_name as displayName, cm.joined_at as joinedAt
    FROM channel_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.channel_id = ?
  `);
  
  return stmt.all(channelId) as ChannelMember[];
}

export function deleteChannel(id: string): void {
  const stmt = db.prepare('DELETE FROM channels WHERE id = ?');
  stmt.run(id);
}
```

### 6E.2: Message model

Create `packages/backend/src/models/message.ts`:

```typescript
import { db } from '../services/database.js';
import { nanoid } from 'nanoid';
import type { Message, MessageType } from '@mc-server-manager/shared';

export function createMessage(
  channelId: string,
  senderId: string,
  content: string,
  type: MessageType = 'text'
): Message {
  const id = nanoid();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO messages (id, channel_id, sender_id, content, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, channelId, senderId, content, type, now);
  
  // Update channel updated_at
  db.prepare('UPDATE channels SET updated_at = ? WHERE id = ?').run(now, channelId);
  
  // Fetch full message with sender info
  return getMessageById(id)!;
}

export function getMessageById(id: string): Message | null {
  const stmt = db.prepare(`
    SELECT 
      m.*,
      u.username as senderUsername,
      u.display_name as senderDisplayName
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `);
  
  const row = stmt.get(id) as any;
  if (!row) return null;
  
  return {
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    senderUsername: row.senderUsername,
    senderDisplayName: row.senderDisplayName,
    content: row.content,
    type: row.type,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export function getChannelMessages(
  channelId: string,
  limit: number = 50,
  before?: string  // Message ID to paginate before
): Message[] {
  let query = `
    SELECT 
      m.*,
      u.username as senderUsername,
      u.display_name as senderDisplayName
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.channel_id = ?
  `;
  
  const params: any[] = [channelId];
  
  if (before) {
    const beforeMsg = getMessageById(before);
    if (beforeMsg) {
      query += ' AND m.created_at < ?';
      params.push(beforeMsg.createdAt);
    }
  }
  
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);
  
  const rows = db.prepare(query).all(...params) as any[];
  
  return rows.map(row => ({
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    senderUsername: row.senderUsername,
    senderDisplayName: row.senderDisplayName,
    content: row.content,
    type: row.type,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  })).reverse();  // Reverse to get chronological order
}

export function updateMessageRead(
  channelId: string,
  userId: string,
  messageId: string
): void {
  const stmt = db.prepare(`
    INSERT INTO message_reads (channel_id, user_id, last_read_msg_id, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(channel_id, user_id) DO UPDATE SET
      last_read_msg_id = excluded.last_read_msg_id,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(channelId, userId, messageId);
}

export function getUnreadCount(channelId: string, userId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM messages m
    LEFT JOIN message_reads mr ON mr.channel_id = m.channel_id AND mr.user_id = ?
    WHERE m.channel_id = ?
      AND (mr.last_read_msg_id IS NULL OR m.created_at > (
        SELECT created_at FROM messages WHERE id = mr.last_read_msg_id
      ))
  `);
  
  const result = stmt.get(userId, channelId) as { count: number };
  return result.count;
}
```

### 6E.3: Channel manager service

Create `packages/backend/src/services/channel-manager.ts`:

```typescript
import * as channelModel from '../models/channel.js';
import * as userModel from '../models/user.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import type { Channel } from '@mc-server-manager/shared';

export class ChannelManager {
  createTextChannel(name: string, description: string, createdBy: string): Channel {
    // Only Owner/Admin can create text channels (check permission from Epic 5)
    const user = userModel.getUserById(createdBy);
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      throw new ForbiddenError('Only admins can create text channels');
    }
    
    const channel = channelModel.createChannel('text', name, description, createdBy);
    
    // Add all users to the channel
    const allUsers = userModel.getAllUsers();
    allUsers.forEach(u => {
      channelModel.addChannelMember(channel.id, u.id);
    });
    
    return channel;
  }
  
  getOrCreateDMChannel(user1Id: string, user2Id: string): Channel {
    // Check if DM channel already exists
    let channel = channelModel.getDMChannel(user1Id, user2Id);
    
    if (!channel) {
      // Create new DM channel
      channel = channelModel.createChannel('dm', null, null, null);
      channelModel.addChannelMember(channel.id, user1Id);
      channelModel.addChannelMember(channel.id, user2Id);
    }
    
    return channel;
  }
  
  getUserChannels(userId: string): Channel[] {
    return channelModel.getUserChannels(userId);
  }
  
  deleteTextChannel(channelId: string, userId: string): void {
    const channel = channelModel.getChannelById(channelId);
    
    if (!channel) {
      throw new NotFoundError('Channel not found');
    }
    
    if (channel.type !== 'text') {
      throw new ForbiddenError('Cannot delete DM channels');
    }
    
    const user = userModel.getUserById(userId);
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      throw new ForbiddenError('Only admins can delete text channels');
    }
    
    channelModel.deleteChannel(channelId);
  }
}

export const channelManager = new ChannelManager();
```

### 6E.4: Message manager service

Create `packages/backend/src/services/message-manager.ts`:

```typescript
import * as messageModel from '../models/message.js';
import * as channelModel from '../models/channel.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import type { Message } from '@mc-server-manager/shared';

export class MessageManager {
  sendMessage(channelId: string, senderId: string, content: string): Message {
    const channel = channelModel.getChannelById(channelId);
    
    if (!channel) {
      throw new NotFoundError('Channel not found');
    }
    
    // Verify user is a member of the channel
    const members = channelModel.getChannelMembers(channelId);
    const isMember = members.some(m => m.userId === senderId);
    
    if (!isMember) {
      throw new ForbiddenError('Not a member of this channel');
    }
    
    return messageModel.createMessage(channelId, senderId, content, 'text');
  }
  
  getMessages(channelId: string, userId: string, limit: number = 50, before?: string): Message[] {
    const channel = channelModel.getChannelById(channelId);
    
    if (!channel) {
      throw new NotFoundError('Channel not found');
    }
    
    // Verify user is a member
    const members = channelModel.getChannelMembers(channelId);
    const isMember = members.some(m => m.userId === userId);
    
    if (!isMember) {
      throw new ForbiddenError('Not a member of this channel');
    }
    
    return messageModel.getChannelMessages(channelId, limit, before);
  }
  
  markRead(channelId: string, userId: string, messageId: string): void {
    messageModel.updateMessageRead(channelId, userId, messageId);
  }
}

export const messageManager = new MessageManager();
```

### 6E.5: Channel routes

Create `packages/backend/src/routes/channels.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { channelManager } from '../services/channel-manager.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Create text channel
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const { name, description } = createChannelSchema.parse(req.body);
    const channel = channelManager.createTextChannel(name, description || '', req.user!.id);
    res.status(201).json(channel);
  } catch (err) {
    next(err);
  }
});

// Get user's channels
router.get('/', (req, res, next) => {
  try {
    const channels = channelManager.getUserChannels(req.user!.id);
    res.json(channels);
  } catch (err) {
    next(err);
  }
});

// Get or create DM channel
router.post('/dm/:userId', async (req, res, next) => {
  try {
    const channel = channelManager.getOrCreateDMChannel(req.user!.id, req.params.userId);
    res.json(channel);
  } catch (err) {
    next(err);
  }
});

// Delete text channel
router.delete('/:channelId', async (req, res, next) => {
  try {
    channelManager.deleteTextChannel(req.params.channelId, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
```

### 6E.6: Message routes

Create `packages/backend/src/routes/messages.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { messageManager } from '../services/message-manager.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get channel messages
router.get('/:channelId', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before as string | undefined;
    
    const messages = messageManager.getMessages(req.params.channelId, req.user!.id, limit, before);
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Mark messages as read
const markReadSchema = z.object({
  messageId: z.string(),
});

router.post('/:channelId/read', async (req, res, next) => {
  try {
    const { messageId } = markReadSchema.parse(req.body);
    messageManager.markRead(req.params.channelId, req.user!.id, messageId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
```

**Files created**: `packages/backend/src/models/channel.ts`, `packages/backend/src/models/message.ts`, `packages/backend/src/services/channel-manager.ts`, `packages/backend/src/services/message-manager.ts`, `packages/backend/src/routes/channels.ts`, `packages/backend/src/routes/messages.ts`
**Files modified**: `packages/backend/src/app.ts` (register routes)

---

## Phase 6F: Backend — WebSocket Protocol Extensions

### 6F.1: WebSocket message handlers

Modify `packages/backend/src/ws/handlers.ts`:

```typescript
// Existing imports...
import { friendManager } from '../services/friend-manager.js';
import { presenceManager } from '../services/presence-manager.js';
import { messageManager } from '../services/message-manager.js';
import { channelManager } from '../services/channel-manager.js';
import type { ClientMessage, ServerMessage } from '@mc-server-manager/shared';

// Track typing timeouts
const typingTimeouts = new Map<string, NodeJS.Timeout>();

export function handleClientMessage(socket: WebSocket, userId: string, message: ClientMessage): void {
  switch (message.type) {
    // ========================================================================
    // EXISTING HANDLERS (console, server control, etc.)
    // ========================================================================
    
    // ... existing cases ...
    
    // ========================================================================
    // FRIEND HANDLERS
    // ========================================================================
    
    case 'friend:request': {
      // Friend requests are sent via REST API, not WS
      // But we could support it here too for convenience
      break;
    }
    
    case 'friend:accept': {
      friendManager.acceptFriendRequest(userId, message.friendshipId)
        .then(() => {
          // Broadcast to both users
          const friendship = friendshipModel.getFriendshipById(message.friendshipId);
          if (friendship) {
            broadcastToUser(friendship.userId, {
              type: 'friend:status_changed',
              friendshipId: message.friendshipId,
              status: 'accepted',
            });
            broadcastToUser(friendship.friendId, {
              type: 'friend:status_changed',
              friendshipId: message.friendshipId,
              status: 'accepted',
            });
          }
        })
        .catch(err => {
          sendError(socket, err.message);
        });
      break;
    }
    
    case 'friend:reject': {
      friendManager.rejectFriendRequest(userId, message.friendshipId)
        .then(() => {
          const friendship = friendshipModel.getFriendshipById(message.friendshipId);
          if (friendship) {
            broadcastToUser(friendship.userId, {
              type: 'friend:status_changed',
              friendshipId: message.friendshipId,
              status: 'rejected',
            });
          }
        })
        .catch(err => {
          sendError(socket, err.message);
        });
      break;
    }
    
    case 'friend:remove': {
      friendManager.removeFriend(userId, message.friendId)
        .then(() => {
          broadcastToUser(message.friendId, {
            type: 'friend:status_changed',
            friendshipId: '', // Not applicable
            status: 'rejected', // Treat as unfriended
          });
        })
        .catch(err => {
          sendError(socket, err.message);
        });
      break;
    }
    
    // ========================================================================
    // CHAT HANDLERS
    // ========================================================================
    
    case 'chat:send': {
      try {
        const msg = messageManager.sendMessage(message.channelId, userId, message.content);
        
        // Broadcast to all channel members
        broadcastToChannel(message.channelId, {
          type: 'chat:message',
          message: msg,
        });
      } catch (err: any) {
        sendError(socket, err.message);
      }
      break;
    }
    
    case 'chat:typing': {
      // Broadcast typing indicator to channel members (except sender)
      const user = userModel.getUserById(userId);
      if (user) {
        broadcastToChannel(message.channelId, {
          type: 'chat:typing',
          channelId: message.channelId,
          userId,
          username: user.username,
        }, userId);  // Exclude sender
        
        // Clear previous timeout
        const key = `${userId}:${message.channelId}`;
        if (typingTimeouts.has(key)) {
          clearTimeout(typingTimeouts.get(key)!);
        }
        
        // Auto-clear typing after 3 seconds
        typingTimeouts.set(key, setTimeout(() => {
          typingTimeouts.delete(key);
        }, 3000));
      }
      break;
    }
  }
}

// ============================================================================
// BROADCAST HELPERS
// ============================================================================

function broadcastToUser(userId: string, message: ServerMessage): void {
  // Find all sockets for this user
  wss.clients.forEach(client => {
    if ((client as any).userId === userId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastToChannel(channelId: string, message: ServerMessage, excludeUserId?: string): void {
  const members = channelModel.getChannelMembers(channelId);
  
  members.forEach(member => {
    if (member.userId !== excludeUserId) {
      broadcastToUser(member.userId, message);
    }
  });
}

function sendError(socket: WebSocket, message: string): void {
  socket.send(JSON.stringify({
    type: 'error',
    message,
  }));
}
```

### 6F.2: Presence change broadcasts

Modify `packages/backend/src/services/presence-manager.ts`:

```typescript
// In PresenceManager class:

setOnline(userId: string): void {
  const presence: PresenceData = {
    userId,
    status: 'online',
    lastSeen: new Date().toISOString(),
  };
  
  this.presences.set(userId, presence);
  this.emit('presence:changed', presence);
  
  // Broadcast to friends
  this.broadcastPresenceToFriends(userId, presence);
}

// Similar for setOffline and setInGame...

private broadcastPresenceToFriends(userId: string, presence: PresenceData): void {
  const friends = friendshipModel.getFriends(userId);
  
  friends.forEach(f => {
    broadcastToUser(f.friendId, {
      type: 'presence:update',
      userId,
      presence,
    });
  });
}
```

**Files modified**: `packages/backend/src/ws/handlers.ts`, `packages/backend/src/services/presence-manager.ts`

---

## Phase 6G: Frontend — Chat UI

### 6G.1: Chat store

Create `packages/frontend/src/stores/chatStore.ts`:

```typescript
import { create } from 'zustand';
import type { Channel, Message } from '@mc-server-manager/shared';

interface ChatState {
  channels: Channel[];
  messages: Map<string, Message[]>;  // channelId -> messages
  activeChannelId: string | null;
  typingUsers: Map<string, Set<string>>;  // channelId -> Set<userId>
  
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setActiveChannel: (channelId: string | null) => void;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  addTypingUser: (channelId: string, userId: string) => void;
  removeTypingUser: (channelId: string, userId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  messages: new Map(),
  activeChannelId: null,
  typingUsers: new Map(),
  
  setChannels: (channels) => set({ channels }),
  
  addChannel: (channel) => set((state) => ({
    channels: [...state.channels, channel],
  })),
  
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
  
  setMessages: (channelId, messages) => set((state) => {
    const newMessages = new Map(state.messages);
    newMessages.set(channelId, messages);
    return { messages: newMessages };
  }),
  
  addMessage: (message) => set((state) => {
    const newMessages = new Map(state.messages);
    const channelMessages = newMessages.get(message.channelId) || [];
    newMessages.set(message.channelId, [...channelMessages, message]);
    return { messages: newMessages };
  }),
  
  addTypingUser: (channelId, userId) => set((state) => {
    const newTyping = new Map(state.typingUsers);
    const users = newTyping.get(channelId) || new Set();
    users.add(userId);
    newTyping.set(channelId, users);
    return { typingUsers: newTyping };
  }),
  
  removeTypingUser: (channelId, userId) => set((state) => {
    const newTyping = new Map(state.typingUsers);
    const users = newTyping.get(channelId);
    if (users) {
      users.delete(userId);
      if (users.size === 0) {
        newTyping.delete(channelId);
      } else {
        newTyping.set(channelId, users);
      }
    }
    return { typingUsers: newTyping };
  }),
}));
```

### 6G.2: Friend store

Create `packages/frontend/src/stores/friendStore.ts`:

```typescript
import { create } from 'zustand';
import type { Friend, FriendRequest, Presence } from '@mc-server-manager/shared';

interface FriendState {
  friends: Friend[];
  requests: FriendRequest[];
  
  setFriends: (friends: Friend[]) => void;
  setRequests: (requests: FriendRequest[]) => void;
  updatePresence: (userId: string, presence: Presence) => void;
  addRequest: (request: FriendRequest) => void;
  removeRequest: (requestId: string) => void;
}

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  requests: [],
  
  setFriends: (friends) => set({ friends }),
  
  setRequests: (requests) => set({ requests }),
  
  updatePresence: (userId, presence) => set((state) => ({
    friends: state.friends.map(f =>
      f.id === userId ? { ...f, presence } : f
    ),
  })),
  
  addRequest: (request) => set((state) => ({
    requests: [...state.requests, request],
  })),
  
  removeRequest: (requestId) => set((state) => ({
    requests: state.requests.filter(r => r.id !== requestId),
  })),
}));
```

### 6G.3: Wire WebSocket events to stores

Modify `packages/frontend/src/api/ws.ts`:

```typescript
// Existing WebSocket setup...
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.type) {
    // Existing cases (console, status, etc.)...
    
    case 'chat:message':
      useChatStore.getState().addMessage(msg.message);
      break;
    
    case 'chat:typing':
      useChatStore.getState().addTypingUser(msg.channelId, msg.userId);
      setTimeout(() => {
        useChatStore.getState().removeTypingUser(msg.channelId, msg.userId);
      }, 3000);
      break;
    
    case 'presence:update':
      useFriendStore.getState().updatePresence(msg.userId, msg.presence);
      break;
    
    case 'friend:request_received':
      useFriendStore.getState().addRequest(msg.request);
      // Show desktop notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Friend Request', {
          body: `${msg.request.fromUser.username} sent you a friend request`,
        });
      }
      break;
    
    case 'friend:status_changed':
      // Refresh friends list
      // (Could be optimized to update in-place)
      break;
  }
};
```

### 6G.4: Message list component

Create `packages/frontend/src/components/chat/MessageList.tsx`:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect } from 'react';
import type { Message } from '@mc-server-manager/shared';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length]);
  
  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-4">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const message = messages[item.index];
          
          return (
            <div
              key={message.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
              className="mb-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold">
                  {message.senderUsername[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{message.senderDisplayName}</span>
                    <span className="text-xs text-slate-400">
                      {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 6G.5: Message input component

Create `packages/frontend/src/components/chat/MessageInput.tsx`:

```typescript
import { useState, useRef } from 'react';
import { ws } from '../../api/ws';

interface MessageInputProps {
  channelId: string;
}

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState('');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    
    // Send typing indicator
    ws.send(JSON.stringify({
      type: 'chat:typing',
      channelId,
    }));
    
    // Debounce typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
    }, 3000);
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim()) return;
    
    ws.send(JSON.stringify({
      type: 'chat:send',
      channelId,
      content: content.trim(),
    }));
    
    setContent('');
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-slate-700">
      <textarea
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Shift+Enter for new line)"
        className="w-full bg-slate-800 text-white rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={3}
        maxLength={4000}
      />
      <div className="flex justify-between items-center mt-2">
        <span className="text-xs text-slate-400">
          Markdown supported: **bold**, *italic*, `code`, [links](url)
        </span>
        <button
          type="submit"
          disabled={!content.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Send
        </button>
      </div>
    </form>
  );
}
```

### 6G.6: Chat page

Create `packages/frontend/src/pages/Chat.tsx`:

```typescript
import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { MessageList } from '../components/chat/MessageList';
import { MessageInput } from '../components/chat/MessageInput';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { fetchChannels, fetchMessages } from '../api/channels';

export default function Chat() {
  const { channels, activeChannelId, messages, setChannels, setMessages, setActiveChannel } = useChatStore();
  
  useEffect(() => {
    // Load channels on mount
    fetchChannels().then(setChannels);
  }, [setChannels]);
  
  useEffect(() => {
    // Load messages when active channel changes
    if (activeChannelId) {
      fetchMessages(activeChannelId).then(msgs => {
        setMessages(activeChannelId, msgs);
      });
    }
  }, [activeChannelId, setMessages]);
  
  const activeChannel = channels.find(c => c.id === activeChannelId);
  const activeMessages = activeChannelId ? messages.get(activeChannelId) || [] : [];
  
  return (
    <div className="flex h-screen">
      <ChatSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelectChannel={setActiveChannel}
      />
      
      <div className="flex-1 flex flex-col">
        {activeChannel ? (
          <>
            <div className="h-16 border-b border-slate-700 flex items-center px-6">
              <h2 className="text-xl font-semibold">
                {activeChannel.type === 'text' ? `# ${activeChannel.name}` : activeChannel.name}
              </h2>
            </div>
            
            <MessageList messages={activeMessages} />
            <MessageInput channelId={activeChannelId!} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            Select a channel to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
```

**Files created**: `packages/frontend/src/stores/chatStore.ts`, `packages/frontend/src/stores/friendStore.ts`, `packages/frontend/src/components/chat/MessageList.tsx`, `packages/frontend/src/components/chat/MessageInput.tsx`, `packages/frontend/src/pages/Chat.tsx`
**Files modified**: `packages/frontend/src/api/ws.ts`, `packages/frontend/src/App.tsx` (add Chat route)

---

## Phase 6H: Desktop Notifications

### 6H.1: Tauri notification plugin

The Tauri notification plugin is already available from Epic 1. Wire it up for new messages and friend requests.

Modify `packages/frontend/src/api/ws.ts`:

```typescript
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

// On app init:
async function initNotifications() {
  if (isTauri()) {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }
  }
}

initNotifications();

// In WebSocket message handler:
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.type) {
    case 'chat:message':
      useChatStore.getState().addMessage(msg.message);
      
      // Show notification if not in active channel
      const activeChannelId = useChatStore.getState().activeChannelId;
      if (msg.message.channelId !== activeChannelId) {
        if (isTauri()) {
          sendNotification({
            title: msg.message.senderDisplayName,
            body: msg.message.content.substring(0, 100),
          });
        }
      }
      break;
    
    case 'friend:request_received':
      useFriendStore.getState().addRequest(msg.request);
      
      if (isTauri()) {
        sendNotification({
          title: 'Friend Request',
          body: `${msg.request.fromUser.username} sent you a friend request`,
        });
      }
      break;
  }
};
```

**Files modified**: `packages/frontend/src/api/ws.ts`

---

## Implementation Order

| Order | Phase | Effort | Deliverable |
|-------|-------|--------|-------------|
| 1 | **6A** (database schema) | ~2h | Migration file, all tables created |
| 2 | **6B** (shared types) | ~1h | TypeScript types for friends, chat, WS messages |
| 3 | **6C** (friend system backend) | ~4h | Friend requests, accept/reject, friends list |
| 4 | **6D** (presence system) | ~3h | Online/offline/in-game tracking, WS integration |
| 5 | **6E** (channels & messages backend) | ~5h | Text channels, DMs, message persistence |
| 6 | **6F** (WebSocket protocol) | ~3h | Chat/friend/presence message handlers |
| 7 | **6G** (chat UI) | ~5h | Message list, input, chat page, stores |
| 8 | **6H** (notifications) | ~2h | Desktop notifications for messages and requests |

**Total: ~25 hours**

---

## Complete File Change Summary

### New Files (30+)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/backend/migrations/006_friends_chat.sql` | 6A | All database tables |
| `shared/src/types/friend.ts` | 6B | Friend and presence types |
| `shared/src/types/chat.ts` | 6B | Channel and message types |
| `shared/src/types/ws.ts` | 6B | WebSocket message types |
| `packages/backend/src/models/friendship.ts` | 6C | Friendship DB queries |
| `packages/backend/src/services/friend-manager.ts` | 6C | Friend request logic |
| `packages/backend/src/routes/friends.ts` | 6C | Friend REST API |
| `packages/backend/src/services/presence-manager.ts` | 6D | Presence tracking |
| `packages/backend/src/models/channel.ts` | 6E | Channel DB queries |
| `packages/backend/src/models/message.ts` | 6E | Message DB queries |
| `packages/backend/src/services/channel-manager.ts` | 6E | Channel permissions |
| `packages/backend/src/services/message-manager.ts` | 6E | Message persistence |
| `packages/backend/src/routes/channels.ts` | 6E | Channel REST API |
| `packages/backend/src/routes/messages.ts` | 6E | Message REST API |
| `packages/frontend/src/stores/chatStore.ts` | 6G | Chat state management |
| `packages/frontend/src/stores/friendStore.ts` | 6G | Friend state management |
| `packages/frontend/src/components/chat/MessageList.tsx` | 6G | Virtualized message list |
| `packages/frontend/src/components/chat/MessageInput.tsx` | 6G | Markdown message input |
| `packages/frontend/src/components/chat/ChatSidebar.tsx` | 6G | Friends + channels sidebar |
| `packages/frontend/src/components/chat/FriendsList.tsx` | 6G | Friends with presence |
| `packages/frontend/src/components/chat/ChannelList.tsx` | 6G | Text channels list |
| `packages/frontend/src/components/chat/FriendRequestModal.tsx` | 6G | Send/accept requests |
| `packages/frontend/src/components/chat/TypingIndicator.tsx` | 6G | "User is typing..." |
| `packages/frontend/src/components/presence/PresenceBadge.tsx` | 6G | Online/offline indicator |
| `packages/frontend/src/pages/Chat.tsx` | 6G | Main chat view |
| `packages/frontend/src/api/friends.ts` | 6G | Friend API client |
| `packages/frontend/src/api/channels.ts` | 6G | Channel API client |
| `packages/frontend/src/api/messages.ts` | 6G | Message API client |

### Modified Files (8)

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/index.ts` | 6B | Export new types |
| `packages/backend/src/app.ts` | 6C, 6E | Register friend/channel/message routes |
| `packages/backend/src/ws/index.ts` | 6D | Set presence on connect/disconnect |
| `packages/backend/src/ws/handlers.ts` | 6F | Add chat/friend/presence handlers |
| `packages/backend/src/services/server-manager.ts` | 6D | Update presence on player join/leave |
| `packages/backend/src/models/user.ts` | 6D | Add `minecraft_username` column (optional) |
| `packages/frontend/src/api/ws.ts` | 6G, 6H | Wire WS events to stores, notifications |
| `packages/frontend/src/App.tsx` | 6G | Add Chat route |

---

## Risks & Mitigations

### High

| Risk | Mitigation |
|------|------------|
| Message volume causes performance issues | Virtualized rendering (@tanstack/react-virtual) for message list. Pagination (50 messages per fetch). Index on `(channel_id, created_at)` for fast queries. |
| WebSocket connection drops during chat | Auto-reconnect logic (already in place from Epic 1). Re-fetch recent messages on reconnect. Show "reconnecting..." indicator. |
| Presence state gets out of sync | Presence is derived from WS connection state (source of truth). On reconnect, presence is re-established. Periodic cleanup of stale presence (every 5 minutes). |

### Medium

| Risk | Mitigation |
|------|------------|
| Typing indicators spam the server | Debounce on client (max 1 event per 3 seconds). Auto-clear on server after 3 seconds. No persistence. |
| Unread counts become inaccurate | Update `message_reads` on every message view. Query unread count on channel list load. Index on `(channel_id, user_id)` for fast lookups. |
| DM channel creation race condition | Use `ON CONFLICT DO NOTHING` in `channel_members` insert. Query for existing DM channel before creating. |
| Markdown XSS vulnerability | Use `react-markdown` with default settings (sanitizes HTML). No `dangerouslySetInnerHTML`. Limit allowed markdown features (no raw HTML). |

### Low

| Risk | Mitigation |
|------|------------|
| Message edit/delete not implemented in v1 | Acceptable. Can be added in a future iteration. Schema already has `edited_at` column. |
| No file uploads | Acceptable for v1. Keep it simple. Can add in future with file storage service. |
| No emoji picker | Acceptable. Users can paste Unicode emoji. Picker can be added later. |

---

## Testing Checklist

1. **Friend system**: Send request → accept → see in friends list → remove friend
2. **Friend requests**: Receive request → reject → request disappears
3. **Presence**: User connects → shows online → joins MC server → shows in-game → leaves → shows online → disconnects → shows offline
4. **Text channels**: Admin creates channel → all users see it → send messages → all members receive
5. **Direct messages**: Open DM with friend → send message → friend receives → reply works
6. **Typing indicators**: Type in channel → other users see "User is typing..." → stops after 3s
7. **Unread counts**: Receive message in inactive channel → unread count increments → open channel → count clears
8. **Desktop notifications**: Receive message while in different channel → notification appears
9. **Message history**: Scroll up → load older messages (pagination)
10. **Markdown rendering**: Send **bold**, *italic*, `code`, [link](url) → renders correctly
11. **WebSocket reconnect**: Disconnect network → reconnect → messages still work
12. **Presence sync**: Restart app → presence state is correct for all friends
