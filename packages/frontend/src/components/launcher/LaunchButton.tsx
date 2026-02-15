import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isDesktop } from "@/utils/desktop";
import { api } from "@/api/client";
import { logger } from "@/utils/logger";

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

    if (!isDesktop()) {
      toast.error("Launch requires the desktop app");
      return;
    }

    setState("launching");

    try {
      const job = await api.prepareLaunch(instanceId);

      const poll = async (): Promise<void> => {
        const j = await api.getPrepareStatus(job.id);
        if (j.phase === "completed" && j.result) {
          await window.electronAPI!.launchGame(
            instanceId,
            accountId!,
            j.result,
          );
          setState("running");
          toast.success("Game launched");
        } else if (j.phase === "failed") {
          setState("ready");
          toast.error(j.error || "Prepare failed");
        } else {
          await new Promise((r) => setTimeout(r, 500));
          return poll();
        }
      };
      await poll();
    } catch (err) {
      setState("ready");
      const message =
        err instanceof Error ? err.message : "Failed to launch game";
      logger.warn("LaunchButton failed", { error: message });
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
