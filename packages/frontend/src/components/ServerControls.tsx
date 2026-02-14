import { useState, useCallback, useEffect } from "react";
import { Play, Square, RotateCcw, Skull, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { ServerStatus } from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { logger } from "@/utils/logger";

// ---------------------------------------------------------------------------
// ServerControls — Start/Stop/Restart/Kill buttons with contextual states
// ---------------------------------------------------------------------------

interface ServerControlsProps {
  serverId: string;
  status: ServerStatus;
  className?: string;
}

type ActionKind = "start" | "stop" | "restart" | "kill";

const ACTION_LABELS: Record<ActionKind, string> = {
  start: "Starting server...",
  stop: "Stopping server...",
  restart: "Restarting server...",
  kill: "Force killing server...",
};

/** Which actions are allowed in each status */
const allowedActions: Record<ServerStatus, Set<ActionKind>> = {
  stopped: new Set(["start"]),
  crashed: new Set(["start"]),
  running: new Set(["stop", "restart", "kill"]),
  starting: new Set(["kill"]), // allow force-kill if stuck starting
  stopping: new Set(["kill"]), // allow force-kill if stuck stopping
  provisioning: new Set([]), // no actions during provisioning
};

export function ServerControls({
  serverId,
  status,
  className,
}: ServerControlsProps) {
  const [loading, setLoading] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clear error when status changes (means something worked or user took another action)
  useEffect(() => {
    setError(null);
  }, [status]);

  const perform = useCallback(
    async (action: ActionKind) => {
      if (loading) return;
      setError(null);
      setLoading(action);
      try {
        switch (action) {
          case "start":
            await api.startServer(serverId);
            break;
          case "stop":
            await api.stopServer(serverId);
            break;
          case "restart":
            await api.restartServer(serverId);
            break;
          case "kill":
            await api.killServer(serverId);
            break;
        }
        toast.info(ACTION_LABELS[action]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : `Failed to ${action} server`;
        logger.warn(`Server ${action} failed`, { error: message, serverId });
        setError(message);
        toast.error(message);
      } finally {
        setLoading(null);
      }
    },
    [serverId, loading],
  );

  const allowed = allowedActions[status];

  const isTransitioning = status === "starting" || status === "stopping";

  return (
    <div className={cn("flex flex-col items-end gap-2", className)}>
      <div className="flex items-center gap-2">
        {/* Start */}
        <ControlButton
          label="Start"
          icon={Play}
          onClick={() => perform("start")}
          disabled={!allowed.has("start") || loading !== null}
          loading={loading === "start"}
          variant="success"
        />

        {/* Stop */}
        <ControlButton
          label="Stop"
          icon={Square}
          onClick={() => perform("stop")}
          disabled={!allowed.has("stop") || loading !== null}
          loading={loading === "stop"}
          variant="default"
        />

        {/* Restart */}
        <ControlButton
          label="Restart"
          icon={RotateCcw}
          onClick={() => perform("restart")}
          disabled={!allowed.has("restart") || loading !== null}
          loading={loading === "restart"}
          variant="default"
        />

        {/* Kill — only visible when transitioning or explicitly allowed as fallback */}
        {(isTransitioning || loading !== null) && (
          <ControlButton
            label="Kill"
            icon={Skull}
            onClick={() => perform("kill")}
            disabled={!allowed.has("kill") || loading === "kill"}
            loading={loading === "kill"}
            variant="danger"
          />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-400">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 transition-colors hover:bg-red-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal button component
// ---------------------------------------------------------------------------

type Variant = "default" | "success" | "danger";

const variantStyles: Record<
  Variant,
  { base: string; hover: string; active: string }
> = {
  default: {
    base: "border-zinc-700 bg-zinc-800 text-zinc-300",
    hover: "hover:bg-zinc-700 hover:text-zinc-100",
    active: "active:bg-zinc-600",
  },
  success: {
    base: "border-emerald-600/50 bg-emerald-600/20 text-emerald-400",
    hover: "hover:bg-emerald-600/30 hover:text-emerald-300",
    active: "active:bg-emerald-600/40",
  },
  danger: {
    base: "border-red-600/50 bg-red-600/20 text-red-400",
    hover: "hover:bg-red-600/30 hover:text-red-300",
    active: "active:bg-red-600/40",
  },
};

interface ControlButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  variant: Variant;
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading,
  variant,
}: ControlButtonProps) {
  const styles = variantStyles[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        styles.base,
        !disabled && styles.hover,
        !disabled && styles.active,
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}
