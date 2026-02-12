import type { ModSide } from "@mc-server-manager/shared";
import { cn } from "@/lib/utils";

export function SourceBadge({ source }: { source: string }) {
  const label =
    source === "modrinth"
      ? "Modrinth"
      : source === "curseforge"
        ? "CurseForge"
        : "Local";
  const colors =
    source === "modrinth"
      ? "bg-green-500/10 text-green-400 border-green-500/20"
      : source === "curseforge"
        ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
        : "bg-zinc-700/50 text-zinc-400 border-zinc-600";

  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        colors,
      )}
    >
      {label}
    </span>
  );
}

export function ReleaseTypeBadge({
  type,
}: {
  type: "release" | "beta" | "alpha";
}) {
  const map = {
    release: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    beta: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    alpha: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        map[type],
      )}
    >
      {type}
    </span>
  );
}

export function SideBadge({ side }: { side: ModSide }) {
  const map: Record<ModSide, { label: string; classes: string }> = {
    server: {
      label: "Server",
      classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
    client: {
      label: "Client",
      classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    },
    both: {
      label: "Both",
      classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    unknown: {
      label: "Unknown",
      classes: "bg-zinc-700/50 text-zinc-400 border-zinc-600",
    },
  };
  const entry = map[side];
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        entry.classes,
      )}
    >
      {entry.label}
    </span>
  );
}
