import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Send, Trash2, ArrowDownToLine, WifiOff } from 'lucide-react';
import { useConsole } from '@/hooks/useConsole';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Console — terminal-like live server output with command input
// ---------------------------------------------------------------------------

interface ConsoleProps {
  serverId: string;
  className?: string;
}

/** Format an ISO timestamp to a short HH:MM:SS string */
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function Console({ serverId, className }: ConsoleProps) {
  const { lines, connected, sendCommand, clear } = useConsole(serverId);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);

  const parentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Virtualizer ----
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20, // approx line height in px
    overscan: 40,
  });

  // ---- Auto-scroll to bottom when new lines arrive ----
  useEffect(() => {
    if (autoScroll && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
    }
  }, [lines.length, autoScroll, virtualizer]);

  // ---- Detect manual scroll (user scrolls up → disable auto-scroll) ----
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    // If user is within 60px of the bottom, re-enable auto-scroll
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  // ---- Command submission ----
  const submitCommand = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sendCommand(trimmed);
    setCommandHistory((prev) => {
      // Avoid duplicates at the end
      if (prev[prev.length - 1] === trimmed) return prev;
      return [...prev, trimmed];
    });
    setHistoryIndex(-1);
    setInput('');
  }, [input, sendCommand]);

  // ---- Keyboard navigation (up/down for history, enter to send) ----
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCommand();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIdx =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInput(commandHistory[nextIdx]);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(nextIdx);
        setInput(commandHistory[nextIdx]);
      }
    }
  };

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    if (lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
    }
  }, [lines.length, virtualizer]);

  // Focus input when clicking on the console area
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-400">Console</span>
          {!connected && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
              <WifiOff className="h-3 w-3" />
              Reconnecting...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!autoScroll && (
            <button
              onClick={scrollToBottom}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              title="Scroll to bottom"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={clear}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Clear console"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Console output (virtualized) */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onClick={focusInput}
        className="flex-1 overflow-auto font-mono text-[13px] leading-5 cursor-text"
        style={{ minHeight: 0 }} // allow flex shrink
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-600">
            {connected
              ? 'No console output yet. Start the server to see output here.'
              : 'Connecting to server...'}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = lines[virtualRow.index];
              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex px-3 hover:bg-zinc-900/60"
                >
                  <span className="mr-3 shrink-0 select-none text-zinc-600">
                    {fmtTime(entry.timestamp)}
                  </span>
                  <span className="whitespace-pre-wrap break-all text-zinc-300">
                    {entry.line}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Command input */}
      <div className="flex items-center border-t border-zinc-800 px-3 py-2">
        <span className="mr-2 select-none text-sm font-bold text-emerald-400">
          &gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent font-mono text-sm text-zinc-200 placeholder:text-zinc-600 outline-none"
        />
        <button
          onClick={submitCommand}
          disabled={!input.trim()}
          className="ml-2 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
          title="Send command"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
