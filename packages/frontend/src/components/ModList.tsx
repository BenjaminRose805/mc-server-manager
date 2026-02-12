import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  InstalledMod,
  InstalledModpack,
  ModpackUpdateInfo,
  ModSide,
  ServerWithStatus,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/serverStore";

function SideBadge({ side }: { side: ModSide }) {
  if (side === "both" || side === "unknown") return null;

  const colors =
    side === "client"
      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
      : "bg-purple-500/10 text-purple-400 border-purple-500/20";

  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium",
        colors,
      )}
    >
      {side === "client" ? "Client" : "Server"}
    </span>
  );
}

interface ModListProps {
  server?: ServerWithStatus;
  targetType?: "server" | "instance";
  targetId?: string;
  className?: string;
}

export function ModList({
  server,
  targetType,
  targetId,
  className,
}: ModListProps) {
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [modpacks, setModpacks] = useState<InstalledModpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [uninstallingIds, setUninstallingIds] = useState<Set<string>>(
    new Set(),
  );
  const [localUpdates, setLocalUpdates] = useState<
    Record<string, ModpackUpdateInfo>
  >({});
  const [checkingUpdateIds, setCheckingUpdateIds] = useState<Set<string>>(
    new Set(),
  );
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const storeUpdates = useServerStore((s) => s.modpackUpdates);

  const effectiveTargetType = targetType ?? "server";
  const effectiveTargetId = targetId ?? server?.id;

  const isRunning = server
    ? server.status === "running" ||
      server.status === "starting" ||
      server.status === "stopping"
    : false;

  const fetchMods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!effectiveTargetId) return;

      if (effectiveTargetType === "instance") {
        const modsRes = await api.getInstanceMods(effectiveTargetId);
        setMods(modsRes.mods);
        setModpacks([]);
      } else {
        const [modsRes, modpacksRes] = await Promise.all([
          api.getInstalledMods(effectiveTargetId),
          api.getInstalledModpacks(effectiveTargetId),
        ]);
        setMods(modsRes.mods);
        setModpacks(modpacksRes.modpacks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mods");
    } finally {
      setLoading(false);
    }
  }, [effectiveTargetType, effectiveTargetId]);

  useEffect(() => {
    fetchMods();
  }, [fetchMods]);

  const handleToggle = async (mod: InstalledMod) => {
    setTogglingIds((prev) => new Set(prev).add(mod.id));
    try {
      if (!effectiveTargetId) return;
      const updated =
        effectiveTargetType === "instance"
          ? await api.toggleInstanceMod(effectiveTargetId, mod.id)
          : await api.toggleMod(effectiveTargetId, mod.id);
      setMods((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      toast.success(`${mod.name} ${updated.enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle mod");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
    }
  };

  const handleUninstall = async (mod: InstalledMod) => {
    setUninstallingIds((prev) => new Set(prev).add(mod.id));
    try {
      if (!effectiveTargetId) return;
      if (effectiveTargetType === "instance") {
        await api.uninstallInstanceMod(effectiveTargetId, mod.id);
      } else {
        await api.uninstallMod(effectiveTargetId, mod.id);
      }
      setMods((prev) => prev.filter((m) => m.id !== mod.id));
      toast.success(`${mod.name} uninstalled`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to uninstall mod",
      );
    } finally {
      setConfirmUninstall(null);
      setUninstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
    }
  };

  const handleCheckUpdate = async (pack: InstalledModpack) => {
    if (!effectiveTargetId || effectiveTargetType !== "server") return;
    setCheckingUpdateIds((prev) => new Set(prev).add(pack.id));
    try {
      const info = await api.checkModpackUpdate(effectiveTargetId, pack.id);
      setLocalUpdates((prev) => ({ ...prev, [pack.id]: info }));
      if (info.updateAvailable) {
        toast.success(`Update available: v${info.latestVersionNumber}`);
      } else {
        toast.info("Already on the latest version");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to check for updates",
      );
    } finally {
      setCheckingUpdateIds((prev) => {
        const next = new Set(prev);
        next.delete(pack.id);
        return next;
      });
    }
  };

  const handleUpdate = async (pack: InstalledModpack) => {
    if (!effectiveTargetId || effectiveTargetType !== "server") return;
    setUpdatingIds((prev) => new Set(prev).add(pack.id));
    try {
      await api.updateModpack(effectiveTargetId, pack.id);
      toast.success(`${pack.name} updated`);
      setLocalUpdates((prev) => {
        const next = { ...prev };
        delete next[pack.id];
        return next;
      });
      await fetchMods();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update modpack",
      );
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(pack.id);
        return next;
      });
    }
  };

  const handleExport = async (pack: InstalledModpack) => {
    if (!effectiveTargetId || effectiveTargetType !== "server") return;
    setExportingIds((prev) => new Set(prev).add(pack.id));
    try {
      const data = await api.exportModpack(effectiveTargetId, pack.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.name}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Modpack exported");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export modpack",
      );
    } finally {
      setExportingIds((prev) => {
        const next = new Set(prev);
        next.delete(pack.id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-20", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        <span className="ml-2 text-sm text-zinc-500">Loading mods...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("px-1", className)}>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex-1 overflow-y-auto min-h-0 pb-4">
        {isRunning && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Server is running</p>
              <p className="mt-0.5 text-xs text-amber-400/80">
                Mod changes will take effect after restart.
              </p>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-100">
            Installed Mods
            {mods.length > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({mods.length})
              </span>
            )}
          </h3>
        </div>

        {mods.length === 0 && modpacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
            <div className="rounded-full bg-zinc-800 p-3">
              <Package className="h-8 w-8 text-zinc-500" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-300">
              No mods installed
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Browse mods from the Mods page.
            </p>
            <Link
              to="/mods"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Package className="h-4 w-4" />
              Browse Mods
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {modpacks.map((pack) => {
              const packMods = mods.filter((m) => m.modpackId === pack.id);
              const updateInfo = localUpdates[pack.id] ?? storeUpdates[pack.id];
              const hasUpdate = updateInfo?.updateAvailable === true;
              const isCheckingUpdate = checkingUpdateIds.has(pack.id);
              const isUpdating = updatingIds.has(pack.id);
              const isExporting = exportingIds.has(pack.id);
              return (
                <div
                  key={pack.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden"
                >
                  <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
                    {pack.iconUrl ? (
                      <img
                        src={pack.iconUrl}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800">
                        <Package className="h-4 w-4 text-zinc-500" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-100">
                          {pack.name}
                        </p>
                        {hasUpdate && (
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            Update available: v{updateInfo.latestVersionNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {pack.loaderType.charAt(0).toUpperCase() +
                          pack.loaderType.slice(1)}{" "}
                        &middot; MC {pack.mcVersion} &middot; {packMods.length}{" "}
                        mods
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {hasUpdate && (
                        <button
                          onClick={() => handleUpdate(pack)}
                          disabled={isUpdating}
                          className="rounded p-1.5 text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-wait"
                          title="Update modpack"
                        >
                          {isUpdating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowUpCircle className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleCheckUpdate(pack)}
                        disabled={isCheckingUpdate}
                        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50 disabled:cursor-wait"
                        title="Check for update"
                      >
                        {isCheckingUpdate ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleExport(pack)}
                        disabled={isExporting}
                        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50 disabled:cursor-wait"
                        title="Export modpack"
                      >
                        {isExporting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
                        Modpack
                      </span>
                    </div>
                  </div>
                  <ModTable
                    mods={packMods}
                    togglingIds={togglingIds}
                    uninstallingIds={uninstallingIds}
                    confirmUninstall={confirmUninstall}
                    onToggle={handleToggle}
                    onConfirmUninstall={setConfirmUninstall}
                    onUninstall={handleUninstall}
                  />
                </div>
              );
            })}

            {(() => {
              const standaloneMods = mods.filter((m) => !m.modpackId);
              if (standaloneMods.length === 0) return null;
              return (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  {modpacks.length > 0 && (
                    <div className="border-b border-zinc-800 px-4 py-3">
                      <p className="text-sm font-semibold text-zinc-100">
                        Standalone Mods
                      </p>
                    </div>
                  )}
                  <ModTable
                    mods={standaloneMods}
                    togglingIds={togglingIds}
                    uninstallingIds={uninstallingIds}
                    confirmUninstall={confirmUninstall}
                    onToggle={handleToggle}
                    onConfirmUninstall={setConfirmUninstall}
                    onUninstall={handleUninstall}
                  />
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function ModTable({
  mods,
  togglingIds,
  uninstallingIds,
  confirmUninstall,
  onToggle,
  onConfirmUninstall,
  onUninstall,
}: {
  mods: InstalledMod[];
  togglingIds: Set<string>;
  uninstallingIds: Set<string>;
  confirmUninstall: string | null;
  onToggle: (mod: InstalledMod) => void;
  onConfirmUninstall: (id: string | null) => void;
  onUninstall: (mod: InstalledMod) => void;
}) {
  if (mods.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-zinc-500">
        No mods in this group
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:grid sm:grid-cols-[40px_1fr_100px_100px_80px_80px] gap-3 border-b border-zinc-800 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        <span />
        <span>Name</span>
        <span>Version</span>
        <span>MC Version</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {mods.map((mod) => {
          const isToggling = togglingIds.has(mod.id);
          const isUninstalling = uninstallingIds.has(mod.id);
          const showConfirm = confirmUninstall === mod.id;

          return (
            <div
              key={mod.id}
              className={cn(
                "group px-4 py-3 transition-colors hover:bg-zinc-800/30",
                !mod.enabled && "opacity-60",
              )}
            >
              <div className="sm:grid sm:grid-cols-[40px_1fr_100px_100px_80px_80px] sm:items-center sm:gap-3">
                {mod.iconUrl ? (
                  <img
                    src={mod.iconUrl}
                    alt=""
                    className="hidden sm:block h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded bg-zinc-800">
                    <Package className="h-4 w-4 text-zinc-500" />
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-zinc-200">
                      {mod.name}
                    </p>
                    <SideBadge side={mod.side} />
                  </div>
                  {mod.authors && (
                    <p className="truncate text-[11px] text-zinc-500">
                      {mod.authors}
                    </p>
                  )}
                </div>

                <span className="hidden sm:block truncate text-xs text-zinc-400 font-mono">
                  {mod.versionId.length > 12
                    ? mod.versionId.slice(0, 12) + "..."
                    : mod.versionId}
                </span>

                <span className="hidden sm:block text-xs text-zinc-400">
                  {mod.mcVersion}
                </span>

                <div className="mt-2 sm:mt-0">
                  <button
                    onClick={() => onToggle(mod)}
                    disabled={isToggling}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      mod.enabled ? "bg-emerald-600" : "bg-zinc-700",
                      isToggling && "opacity-50 cursor-wait",
                    )}
                    title={mod.enabled ? "Disable mod" : "Enable mod"}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        mod.enabled ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>

                <div className="mt-2 sm:mt-0 flex justify-end">
                  {showConfirm ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onUninstall(mod)}
                        disabled={isUninstalling}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        {isUninstalling ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Yes"
                        )}
                      </button>
                      <button
                        onClick={() => onConfirmUninstall(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onConfirmUninstall(mod.id)}
                      className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
                      title="Uninstall mod"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
