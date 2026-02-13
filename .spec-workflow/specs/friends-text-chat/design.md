# Design Document -- Friends & Text Chat

## Overview

Add a social layer to MC Server Manager: friend system with presence tracking, direct messages, text channels, typing indicators, unread tracking, and desktop notifications. All real-time communication extends the existing WebSocket infrastructure with new message types. Message persistence uses the existing SQLite database. The UI adds a chat page with a sidebar (friends + channels) and a message view.

## Steering Document Alignment

No steering docs exist. This design follows existing project conventions (Express routes, Zod validation, SQLite models, Zustand stores, Tailwind UI, WebSocket message protocol with `type` discriminator).

## Code Reuse Analysis

### Existing Components to Leverage
- **WebSocket server (`packages/backend/src/ws/`)**: Already handles real-time messaging for console output. Extended with new message types for chat, presence, and friend events. Same connection, same protocol pattern.
- **WebSocket client (`packages/frontend/src/api/ws.ts`)**: `WsClient` with auto-reconnect. Extended to handle new server message types and dispatch to new stores.
- **Zustand store pattern (`packages/frontend/src/stores/serverStore.ts`)**: Pattern for new `chatStore.ts` and `friendStore.ts`. WebSocket events write directly to stores.
- **@tanstack/react-virtual**: Already used for console output virtualization. Reused for message list rendering.
- **Auth middleware (`packages/backend/src/middleware/auth.ts`)**: All new routes require `requireAuth`. Channel creation requires `requireAdminOrOwner`.
- **Error classes (`packages/backend/src/utils/errors.ts`)**: `NotFoundError`, `ConflictError`, `ForbiddenError` used in friend/channel/message services.
- **Zod validation**: All new route handlers use Zod schemas following existing patterns.
- **Pino logger**: Existing logger for friend/chat event logging.
- **Electron Notification API**: Available from the Electron package for desktop notifications.

### Integration Points
- **`users` table**: Foreign key target for friendships, channel_members, messages. Uses `minecraft_username` and `minecraft_uuid` columns from Epic 5's users table (migration 009) for in-game presence detection. No additional column changes needed.
- **WebSocket connection lifecycle**: Presence set online/offline on connect/disconnect. User ID already attached to socket from Epic 5 auth.
- **Server process player tracking**: Parse player join/leave log lines to update presence to "in-game".
- **Express app (`app.ts`)**: Mount new routes for friends, channels, messages.
- **Frontend routing (`App.tsx`)**: Add `/chat` route for chat page.

## Architecture

### Message Flow

```
User A types message in channel
  --> Client sends WS: { type: 'chat:send', channelId, content }
  --> Server validates (member check, content length)
  --> Server persists to messages table (with sender info JOIN)
  --> Server broadcasts to all channel members:
      { type: 'chat:message', message: { id, channelId, senderId, senderUsername, content, createdAt } }
  --> Each recipient's WsClient dispatches to chatStore.addMessage()
  --> React re-renders MessageList with new message
  --> If recipient is not viewing that channel: unread count increments + desktop notification
```

### Presence Flow

```
User connects via WebSocket
  --> Server: presenceManager.setOnline(userId)
  --> Server broadcasts to all friends: { type: 'presence:update', userId, presence: { status: 'online' } }
  --> Friends' friendStore.updatePresence() updates UI

User joins MC server (detected via log parsing)
  --> Server: presenceManager.setInGame(userId, serverId, serverName)
  --> Broadcast to friends: { type: 'presence:update', ..., presence: { status: 'in-game', details: { serverName } } }

User disconnects
  --> Server: presenceManager.setOffline(userId)
  --> Broadcast to friends: { type: 'presence:update', ..., presence: { status: 'offline' } }
```

### Friend Request Flow

```
User A sends request to User B (by username)
  --> POST /api/friends/request { username: 'B' }
  --> Server validates (not self, not duplicate, user exists)
  --> Insert friendship (user_id=A, friend_id=B, status='pending')
  --> WS broadcast to B: { type: 'friend:request_received', request: { id, fromUser: {...} } }
  --> B sees notification + pending request in UI

User B accepts
  --> POST /api/friends/:friendshipId/accept
  --> Update status to 'accepted'
  --> Insert reverse edge (user_id=B, friend_id=A, status='accepted')
  --> WS broadcast to both: { type: 'friend:status_changed', status: 'accepted' }
```

