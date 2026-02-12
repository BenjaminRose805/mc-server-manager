import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface DownloadProgressProps {
  visible: boolean;
  progress: {
    phase: "version" | "libraries" | "assets";
    current: number;
    total: number;
    currentFile?: string;
  };
  onCancel?: () => void;
}

const PHASE_LABELS: Record<DownloadProgressProps["progress"]["phase"], string> =
  {
    version: "Downloading version",
    libraries: "Downloading libraries",
    assets: "Downloading assets",
  };

function formatPhaseLabel(
  phase: DownloadProgressProps["progress"]["phase"],
  current: number,
  total: number,
): string {
  const base = PHASE_LABELS[phase];
  if (phase === "version") return `${base}...`;
  return `${base} (${current}/${total})...`;
}

export function DownloadProgress({
  visible,
  progress,
  onCancel,
}: DownloadProgressProps) {
  if (!visible) return null;

  const indeterminate = progress.total === 0;
  const percentage = indeterminate
    ? 0
    : Math.round((progress.current / progress.total) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={cn(
          "relative mx-4 w-full max-w-md overflow-hidden rounded-xl",
          "border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50",
        )}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
              <Download className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">
                Preparing Instance
              </p>
              <p className="text-xs text-zinc-500">
                {indeterminate
                  ? "Preparing..."
                  : formatPhaseLabel(
                      progress.phase,
                      progress.current,
                      progress.total,
                    )}
              </p>
            </div>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-5">
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-2xl font-bold tabular-nums text-zinc-100">
              {indeterminate ? "Preparing..." : `${percentage}%`}
            </span>
            {!indeterminate && (
              <span className="text-xs tabular-nums text-zinc-500">
                {progress.current} / {progress.total}
              </span>
            )}
          </div>

          <div className="h-2.5 overflow-hidden rounded-full bg-zinc-700/60">
            {indeterminate ? (
              <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-emerald-500/80" />
            ) : (
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            )}
          </div>

          {progress.currentFile && (
            <p
              className="mt-3 truncate text-xs text-zinc-500"
              title={progress.currentFile}
            >
              {progress.currentFile}
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
