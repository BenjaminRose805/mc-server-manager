import { useState } from "react";
import { useNavigate } from "react-router";
import { Play, Trash2, Clock, Gamepad2 } from "lucide-react";
import type { LauncherInstance } from "@mc-server-manager/shared";
import { cn } from "@/lib/utils";

interface InstanceCardProps {
  instance: LauncherInstance;
  onPlay: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatPlaytime(seconds: number): string {
  if (seconds === 0) return "No playtime";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function InstanceCard({
  instance,
  onPlay,
  onDelete,
}: InstanceCardProps) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(instance.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      onClick={() => navigate(`/launcher/${instance.id}`)}
      className={cn(
        "group relative flex flex-col rounded-lg border bg-zinc-900 p-5 transition-all cursor-pointer",
        "border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80",
      )}
    >
      <button
        onClick={handleDelete}
        className={cn(
          "absolute right-3 top-3 rounded-md p-1.5 text-zinc-600 opacity-0 transition-all group-hover:opacity-100",
          confirmDelete
            ? "bg-red-500/20 text-red-400 opacity-100"
            : "hover:bg-zinc-700 hover:text-zinc-300",
        )}
        title={confirmDelete ? "Click again to confirm" : "Delete instance"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0">
        <h3 className="truncate pr-8 text-base font-semibold text-zinc-100">
          {instance.name}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
            {instance.mcVersion}
          </span>
          {instance.loader && (
            <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-400">
              {instance.loader.charAt(0).toUpperCase() +
                instance.loader.slice(1)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatRelativeTime(instance.lastPlayed)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Gamepad2 className="h-3.5 w-3.5" />
          {formatPlaytime(instance.totalPlaytime)}
        </span>
      </div>

      <div className="mt-auto pt-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(instance.id);
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Play className="h-4 w-4" />
          Play
        </button>
      </div>
    </div>
  );
}