### Modular Design Principles
- **Unified Channel Model**: Both DMs and text channels are stored in the same `channels` table with a `type` discriminator. Unified message storage, rendering, and unread tracking.
- **Service Separation**: `FriendManager`, `PresenceManager`, `ChannelManager`, `MessageManager` are each in separate files with single responsibilities.
- **Store Separation**: `chatStore` (channels, messages, typing) and `friendStore` (friends, presence, requests) are separate Zustand stores.
- **Component Isolation**: Chat components (`MessageList`, `MessageInput`, `ChatSidebar`, `FriendsList`, `ChannelList`, `PresenceBadge`, `TypingIndicator`) are small, focused, and reusable.
- **WebSocket Protocol Extension**: New message types follow the existing `{ type: string, ...payload }` discriminated union pattern.

## Components and Interfaces

### Component 1: Friendship Model (`packages/backend/src/models/friendship.ts`)
- **Purpose**: CRUD for friendships table -- create request, update status, create reverse edge, query friends/pending, delete both directions
- **Interfaces**: `createFriendRequest(userId, friendId)`, `updateFriendshipStatus(id, status)`, `createReverseFriendship(id)`, `getFriendship(userId, friendId)`, `getFriends(userId)`, `getPendingRequests(userId)`, `deleteFriendship(userId, friendId)`
- **Dependencies**: Database module, nanoid
- **Reuses**: Existing model patterns (prepared statements, snake_case to camelCase mapping)

### Component 2: FriendManager Service (`packages/backend/src/services/friend-manager.ts`)
- **Purpose**: Business logic for friend requests -- validation, duplicate checking, accept/reject flow
- **Interfaces**: `sendFriendRequest(fromUserId, toUsername)`, `acceptFriendRequest(userId, friendshipId)`, `rejectFriendRequest(userId, friendshipId)`, `removeFriend(userId, friendId)`, `getFriends(userId): Friend[]`, `getPendingRequests(userId): FriendRequest[]`
- **Dependencies**: Friendship model, user model, PresenceManager, error classes
- **Reuses**: Error classes (ConflictError, NotFoundError, ForbiddenError)

### Component 3: PresenceManager Service (`packages/backend/src/services/presence-manager.ts`)
- **Purpose**: In-memory presence tracking (online/offline/in-game) with event emission for broadcasting
- **Interfaces**: `setOnline(userId)`, `setOffline(userId)`, `setInGame(userId, serverId, serverName)`, `getPresence(userId): Presence`, `getAllPresences(): Map`
- **Dependencies**: EventEmitter (Node built-in), friendship model (for broadcasting to friends)
- **Reuses**: None (new in-memory service, extends EventEmitter)

### Component 4: Channel Model (`packages/backend/src/models/channel.ts`)
- **Purpose**: CRUD for channels and channel_members tables
- **Interfaces**: `createChannel(type, name, description, createdBy)`, `getChannelById(id)`, `getTextChannels()`, `getUserChannels(userId)`, `getDMChannel(user1Id, user2Id)`, `addChannelMember(channelId, userId)`, `getChannelMembers(channelId)`, `deleteChannel(id)`
- **Dependencies**: Database module, nanoid
- **Reuses**: Existing model patterns

### Component 5: Message Model (`packages/backend/src/models/message.ts`)
- **Purpose**: CRUD for messages and message_reads tables, with pagination and unread counting
- **Interfaces**: `createMessage(channelId, senderId, content, type)`, `getMessageById(id)`, `getChannelMessages(channelId, limit, before?)`, `updateMessageRead(channelId, userId, messageId)`, `getUnreadCount(channelId, userId)`
- **Dependencies**: Database module, nanoid
- **Reuses**: Existing model patterns. Messages JOIN with users table for sender info.

### Component 6: ChannelManager Service (`packages/backend/src/services/channel-manager.ts`)
- **Purpose**: Channel business logic -- create text channels (admin only, auto-add all members), get-or-create DM channels (idempotent), delete text channels
- **Interfaces**: `createTextChannel(name, description, createdBy)`, `getOrCreateDMChannel(user1Id, user2Id)`, `getUserChannels(userId)`, `deleteTextChannel(channelId, userId)`
- **Dependencies**: Channel model, user model, error classes
- **Reuses**: Error classes

