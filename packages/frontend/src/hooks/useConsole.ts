import { useEffect, useCallback, useRef } from 'react';
import { wsClient } from '@/api/ws';
import { useServerStore, type ConsoleLine } from '@/stores/serverStore';

// ---------------------------------------------------------------------------
// useConsole — manages WS subscription lifecycle for a single server's console
// ---------------------------------------------------------------------------

interface UseConsoleReturn {
  /** Console lines for this server */
  lines: ConsoleLine[];
  /** Whether the WebSocket is connected */
  connected: boolean;
  /** Send a command to the server's stdin */
  sendCommand: (command: string) => void;
  /** Clear the local console buffer */
  clear: () => void;
}

const EMPTY_LINES: ConsoleLine[] = [];

export function useConsole(serverId: string | undefined): UseConsoleReturn {
  const lines = useServerStore(
    (s) => (serverId ? s.consoleLines[serverId] ?? EMPTY_LINES : EMPTY_LINES),
  );
  const connected = useServerStore((s) => s.wsConnected);
  const clearConsole = useServerStore((s) => s.clearConsole);

  // Track the serverId we're subscribed to so we can unsub correctly even
  // if the component re-renders with a new id before the effect cleans up.
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serverId) return;

    // Subscribe on mount / when serverId changes
    const subscribe = () => {
      wsClient.send({ type: 'subscribe', serverId });
      subscribedRef.current = serverId;
    };

    // If already connected, subscribe immediately
    if (wsClient.connected) {
      subscribe();
    }

    // Also subscribe on (re)connect so we automatically re-subscribe
    // after a dropped connection.
    const offConnect = wsClient.onConnect(() => {
      if (subscribedRef.current !== serverId) {
        // The server changed while we were disconnected — unsubscribe old
        if (subscribedRef.current) {
          wsClient.send({ type: 'unsubscribe', serverId: subscribedRef.current });
        }
      }
      subscribe();
    });

    return () => {
      // Unsubscribe on unmount / serverId change
      if (subscribedRef.current) {
        wsClient.send({ type: 'unsubscribe', serverId: subscribedRef.current });
        subscribedRef.current = null;
      }
      offConnect();
    };
  }, [serverId]);

  const sendCommand = useCallback(
    (command: string) => {
      if (!serverId) return;
      wsClient.send({ type: 'command', serverId, command });
    },
    [serverId],
  );

  const clear = useCallback(() => {
    if (serverId) clearConsole(serverId);
  }, [serverId, clearConsole]);

  return { lines, connected, sendCommand, clear };
}
