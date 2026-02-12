import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Package,
  Settings,
  Download,
  Loader2,
  Gamepad2,
  Trash2,
  ChevronDown,
  Play,
  Save,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type {
  LauncherInstance,
  UpdateInstanceRequest,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { ModList } from "@/components/ModList";
import { AccountManager } from "@/components/launcher/AccountManager";
import { DownloadProgress } from "@/components/launcher/DownloadProgress";
import { isTauri, tauriInvoke } from "@/utils/tauri";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "mods" | "settings";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: TabDef[] = [
  { id: "mods", label: "Mods", icon: Package },
  { id: "settings", label: "Settings", icon: Settings },
];

// ---------------------------------------------------------------------------
// Loader setup sub-component
// ---------------------------------------------------------------------------

function LoaderSetup({
  instanceId,
  mcVersion,
  onInstalled,
}: {
  instanceId: string;
  mcVersion: string;
  onInstalled: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [versions, setVersions] = useState<
    Array<{ version: string; stable: boolean }>
  >([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .getInstanceLoaderVersions(instanceId, "fabric", mcVersion)
      .then((res) => {
        setVersions(res.versions);
        const stable = res.versions.find((v) => v.stable);
        if (stable) setSelectedVersion(stable.version);
        else if (res.versions.length > 0)
          setSelectedVersion(res.versions[0].version);
      })
      .catch(() => toast.error("Failed to load Fabric versions"))
      .finally(() => setLoadingVersions(false));
  }, [instanceId, mcVersion]);

  const handleInstall = async () => {
    if (!selectedVersion) return;
    setInstalling(true);
    try {
      await api.installInstanceLoader(instanceId, {
        loader: "fabric",
        loaderVersion: selectedVersion,
      });
      toast.success("Fabric installed successfully");
      onInstalled();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to install Fabric",
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 py-16 px-6">
      <div className="rounded-full bg-zinc-800 p-3">
        <Download className="h-8 w-8 text-zinc-500" />
      </div>
      <h3 className="mt-4 text-base font-medium text-zinc-100">
        Install a Mod Loader
      </h3>
      <p className="mt-1 max-w-md text-center text-sm text-zinc-500">
        A mod loader is required to install and run mods. Currently, Fabric is
        supported.
      </p>

      <div className="mt-6 flex items-center gap-3">
        {loadingVersions ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading versions...
          </div>
        ) : (
          <>
            <div className="relative">
              <select
                value={selectedVersion ?? ""}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="appearance-none rounded-md border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-200 transition-colors hover:border-zinc-600 focus:border-emerald-500 focus:outline-none"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.stable ? " (stable)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            </div>
            <button
              onClick={handleInstall}
              disabled={installing || !selectedVersion}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Install Fabric
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function InstanceDetailSkeleton() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col animate-pulse">
      <div className="h-5 w-36 rounded bg-zinc-800" />
      <div className="mt-4 flex items-center gap-3">
        <div className="h-8 w-48 rounded bg-zinc-800" />
        <div className="h-6 w-20 rounded-full bg-zinc-800" />
      </div>
      <div className="mt-4 flex border-b border-zinc-800">
        {[1, 2].map((i) => (
          <div key={i} className="mx-2 my-2.5 h-5 w-20 rounded bg-zinc-800" />
        ))}
      </div>
      <div className="mt-4 flex-1 rounded-lg border border-zinc-800 bg-zinc-900" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings form sub-component
// ---------------------------------------------------------------------------

function SettingsForm({
  instance,
  onSaved,
}: {
  instance: LauncherInstance;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(instance.name);
  const [ramMax, setRamMax] = useState(instance.ramMax);
  const [ramMin, setRamMin] = useState(instance.ramMin);
  const [resWidth, setResWidth] = useState(
    instance.resolutionWidth?.toString() ?? "",
  );
  const [resHeight, setResHeight] = useState(
    instance.resolutionHeight?.toString() ?? "",
  );
  const [javaPath, setJavaPath] = useState(instance.javaPath ?? "");
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(" "));
  const [gameArgs, setGameArgs] = useState(instance.gameArgs.join(" "));

  useEffect(() => {
    setName(instance.name);
    setRamMax(instance.ramMax);
    setRamMin(instance.ramMin);
    setResWidth(instance.resolutionWidth?.toString() ?? "");
    setResHeight(instance.resolutionHeight?.toString() ?? "");
    setJavaPath(instance.javaPath ?? "");
    setJvmArgs(instance.jvmArgs.join(" "));
    setGameArgs(instance.gameArgs.join(" "));
  }, [instance]);

  const resetForm = () => {
    setName(instance.name);
    setRamMax(instance.ramMax);
    setRamMin(instance.ramMin);
    setResWidth(instance.resolutionWidth?.toString() ?? "");
    setResHeight(instance.resolutionHeight?.toString() ?? "");
    setJavaPath(instance.javaPath ?? "");
    setJvmArgs(instance.jvmArgs.join(" "));
    setGameArgs(instance.gameArgs.join(" "));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: UpdateInstanceRequest = {
        name: name.trim() || undefined,
        ramMin: Math.min(ramMin, ramMax),
        ramMax,
        resolutionWidth: resWidth ? parseInt(resWidth, 10) : null,
        resolutionHeight: resHeight ? parseInt(resHeight, 10) : null,
        javaPath: javaPath.trim() || null,
        jvmArgs: jvmArgs.trim() ? jvmArgs.trim().split(/\s+/) : [],
        gameArgs: gameArgs.trim() ? gameArgs.trim().split(/\s+/) : [],
      };
      await api.updateLauncherInstance(instance.id, data);
      toast.success("Settings saved");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save settings",
      );
    } finally {
      setSaving(false);
    }
  };

  const clampedRamMin = Math.min(ramMin, ramMax);

  const inputCls =
    "w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition-colors placeholder:text-zinc-600 hover:border-zinc-600 focus:border-emerald-500 focus:outline-none";
  const labelCls = "block text-sm font-medium text-zinc-300";

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="max-w-2xl space-y-8 pb-8">
        <section className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            General
          </h4>
          <div>
            <label className={labelCls}>Instance Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(inputCls, "mt-1.5")}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Memory
          </h4>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={labelCls}>Maximum RAM</label>
              <span className="text-sm font-semibold tabular-nums text-emerald-400">
                {ramMax} GB
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={32}
              step={1}
              value={ramMax}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setRamMax(v);
                if (ramMin > v) setRamMin(v);
              }}
              className="mt-2 w-full accent-emerald-500"
            />
            <div className="mt-1 flex justify-between text-[11px] text-zinc-600">
              <span>1 GB</span>
              <span>32 GB</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={labelCls}>Minimum RAM</label>
              <span className="text-sm font-semibold tabular-nums text-emerald-400">
                {clampedRamMin} GB
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={ramMax}
              step={1}
              value={clampedRamMin}
              onChange={(e) => setRamMin(parseInt(e.target.value, 10))}
              className="mt-2 w-full accent-emerald-500"
            />
            <div className="mt-1 flex justify-between text-[11px] text-zinc-600">
              <span>1 GB</span>
              <span>{ramMax} GB</span>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Display
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Resolution Width</label>
              <input
                type="number"
                value={resWidth}
                onChange={(e) => setResWidth(e.target.value)}
                placeholder="Default"
                className={cn(inputCls, "mt-1.5")}
              />
            </div>
            <div>
              <label className={labelCls}>Resolution Height</label>
              <input
                type="number"
                value={resHeight}
                onChange={(e) => setResHeight(e.target.value)}
                placeholder="Default"
                className={cn(inputCls, "mt-1.5")}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Java
          </h4>

          <div>
            <label className={labelCls}>Java Path</label>
            <input
              type="text"
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
              placeholder="Auto-detect"
              className={cn(inputCls, "mt-1.5")}
            />
          </div>

          <div>
            <label className={labelCls}>JVM Arguments</label>
            <textarea
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              rows={3}
              placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
              className={cn(inputCls, "mt-1.5 resize-none font-mono text-xs")}
            />
          </div>

          <div>
            <label className={labelCls}>Game Arguments</label>
            <textarea
              value={gameArgs}
              onChange={(e) => setGameArgs(e.target.value)}
              rows={2}
              placeholder="--width 1920 --height 1080"
              className={cn(inputCls, "mt-1.5 resize-none font-mono text-xs")}
            />
          </div>
        </section>

        <div className="flex items-center gap-3 border-t border-zinc-800 pt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </button>
          <button
            onClick={resetForm}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstanceDetail page
// ---------------------------------------------------------------------------

export default function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<LauncherInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("mods");
  const [removingLoader, setRemovingLoader] = useState(false);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    () => localStorage.getItem("launcher_selectedAccount"),
  );
  const [preparing, setPreparing] = useState(false);

  const fetchInstance = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    api
      .getLauncherInstance(id)
      .then(setInstance)
      .catch((err) => {
        if (err.status === 404) {
          setNotFound(true);
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load instance",
          );
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  const handleRemoveLoader = async () => {
    if (!id) return;
    setRemovingLoader(true);
    try {
      await api.removeInstanceLoader(id);
      toast.success("Mod loader removed");
      fetchInstance();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove loader",
      );
    } finally {
      setRemovingLoader(false);
    }
  };

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    localStorage.setItem("launcher_selectedAccount", accountId);
  };

  const handleLaunch = async () => {
    if (!id || !selectedAccountId) return;
    setPreparing(true);
    try {
      await api.prepareLaunch(id);
      if (isTauri()) {
        await tauriInvoke("launch_game", {
          instanceId: id,
          accountId: selectedAccountId,
        });
        toast.success("Game launched!");
      } else {
        toast.info("Game files prepared. Launch requires the desktop app.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to launch";
      toast.error(message);
    } finally {
      setPreparing(false);
    }
  };

  // -- Loading --
  if (loading) {
    return <InstanceDetailSkeleton />;
  }

  // -- Not Found --
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-full bg-zinc-800 p-3">
          <Gamepad2 className="h-8 w-8 text-zinc-500" />
        </div>
        <h3 className="mt-4 text-base font-medium text-zinc-300">
          Instance not found
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          This instance may have been deleted or the URL is incorrect.
        </p>
        <Link
          to="/launcher"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Launcher
        </Link>
      </div>
    );
  }

  // -- Error --
  if (error || !instance) {
    return (
      <div>
        <Link
          to="/launcher"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Launcher
        </Link>
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error || "Failed to load instance."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col lg:h-[calc(100vh-4rem)]">
      {/* -- Header -------------------------------------------------------- */}
      <div className="shrink-0">
        <Link
          to="/launcher"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Launcher
        </Link>

        {/* Title row */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="truncate text-2xl font-bold tracking-tight">
              {instance.name}
            </h2>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
              {instance.mcVersion}
            </span>
            {instance.loader && (
              <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
                {instance.loader.charAt(0).toUpperCase() +
                  instance.loader.slice(1)}
                {instance.loaderVersion && ` ${instance.loaderVersion}`}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-zinc-800">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 min-h-0 flex-1">
            {activeTab === "mods" && (
              <>
                {!instance.loader ? (
                  <LoaderSetup
                    instanceId={instance.id}
                    mcVersion={instance.mcVersion}
                    onInstalled={() => fetchInstance()}
                  />
                ) : (
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-400">
                          Mod Loader:
                        </span>
                        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          {instance.loader} {instance.loaderVersion}
                        </span>
                      </div>
                      <button
                        onClick={handleRemoveLoader}
                        disabled={removingLoader}
                        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-red-400 disabled:opacity-50"
                      >
                        {removingLoader ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Remove Loader
                      </button>
                    </div>

                    <ModList
                      targetType="instance"
                      targetId={instance.id}
                      className="min-h-0 flex-1"
                    />
                  </div>
                )}
              </>
            )}

            {activeTab === "settings" && (
              <SettingsForm instance={instance} onSaved={fetchInstance} />
            )}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-4 lg:sticky lg:top-0 lg:w-80">
          <AccountManager
            selectedAccountId={selectedAccountId}
            onSelectAccount={handleSelectAccount}
          />
          <button
            onClick={handleLaunch}
            disabled={!selectedAccountId || preparing}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition-all",
              selectedAccountId && !preparing
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 hover:shadow-emerald-500/30 active:bg-emerald-700"
                : "cursor-not-allowed bg-zinc-800 text-zinc-500",
            )}
          >
            {preparing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            {preparing ? "Preparing..." : "Play"}
          </button>
        </div>
      </div>

      <DownloadProgress
        visible={preparing}
        progress={{ phase: "version", current: 0, total: 0 }}
      />
    </div>
  );
}