### Component 7: MessageManager Service (`packages/backend/src/services/message-manager.ts`)
- **Purpose**: Message business logic -- send (with membership validation), get with pagination, mark read
- **Interfaces**: `sendMessage(channelId, senderId, content): Message`, `getMessages(channelId, userId, limit, before?)`, `markRead(channelId, userId, messageId)`
- **Dependencies**: Message model, channel model, error classes
- **Reuses**: Error classes

### Component 8: Friend Routes (`packages/backend/src/routes/friends.ts`)
- **Purpose**: REST API for friend operations
- **Endpoints**: `POST /api/friends/request`, `POST /api/friends/:id/accept`, `POST /api/friends/:id/reject`, `DELETE /api/friends/:id`, `GET /api/friends`, `GET /api/friends/requests`
- **Dependencies**: FriendManager, auth middleware, Zod
- **Reuses**: Route handler patterns

### Component 9: Channel Routes (`packages/backend/src/routes/channels.ts`)
- **Purpose**: REST API for channel CRUD
- **Endpoints**: `POST /api/channels`, `GET /api/channels`, `POST /api/channels/dm/:userId`, `DELETE /api/channels/:id`
- **Dependencies**: ChannelManager, auth middleware, Zod
- **Reuses**: Route handler patterns

### Component 10: Message Routes (`packages/backend/src/routes/messages.ts`)
- **Purpose**: REST API for message history and read tracking
- **Endpoints**: `GET /api/messages/:channelId`, `POST /api/messages/:channelId/read`
- **Dependencies**: MessageManager, auth middleware, Zod
- **Reuses**: Route handler patterns

### Component 11: WebSocket Chat/Friend/Presence Handlers (modify existing WS handler)
- **Purpose**: Handle real-time messages: `chat:send`, `chat:typing`, `friend:accept/reject/remove`, presence broadcasts
- **Interfaces**: Extended `handleClientMessage()` switch cases, `broadcastToUser()`, `broadcastToChannel()` helper functions
- **Dependencies**: FriendManager, MessageManager, PresenceManager, channel model
- **Reuses**: Existing WebSocket message handling pattern

### Component 12: Chat Store (`packages/frontend/src/stores/chatStore.ts`)
- **Purpose**: Zustand store for channels, messages (per-channel map), active channel, typing users
- **Interfaces**: `setChannels`, `addChannel`, `setActiveChannel`, `setMessages`, `addMessage`, `addTypingUser`, `removeTypingUser`
- **Dependencies**: Zustand
- **Reuses**: Store pattern from serverStore.ts

### Component 13: Friend Store (`packages/frontend/src/stores/friendStore.ts`)
- **Purpose**: Zustand store for friends list, pending requests, and presence updates
- **Interfaces**: `setFriends`, `setRequests`, `updatePresence`, `addRequest`, `removeRequest`
- **Dependencies**: Zustand
- **Reuses**: Store pattern from serverStore.ts

### Component 14: Chat Page (`packages/frontend/src/pages/Chat.tsx`)
- **Purpose**: Main chat view with sidebar + message area
- **Dependencies**: ChatSidebar, MessageList, MessageInput, chatStore, channel/message API clients
- **Reuses**: Page layout patterns

### Component 15: Chat UI Components (`packages/frontend/src/components/chat/`)
- **Purpose**: `MessageList` (virtualized), `MessageInput` (markdown + Enter to send), `ChatSidebar`, `FriendsList`, `ChannelList`, `FriendRequestModal`, `TypingIndicator`
- **Dependencies**: @tanstack/react-virtual, react-markdown (new dep), chatStore, friendStore, WS client
- **Reuses**: @tanstack/react-virtual (already used for console), Tailwind component patterns

### Component 16: PresenceBadge (`packages/frontend/src/components/presence/PresenceBadge.tsx`)
- **Purpose**: Small colored dot indicating online (green), in-game (amber), offline (gray)
- **Dependencies**: None (pure presentational)
- **Reuses**: Tailwind styling patterns

## Data Models

