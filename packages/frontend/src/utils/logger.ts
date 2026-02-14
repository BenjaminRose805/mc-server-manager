import { getBackendBaseUrlSync } from "@/utils/desktop";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: string;
}

interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  flush(): void;
}

const isProd =
  typeof window !== "undefined" &&
  window.location.protocol !== "http:" &&
  !window.location.hostname.includes("localhost");

const isDebugSuppressed = (): boolean => {
  if (!isProd) return false;
  try {
    return localStorage.getItem("debug") !== "true";
  } catch {
    return true;
  }
};

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 3000;
const FLUSH_SIZE = 20;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
}

function flushBuffer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const entries = buffer;
  buffer = [];

  try {
    const base = getBackendBaseUrlSync();
    fetch(`${base}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget — log shipping must never break the app
    });
  } catch {
    // Logging must never break the app
  }
}

function enqueue(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length >= FLUSH_SIZE) {
    flushBuffer();
  } else {
    scheduleFlush();
  }
}

const log = (
  level: LogLevel,
  method: keyof Console,
  message: string,
  context?: LogContext,
): void => {
  try {
    if (level === "debug" && isDebugSuppressed()) return;
    const prefix = `[${level.toUpperCase()}]`;
    if (context) {
      (console[method] as (...args: unknown[]) => void)(
        `${prefix} ${message}`,
        context,
      );
    } else {
      (console[method] as (...args: unknown[]) => void)(`${prefix} ${message}`);
    }
  } catch {
    // Logging must never break the app
  }

  enqueue({ level, message, context, timestamp: new Date().toISOString() });
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushBuffer());
}

export const logger: Logger = {
  debug: (message, context?) => log("debug", "debug", message, context),
  info: (message, context?) => log("info", "info", message, context),
  warn: (message, context?) => log("warn", "warn", message, context),
  error: (message, context?) => log("error", "error", message, context),
  flush: flushBuffer,
};
