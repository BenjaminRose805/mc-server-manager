# AGENTS.md -- Frontend Package

React SPA for MC Server Manager. Provides a browser-based dashboard for managing Minecraft servers with real-time console output via WebSocket.

## Package Info

- **Name**: `@mc-server-manager/frontend`
- **Entry**: `index.html` -> `src/main.tsx`
- **Dev**: `vite` (port 5173, proxies `/api` and `/ws` to backend on 3001)
- **Build**: `tsc -b && vite build` -> `dist/`
- **Runtime deps**: react 19, react-router 7, zustand 5, @tanstack/react-virtual, lucide-react, sonner, clsx, tailwind-merge

## Directory Structure

```
index.html                -- SPA entry point
vite.config.ts            -- Vite config: React plugin, Tailwind CSS v4, proxy settings
src/
  main.tsx                -- React root (StrictMode + ErrorBoundary)
  App.tsx                 -- BrowserRouter + Routes + Toaster
  index.css               -- Single line: @import "tailwindcss"
  api/
    client.ts             -- REST API fetch wrapper (typed methods for all endpoints)
    ws.ts                 -- WebSocket client singleton with auto-reconnect
  hooks/
    useConsole.ts         -- WS subscribe/unsubscribe lifecycle per server
  stores/
    serverStore.ts        -- Zustand store (servers, console, WS state) + WS event wiring
  pages/
    Dashboard.tsx         -- Server grid with status cards
    CreateServer.tsx      -- 4-step creation wizard
    ServerDetail.tsx      -- Tabbed server view (Console, Settings)
    AppSettings.tsx       -- Java path, data dir, JVM defaults
  components/
    Layout.tsx            -- Sidebar + main content shell
    Console.tsx           -- Virtualized terminal with command input + history
    ServerCard.tsx        -- Dashboard card (name, status, players, uptime)
    StatusBadge.tsx       -- Colored status indicator
    ServerControls.tsx    -- Start/Stop/Restart/Kill buttons
    ServerStats.tsx       -- Real-time stats display
    PropertiesForm.tsx    -- server.properties grouped editor
    ErrorBoundary.tsx     -- Global error boundary
  lib/
    utils.ts              -- cn() utility (clsx + tailwind-merge)
```

## State Architecture

### Zustand Store (`stores/serverStore.ts`)
- **Single source of truth** for all server state in the frontend
- `servers: ServerWithStatus[]` -- full server list with runtime status
- `consoleLines: Record<serverId, ConsoleLine[]>` -- per-server console buffers (capped at 2000 lines)
- `wsConnected: boolean` -- WebSocket connection state
- Actions: `fetchServers()`, `updateServerStatus()`, `removeServer()`, `appendConsole()`, `setConsoleHistory()`, `clearConsole()`

### WebSocket Event Wiring
- `initWebSocket()` is called once (lazily, not at import time to avoid SSR issues)
- Registers handlers on the WS client that write directly to Zustand store
- Incoming `console` messages -> `appendConsole()`
- Incoming `console:history` messages -> `setConsoleHistory()`
- Incoming `status` messages -> `updateServerStatus()` + toast notification on meaningful transitions
- Incoming `stats` messages -> `updateServerStatus()` (playerCount, players, uptime)
- Incoming `error` messages -> `toast.error()`

### WebSocket Client (`api/ws.ts`)
- Singleton `WsClient` class with auto-reconnect (exponential backoff: 1s -> 30s cap)
- URL lazily built from `window.location` (never accessed at import time)
- `send()`, `connect()`, `disconnect()` methods
- Listener registration: `onMessage()`, `onConnect()`, `onDisconnect()` -- all return unsubscribe functions

### Console Subscription (`hooks/useConsole.ts`)
- Custom hook that manages WS `subscribe`/`unsubscribe` for a specific server
- Subscribes on mount, unsubscribes on unmount
- Re-subscribes on WS reconnect (via `onConnect` handler)
- Clears console lines on unmount

## Pages

### Dashboard (`pages/Dashboard.tsx`)
- Fetches servers on mount via `fetchServers()`
- Renders grid of `ServerCard` components
- Loading/empty/error states
- "Create Server" button links to `/servers/new`

### CreateServer (`pages/CreateServer.tsx`)
- 4-step wizard: Server Type -> Version -> Configuration (name, port, memory) -> Review & Create
- Fetches available MC versions from `/api/versions/vanilla`
- Fetches Java info from `/api/system/java` for compatibility warnings
- On submit: creates server via POST, starts JAR download if needed, redirects to server detail

### ServerDetail (`pages/ServerDetail.tsx`)
- Tabbed interface: Console (default), Settings
- Uses `useConsole` hook for WS subscription lifecycle
- Fetches server data on mount and shows real-time updates via store
- Tab content: `Console` component, `PropertiesForm` component

### AppSettings (`pages/AppSettings.tsx`)
- Java path configuration
- Data directory display
- Default JVM arguments
- System info display (platform, RAM, CPUs)

## Key Components

### Console (`components/Console.tsx`)
- **Terminal-like UI** with monospace font, dark background, auto-scroll
- Uses `@tanstack/react-virtual` for virtualized rendering (handles high-volume output)
- Command input at bottom with history (up/down arrow navigation)
- Sends commands via WS `command` message
- Auto-scrolls to bottom on new output (unless user has scrolled up)

### ServerControls (`components/ServerControls.tsx`)
- Start/Stop/Restart/Kill buttons
- Contextual disabling: can't start if running, can't stop if stopped, etc.
- Loading states during transitions
- Kill button is destructive (shown only when other methods fail)

### PropertiesForm (`components/PropertiesForm.tsx`)
- Renders `server.properties` as a form with grouped sections (gameplay, network, world, advanced)
- Uses property metadata from backend (`PropertyGroup[]`) for labels, descriptions, types
- Shows warning banner if server is running (changes require restart)
- Saves via PUT `/api/servers/:id/properties`

### Layout (`components/Layout.tsx`)
- Sidebar with server list + navigation
- Main content area
- Responsive design

## Routing

```
/                  -> Dashboard
/servers/new       -> CreateServer
/servers/:id       -> ServerDetail
/settings          -> AppSettings
```

All routing via React Router v7 with `BrowserRouter`.

## Styling

- **Tailwind CSS v4** (configured via `@tailwindcss/vite` plugin)
- No separate CSS files beyond `index.css` (which just imports tailwindcss)
- `cn()` utility from `lib/utils.ts` (clsx + tailwind-merge) for conditional classes
- Dark background theme for console component
- No component library -- hand-built components with Tailwind utility classes

## API Client (`api/client.ts`)

Typed fetch wrapper with methods:
- `getServers()`, `getServer(id)`, `createServer(data)`, `updateServer(id, data)`, `deleteServer(id, deleteFiles?)`
- `startServer(id)`, `stopServer(id)`, `restartServer(id)`, `killServer(id)`
- `sendCommand(id, command)`, `getConsole(id)`
- `getProperties(id)`, `updateProperties(id, data)`
- `getJavaInfo()`, `getSystemInfo()`, `getSettings()`, `updateSettings(data)`
- `getVersions()`, `startDownload(data)`, `getDownloadStatus(jobId)`

All methods handle error responses and throw with meaningful messages.

## Conventions Specific to Frontend

- Path alias `@/*` maps to `src/*` (configured in vite.config.ts and tsconfig.json)
- Pages use default exports (only exception to no-default-export rule)
- Components are named exports
- WebSocket initialization is deferred (never at module scope) to avoid SSR/build issues
- Toast notifications (sonner) for all user-facing feedback
- No prop drilling -- components read from Zustand store directly where needed