### friendships table
```sql
CREATE TABLE friendships (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, friend_id),
  CHECK(user_id != friend_id),
  CHECK(status IN ('pending', 'accepted', 'rejected'))
);
```
Bidirectional storage: when A befriends B, two rows exist (A->B and B->A) both with status='accepted'. Enables efficient `WHERE user_id = ? AND status = 'accepted'` queries.

### channels table
```sql
CREATE TABLE channels (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'text',       -- text | dm
  name          TEXT,                                -- NULL for DMs
  description   TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(type IN ('text', 'dm')),
  CHECK((type = 'text' AND name IS NOT NULL) OR (type = 'dm' AND name IS NULL))
);
```

### channel_members table
```sql
CREATE TABLE channel_members (
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, user_id)
);
```

### messages table
```sql
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'text',       -- text | system
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at     TEXT,
  CHECK(type IN ('text', 'system')),
  CHECK(length(content) > 0 AND length(content) <= 4000)
);
```
Indexed on `(channel_id, created_at DESC)` for paginated queries.

### message_reads table
```sql
CREATE TABLE message_reads (
  channel_id        TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_msg_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, user_id)
);
```

### Shared TypeScript Types

```typescript
// Friend types
export type FriendshipStatus = 'pending' | 'accepted' | 'rejected';
export type PresenceStatus = 'online' | 'offline' | 'in-game';

export interface Friendship { id, userId, friendId, status, createdAt, updatedAt }
export interface Presence { userId, status, details?: { serverId?, serverName? }, lastSeen }
export interface Friend { id, username, displayName, presence }
export interface FriendRequest { id, fromUser: { id, username, displayName }, createdAt }

// Chat types
export type ChannelType = 'text' | 'dm';
export type MessageType = 'text' | 'system';

export interface Channel { id, type, name, description, createdBy, createdAt, updatedAt, unreadCount?, lastMessage?, members? }
export interface ChannelMember { userId, username, displayName, joinedAt }
export interface Message { id, channelId, senderId, senderUsername, senderDisplayName, content, type, createdAt, editedAt }
export interface MessageRead { channelId, userId, lastReadMessageId, updatedAt }
export interface TypingEvent { channelId, userId, username }

// WebSocket message types (client -> server)
ChatSendMessage: { type: 'chat:send', channelId, content }
ChatTypingMessage: { type: 'chat:typing', channelId }

// WebSocket message types (server -> client)
ChatMessageEvent: { type: 'chat:message', message }
ChatTypingEvent: { type: 'chat:typing', channelId, userId, username }
PresenceUpdateEvent: { type: 'presence:update', userId, presence }
FriendRequestReceivedEvent: { type: 'friend:request_received', request }
FriendStatusChangedEvent: { type: 'friend:status_changed', friendshipId, status }
```

## Error Handling

### Error Scenarios

