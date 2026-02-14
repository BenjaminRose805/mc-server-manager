import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Terminal,
  Settings,
  FileText,
  Package,
  ServerOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ServerWithStatus } from "@mc-server-manager/shared";
import { isModCapable } from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { useServerStore } from "@/stores/serverStore";
import { StatusBadge } from "@/components/StatusBadge";
import { ServerControls } from "@/components/ServerControls";
import { ServerStats } from "@/components/ServerStats";
import { Console } from "@/components/Console";
import { PropertiesForm } from "@/components/PropertiesForm";
import { LogViewer } from "@/components/LogViewer";
import { ModList } from "@/components/ModList";
import { DeleteServerDialog } from "@/components/DeleteServerDialog";
import { cn } from "@/lib/utils";
import { logger } from "@/utils/logger";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "console" | "settings" | "logs" | "mods";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
}

function getTabs(server: ServerWithStatus | null): TabDef[] {
  return [
    { id: "console", label: "Console", icon: Terminal, available: true },
    { id: "settings", label: "Settings", icon: Settings, available: true },
    {
      id: "mods",
      label: "Mods",
      icon: Package,
      available: server ? isModCapable(server.type) : false,
    },
    { id: "logs", label: "Logs", icon: FileText, available: true },
  ];
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ServerDetailSkeleton() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col animate-pulse">
      {/* Back link */}
      <div className="h-5 w-32 rounded bg-zinc-800" />

      {/* Title row */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-48 rounded bg-zinc-800" />
          <div className="h-6 w-20 rounded-full bg-zinc-800" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-20 rounded-md bg-zinc-800" />
          <div className="h-8 w-20 rounded-md bg-zinc-800" />
          <div className="h-8 w-24 rounded-md bg-zinc-800" />
        </div>
      </div>

      {/* Subtitle */}
      <div className="mt-2 h-4 w-28 rounded bg-zinc-800" />

      {/* Stats bar */}
      <div className="mt-3 flex gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-14 w-32 rounded-lg border border-zinc-800 bg-zinc-900"
          />
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex border-b border-zinc-800">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mx-2 h-5 w-20 rounded bg-zinc-800 my-2.5" />
        ))}
      </div>

      {/* Console area */}
      <div className="mt-4 flex-1 rounded-lg border border-zinc-800 bg-zinc-900" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ServerDetail page
// ---------------------------------------------------------------------------

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<ServerWithStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("console");
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Keep the server object up-to-date from the store (which receives WS updates)
  const storeServer = useServerStore((s) =>
    s.servers.find((srv) => srv.id === id),
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    api
      .getServer(id)
      .then(setServer)
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error("Failed to load server", {
          error: errorMsg,
          serverId: id,
        });
        if (err.status === 404) {
          setNotFound(true);
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Detect server deletion via store update (removed from list while viewing)
  useEffect(() => {
    if (!loading && !notFound && server && !storeServer) {
      // Server was in the store but got removed — it was deleted
      // However, the store might not have fetched yet. Only show this
      // after the store has loaded servers at least once.
      const storeServers = useServerStore.getState().servers;
      if (
        storeServers.length > 0 ||
        useServerStore.getState().loading === false
      ) {
        // Double-check: try to re-fetch
        if (id) {
          api.getServer(id).catch((err) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.warn("Server re-fetch failed", {
              error: errorMsg,
              serverId: id,
            });
            if (err.status === 404) {
              toast.error("This server has been deleted");
              navigate("/", { replace: true });
            }
          });
        }
      }
    }
  }, [storeServer, loading, notFound, server, id, navigate]);

  // Merge store updates into the local server state
  const displayServer = storeServer ?? server;

  const removeServer = useServerStore((s) => s.removeServer);

  const handleDelete = useCallback(
    async (deleteFiles: boolean) => {
      if (!id) return;
      const name = displayServer?.name ?? "Server";
      await api.deleteServer(id, deleteFiles);
      removeServer(id);
      toast.success(`Server "${name}" deleted`);
      navigate("/", { replace: true });
    },
    [id, displayServer?.name, removeServer, navigate],
  );

  // -- Loading --
  if (loading) {
    return <ServerDetailSkeleton />;
  }

  // -- Not Found --
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-full bg-zinc-800 p-3">
          <ServerOff className="h-8 w-8 text-zinc-500" />
        </div>
        <h3 className="mt-4 text-base font-medium text-zinc-300">
          Server not found
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          This server may have been deleted or the URL is incorrect.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // -- Error --
  if (error || !displayServer) {
    return (
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error || "Failed to load server."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col lg:h-[calc(100vh-4rem)]">
      {/* -- Header -------------------------------------------------------- */}
      <div className="shrink-0">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        {/* Title row: name + badge + controls */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="truncate text-2xl font-bold tracking-tight">
              {displayServer.name}
            </h2>
            <StatusBadge status={displayServer.status} />
          </div>
          <div className="flex items-center gap-2">
            <ServerControls
              serverId={displayServer.id}
              status={displayServer.status}
            />
            <button
              onClick={() => setDeleteOpen(true)}
              disabled={
                displayServer.status !== "stopped" &&
                displayServer.status !== "crashed"
              }
              title={
                displayServer.status !== "stopped" &&
                displayServer.status !== "crashed"
                  ? "Stop the server before deleting"
                  : "Delete server"
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                "border-red-600/50 bg-red-600/20 text-red-400",
                displayServer.status === "stopped" ||
                  displayServer.status === "crashed"
                  ? "hover:bg-red-600/30 hover:text-red-300"
                  : "opacity-40 cursor-not-allowed",
              )}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>

        {/* Subtitle */}
        <p className="mt-1 text-sm text-zinc-400">
          {displayServer.type.charAt(0).toUpperCase() +
            displayServer.type.slice(1)}{" "}
          {displayServer.mcVersion}
        </p>

        {/* Stats bar */}
        <ServerStats server={displayServer} className="mt-3" />
      </div>

      {/* -- Tabs ---------------------------------------------------------- */}
      <div className="mt-4 flex shrink-0 border-b border-zinc-800">
        {getTabs(displayServer).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => tab.available && setActiveTab(tab.id)}
              disabled={!tab.available}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "text-zinc-100"
                  : tab.available
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-600 cursor-not-allowed",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {!tab.available && (
                <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                  Soon
                </span>
              )}
              {/* Active indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-t" />
              )}
            </button>
          );
        })}
      </div>

      {/* -- Tab content --------------------------------------------------- */}
      <div className="mt-4 flex-1 min-h-0">
        {activeTab === "console" && (
          <Console serverId={displayServer.id} className="h-full" />
        )}

        {activeTab === "settings" && (
          <PropertiesForm server={displayServer} className="h-full" />
        )}

        {activeTab === "mods" && (
          <ModList server={displayServer} className="h-full" />
        )}

        {activeTab === "logs" && (
          <LogViewer serverId={displayServer.id} className="h-full" />
        )}
      </div>

      <DeleteServerDialog
        serverName={displayServer.name}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
