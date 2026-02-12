import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isTauri, tauriInvoke } from "@/utils/tauri";

interface LaunchButtonProps {
  instanceId: string;
  accountId: string | null;
  disabled?: boolean;
}

type LaunchState = "ready" | "launching" | "running";

export function LaunchButton({
  instanceId,
  accountId,
  disabled = false,
}: LaunchButtonProps) {
  const [state, setState] = useState<LaunchState>("ready");

  const noAccount = !accountId;
  const isDisabled = disabled || noAccount || state !== "ready";

  const handleLaunch = async () => {
    if (isDisabled) return;

    if (!isTauri()) {
      toast.error("Launch requires the desktop app");
      return;
    }

    setState("launching");

    try {
      await tauriInvoke("launch_game", { instanceId, accountId });
      setState("running");
      toast.success("Game launched");
    } catch (err) {
      setState("ready");
      const message =
        err instanceof Error ? err.message : "Failed to launch game";
      toast.error(message);
    }
  };

  const label =
    state === "launching"
      ? "Launching..."
      : state === "running"
        ? "Running"
        : "Play";

  const variant =
    state === "running" ? "running" : noAccount ? "disabled" : "ready";

  return (
    <div className="relative">
      <button
        onClick={handleLaunch}
        disabled={isDisabled}
        title={noAccount ? "Select an account first" : undefined}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition-all",
          variant === "ready" && [
            "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20",
            "hover:bg-emerald-500 hover:shadow-emerald-500/30",
            "active:bg-emerald-700 active:shadow-none",
          ],
          variant === "running" && [
            "bg-sky-600 text-white shadow-lg shadow-sky-600/20",
            "cursor-default",
          ],
          variant === "disabled" && [
            "bg-zinc-800 text-zinc-500",
            "cursor-not-allowed",
          ],
          isDisabled && variant === "ready" && "opacity-40 cursor-not-allowed",
        )}
      >
        {state === "launching" ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Play className="h-5 w-5" />
        )}
        {label}
      </button>
    </div>
  );
}