1. **Friend request to non-existent user**
   - **Handling**: Return 200 OK regardless of whether the target user exists (to prevent username enumeration). If the user doesn't exist, silently do nothing — no friendship record is created.
   - **User Impact**: "Friend request sent" toast (always, even if user doesn't exist).

2. **Duplicate friend request**
    - **Handling**: Return 409 ConflictError with specific message (already friends, already pending, reverse pending).
    - **User Impact**: "Already friends" / "Friend request already sent" / "This user has already sent you a request" toast.

3. **Message in channel user is not a member of**
   - **Handling**: Return 403 ForbiddenError. MessageManager checks channel membership before persisting.
   - **User Impact**: "Not a member of this channel" error (should not happen in normal UI flow).

4. **Message exceeds 4000 character limit**
   - **Handling**: Zod validation rejects at route level. DB CHECK constraint as safety net.
   - **User Impact**: Character counter in input prevents submission. Error toast if bypassed.

5. **DM to non-friend**
   - **Handling**: ChannelManager checks friendship exists before creating DM channel. Return 403.
   - **User Impact**: DM option only shown for friends in UI.

6. **WebSocket disconnect during chat**
   - **Handling**: Auto-reconnect (existing). On reconnect, re-fetch recent messages for active channel. Presence re-established.
   - **User Impact**: Brief "Reconnecting..." indicator, then seamless recovery.

7. **Text channel creation by non-admin**
   - **Handling**: ChannelManager checks user role. Return 403.
   - **User Impact**: Create channel button only visible to admin/owner.

## File Structure

### New Files
```
packages/backend/migrations/010_friends_chat.sql          # All social tables
packages/backend/src/models/friendship.ts                  # Friendship DB queries
packages/backend/src/models/channel.ts                     # Channel + member DB queries
packages/backend/src/models/message.ts                     # Message + read DB queries
packages/backend/src/services/friend-manager.ts            # Friend request logic
packages/backend/src/services/presence-manager.ts          # In-memory presence tracking
packages/backend/src/services/channel-manager.ts           # Channel business logic
packages/backend/src/services/message-manager.ts           # Message business logic
packages/backend/src/routes/friends.ts                     # Friend REST API
packages/backend/src/routes/channels.ts                    # Channel REST API
packages/backend/src/routes/messages.ts                    # Message REST API
packages/frontend/src/stores/chatStore.ts                  # Chat Zustand store
packages/frontend/src/stores/friendStore.ts                # Friend Zustand store
packages/frontend/src/pages/Chat.tsx                       # Main chat page
packages/frontend/src/components/chat/ChatSidebar.tsx      # Sidebar (friends + channels)
packages/frontend/src/components/chat/MessageList.tsx      # Virtualized message list
packages/frontend/src/components/chat/MessageInput.tsx     # Markdown input
packages/frontend/src/components/chat/FriendsList.tsx      # Friends with presence
packages/frontend/src/components/chat/ChannelList.tsx      # Text channel list
packages/frontend/src/components/chat/FriendRequestModal.tsx  # Send/accept requests
packages/frontend/src/components/chat/TypingIndicator.tsx  # "User is typing..."
packages/frontend/src/components/presence/PresenceBadge.tsx # Online/offline badge
packages/frontend/src/api/friends.ts                       # Friend API client
packages/frontend/src/api/channels.ts                      # Channel API client
packages/frontend/src/api/messages.ts                      # Message API client
```

### Modified Files
```
shared/src/index.ts                                        # Export friend, chat, WS types
packages/backend/src/app.ts                                # Mount friend/channel/message routes
packages/backend/src/ws/handlers.ts (or equivalent)        # Add chat/friend/presence WS handlers
packages/backend/src/ws/index.ts (or equivalent)           # Wire presence on connect/disconnect
packages/backend/src/services/server-manager.ts            # Update presence on player join/leave
packages/frontend/src/api/ws.ts                            # Handle new WS events, dispatch to stores
packages/frontend/src/App.tsx                              # Add /chat route
```

## Dependencies

### New Backend npm Packages
- None required. All functionality uses existing packages (ws, express, better-sqlite3, zod, nanoid, pino).

### New Frontend npm Packages
- `react-markdown` -- Render basic Markdown in messages (bold, italic, code, links).
- `date-fns` -- Format message timestamps as relative time ("2 minutes ago"). May already be available.

## Testing Strategy

### Unit Testing
- No automated test framework exists. Manual verification.
- Key verification: friend request lifecycle, message persistence, presence state machine, unread counting.

### Integration Testing
- **Friend system**: Send request -> accept -> appears in both friends lists -> remove -> disappears from both
- **Friend rejection**: Send request -> reject -> request removed, no friendship created
- **Presence**: Connect -> online broadcast to friends -> join MC server -> in-game broadcast -> disconnect -> offline broadcast
- **Text channels**: Admin creates -> all members see it -> send message -> all members receive via WS
- **DMs**: Open DM with friend -> creates channel -> send message -> friend receives -> reply works -> re-open DM returns same channel
- **Typing**: Type in channel -> other members see indicator -> stops after 3s
- **Unread**: Message arrives in inactive channel -> badge count increments -> open channel -> count resets
- **Pagination**: Send 100+ messages -> scroll up -> loads older batch -> messages in order
- **Notifications**: Message in non-active channel -> desktop notification appears

### End-to-End Testing
- Full social flow: Register two users -> send friend request -> accept -> open DM -> send messages back and forth -> see presence changes -> create text channel -> chat in channel
- Reconnect test: Disconnect network -> reconnect -> presence restored, missed messages loaded
