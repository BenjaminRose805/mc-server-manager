import { useEffect, useState, useRef, useCallback } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FileBox,
  Loader2,
  Package,
  Search,
  Server,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ModSearchResult,
  ModVersion,
  ModLoader,
  ModSide,
  ModSource,
  ModSortOption,
  ModEnvironment,
  ModCategory,
  ModpackSearchResult,
  ModpackVersion,
  ParsedModpack,
  ServerWithStatus,
} from "@mc-server-manager/shared";
import { isModCapable } from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/serverStore";
import {
  SourceBadge,
  ReleaseTypeBadge,
  SideBadge,
} from "@/components/mod-badges";
import { ModFilterBar } from "@/components/ModFilterBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLoaderFromServerType(type: string): ModLoader {
  if (type === "fabric") return "fabric";
  if (type === "neoforge") return "neoforge";
  return "forge";
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

type SearchMode = "mods" | "modpacks";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server Picker
// ---------------------------------------------------------------------------

function ServerPicker({
  servers,
  selected,
  onSelect,
}: {
  servers: ServerWithStatus[];
  selected: ServerWithStatus | null;
  onSelect: (server: ServerWithStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          selected
            ? "border-emerald-500/30 bg-emerald-500/5 text-zinc-100 hover:bg-emerald-500/10"
            : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
        )}
      >
        <Server className="h-4 w-4 shrink-0" />
        <span className="truncate max-w-[240px]">
          {selected ? selected.name : "Select a server"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="p-1.5">
            {servers.map((s) => {
              const isActive = selected?.id === s.id;
              const loader = getLoaderFromServerType(s.type);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "bg-emerald-500/10 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {loader.charAt(0).toUpperCase() + loader.slice(1)}{" "}
                      &middot; {s.mcVersion}
                    </p>
                  </div>
                  {isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Version Picker (accordion-style, inside a search result)
// ---------------------------------------------------------------------------

function InlineVersionPicker({
  mod,
  serverId,
  serverMcVersion,
  loader,
}: {
  mod: ModSearchResult;
  serverId: string;
  serverMcVersion: string;
  loader: ModLoader;
}) {
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingVersionId, setInstallingVersionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getModVersions(mod.source, mod.sourceId, loader, serverMcVersion)
      .then((res) => {
        if (!cancelled) setVersions(res.versions);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error(
            err instanceof Error ? err.message : "Failed to load versions",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mod.source, mod.sourceId, loader, serverMcVersion]);

  const handleInstall = async (version: ModVersion) => {
    setInstallingVersionId(version.versionId);
    try {
      await api.installMod(serverId, {
        source: version.source,
        sourceId: version.sourceId,
        versionId: version.versionId,
      });
      toast.success(`Installed ${mod.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to install mod");
    } finally {
      setInstallingVersionId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading versions...
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="px-5 py-4 text-sm text-zinc-500">
        No compatible versions found
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800/50 bg-zinc-950/40">
      <div className="px-5 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Available versions
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {versions.map((version) => {
          const isInstalling = installingVersionId === version.versionId;
          const mcMismatch = !version.mcVersions.includes(serverMcVersion);
          const loaderMismatch = !version.loaders.includes(loader);

          return (
            <div
              key={version.versionId}
              className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-zinc-800/20"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-200">
                    {version.versionNumber}
                  </span>
                  <ReleaseTypeBadge type={version.releaseType} />
                  {version.fileName && (
                    <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[200px]">
                      {version.fileName}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
                  {version.fileSize > 0 && (
                    <span>{formatFileSize(version.fileSize)}</span>
                  )}
                  <span>
                    MC: {version.mcVersions.slice(0, 3).join(", ")}
                    {version.mcVersions.length > 3 &&
                      ` +${version.mcVersions.length - 3}`}
                  </span>
                </div>

                {(mcMismatch || loaderMismatch) && (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {mcMismatch && (
                      <span className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                        MC version mismatch
                      </span>
                    )}
                    {loaderMismatch && (
                      <span className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                        Loader mismatch
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleInstall(version)}
                disabled={isInstalling || installingVersionId !== null}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isInstalling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isInstalling ? "Installing..." : "Install"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Result Card
// ---------------------------------------------------------------------------

function SearchResultCard({
  mod,
  serverId,
  serverMcVersion,
  loader,
}: {
  mod: ModSearchResult;
  serverId: string;
  serverMcVersion: string;
  loader: ModLoader;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-colors hover:border-zinc-700/80">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        {mod.iconUrl ? (
          <img
            src={mod.iconUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
            <Package className="h-6 w-6 text-zinc-500" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {mod.name}
            </span>
            <SourceBadge source={mod.source} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">by {mod.author}</p>
          <p className="mt-1.5 line-clamp-2 text-sm text-zinc-400 leading-relaxed">
            {mod.description}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatDownloads(mod.downloads)}
            </span>
          </div>
        </div>

        <ChevronRight
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <InlineVersionPicker
          mod={mod}
          serverId={serverId}
          serverMcVersion={serverMcVersion}
          loader={loader}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side Badge (for modpack entries)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Modpack Version Picker (accordion-style, inside a modpack search result)
// ---------------------------------------------------------------------------

function ModpackVersionPicker({
  modpack,
  onReview,
}: {
  modpack: ModpackSearchResult;
  onReview: (data: {
    source: ModSource;
    sourceId: string;
    versionId: string;
    parsed: ParsedModpack;
  }) => void;
}) {
  const [versions, setVersions] = useState<ModpackVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsingVersionId, setParsingVersionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getModpackVersions(modpack.source, modpack.sourceId)
      .then((res) => {
        if (!cancelled) setVersions(res.versions);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error(
            err instanceof Error ? err.message : "Failed to load versions",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modpack.source, modpack.sourceId]);

  const handleInstall = async (version: ModpackVersion) => {
    setParsingVersionId(version.versionId);
    try {
      const parsed = await api.parseModpack(
        modpack.source,
        modpack.sourceId,
        version.versionId,
      );
      onReview({
        source: modpack.source,
        sourceId: modpack.sourceId,
        versionId: version.versionId,
        parsed,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse modpack",
      );
    } finally {
      setParsingVersionId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading versions...
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="px-5 py-4 text-sm text-zinc-500">No versions found</div>
    );
  }

  return (
    <div className="border-t border-zinc-800/50 bg-zinc-950/40">
      <div className="px-5 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Available versions
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {versions.map((version) => {
          const isParsing = parsingVersionId === version.versionId;

          return (
            <div
              key={version.versionId}
              className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-zinc-800/20"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-200">
                    {version.versionNumber}
                  </span>
                  <ReleaseTypeBadge type={version.releaseType} />
                </div>

                <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
                  {version.fileSize > 0 && (
                    <span>{formatFileSize(version.fileSize)}</span>
                  )}
                  <span>
                    MC: {version.mcVersions.slice(0, 3).join(", ")}
                    {version.mcVersions.length > 3 &&
                      ` +${version.mcVersions.length - 3}`}
                  </span>
                  {version.loaders.length > 0 && (
                    <span>
                      {version.loaders
                        .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleInstall(version)}
                disabled={isParsing || parsingVersionId !== null}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isParsing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isParsing ? "Parsing..." : "Install"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modpack Search Result Card
// ---------------------------------------------------------------------------

function ModpackSearchResultCard({
  modpack,
  onReview,
}: {
  modpack: ModpackSearchResult;
  onReview: (data: {
    source: ModSource;
    sourceId: string;
    versionId: string;
    parsed: ParsedModpack;
  }) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-colors hover:border-zinc-700/80">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        {modpack.iconUrl ? (
          <img
            src={modpack.iconUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
            <FileBox className="h-6 w-6 text-zinc-500" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {modpack.name}
            </span>
            <SourceBadge source={modpack.source} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">by {modpack.author}</p>
          <p className="mt-1.5 line-clamp-2 text-sm text-zinc-400 leading-relaxed">
            {modpack.description}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatDownloads(modpack.downloads)}
            </span>
          </div>
        </div>

        <ChevronRight
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <ModpackVersionPicker modpack={modpack} onReview={onReview} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modpack Review Modal
// ---------------------------------------------------------------------------

function ModpackReviewModal({
  data,
  servers,
  onClose,
}: {
  data: {
    source: ModSource;
    sourceId: string;
    versionId: string;
    parsed: ParsedModpack;
  };
  servers: ServerWithStatus[];
  onClose: () => void;
}) {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(
    servers.length > 0 ? servers[0].id : null,
  );
  const [installing, setInstalling] = useState(false);
  const [overridesExpanded, setOverridesExpanded] = useState(false);
  const selectedServer = servers.find((s) => s.id === selectedServerId) ?? null;

  const { parsed } = data;

  const clientOnlyEntries = parsed.entries.filter((e) => e.side === "client");

  const handleInstall = async () => {
    if (!selectedServerId) {
      toast.error("Select a server first");
      return;
    }
    setInstalling(true);
    try {
      await api.installModpack(selectedServerId, {
        source: data.source,
        sourceId: data.sourceId,
        versionId: data.versionId,
        selectedEntries: [],
        applyOverrides: true,
      });
      toast.success(`Installed modpack "${parsed.name}"`);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to install modpack",
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-900 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">{parsed.name}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Version {data.versionId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Info chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
              MC {parsed.mcVersion}
            </span>
            <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
              {parsed.loader.charAt(0).toUpperCase() + parsed.loader.slice(1)}{" "}
              {parsed.loaderVersion}
            </span>
            <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
              {parsed.entries.length} mods
            </span>
            {parsed.overrideFileCount > 0 && (
              <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
                {parsed.overrideFileCount} override files
              </span>
            )}
          </div>

          {/* Server picker */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Install to server
            </label>
            <ServerPicker
              servers={servers}
              selected={selectedServer}
              onSelect={(s) => setSelectedServerId(s.id)}
            />
          </div>

          {/* Client-only warning */}
          {clientOnlyEntries.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-amber-300">
                  {clientOnlyEntries.length} client-only mod
                  {clientOnlyEntries.length !== 1 && "s"} detected
                </p>
                <p className="mt-0.5 text-xs text-amber-400/70">
                  These mods are meant for client use and may not function on a
                  server.
                </p>
              </div>
            </div>
          )}

          {/* Mod list */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Mod list ({parsed.entries.length})
            </p>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50">
              {parsed.entries.map((entry, idx) => {
                const fileName = entry.path.split("/").pop() ?? entry.path;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-2.5 text-sm",
                      idx !== 0 && "border-t border-zinc-800/50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-zinc-300">
                        {entry.name || fileName}
                      </span>
                      {entry.fileSize > 0 && (
                        <span className="text-[10px] text-zinc-600">
                          {formatFileSize(entry.fileSize)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SideBadge side={entry.side} />
                      {entry.side === "client" && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {parsed.overrideFiles && parsed.overrideFiles.length > 0 && (
            <div>
              <button
                onClick={() => setOverridesExpanded(!overridesExpanded)}
                className="flex w-full items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {overridesExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Override Files ({parsed.overrideFiles.length})
              </button>
              {overridesExpanded && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50">
                  {parsed.overrideFiles.map((filePath, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "px-4 py-2 text-xs font-mono text-zinc-400",
                        idx !== 0 && "border-t border-zinc-800/50",
                      )}
                    >
                      {filePath}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-zinc-800 bg-zinc-900 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={installing || !selectedServerId}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {installing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Install Modpack
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mods Page
// ---------------------------------------------------------------------------

export function Mods() {
  const { servers, fetchServers } = useServerStore();

  const modCapableServers = servers.filter((s) => isModCapable(s.type));
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const selectedServer =
    modCapableServers.find((s) => s.id === selectedServerId) ?? null;

  const [searchMode, setSearchMode] = useState<SearchMode>("mods");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [modpackResults, setModpackResults] = useState<ModpackSearchResult[]>(
    [],
  );
  const [totalHits, setTotalHits] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [sort, setSort] = useState<ModSortOption>("downloads");
  const [allCategories, setAllCategories] = useState<ModCategory[]>([]);
  const [modpackCategories, setModpackCategories] = useState<ModCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<ModEnvironment | null>(null);
  const [curseforgeConfigured, setCurseforgeConfigured] = useState(false);
  const [activeSources, setActiveSources] = useState<ModSource[]>(["modrinth"]);

  const [reviewModal, setReviewModal] = useState<{
    source: ModSource;
    sourceId: string;
    versionId: string;
    parsed: ParsedModpack;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const LIMIT = 20;

  // Auto-select first mod-capable server if none selected
  useEffect(() => {
    if (!selectedServerId && modCapableServers.length > 0) {
      setSelectedServerId(modCapableServers[0].id);
    }
  }, [selectedServerId, modCapableServers]);

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    api
      .getModCategories()
      .then((res) => setAllCategories(res.categories))
      .catch(() => {});
    api
      .getModpackCategories()
      .then((res) => setModpackCategories(res.categories))
      .catch(() => {});
    api
      .getSettings()
      .then((settings) => {
        const cfEnabled = settings.curseforgeApiKey.length > 0;
        setCurseforgeConfigured(cfEnabled);
        if (cfEnabled) {
          setActiveSources(["modrinth", "curseforge"]);
        }
      })
      .catch(() => {});
  }, []);

  // Reset search and auto-fetch popular mods when server changes
  useEffect(() => {
    setQuery("");
    setResults([]);
    setModpackResults([]);
    setTotalHits(0);
    setOffset(0);
    setSearchError(null);
    setSelectedCategories([]);
    setEnvironment(null);
  }, [selectedServerId]);

  const doSearch = useCallback(
    async (q: string, newOffset = 0, mode: SearchMode = searchMode) => {
      if (!selectedServer) return;

      if (newOffset === 0) {
        setSearching(true);
      } else {
        setLoadingMore(true);
      }
      setSearchError(null);

      try {
        if (mode === "modpacks") {
          const res = await api.searchModpacks(
            q,
            newOffset,
            LIMIT,
            sort,
            selectedCategories.length > 0 ? selectedCategories : undefined,
            environment ?? undefined,
            activeSources.length < 2 ? activeSources : undefined,
            selectedServer!.mcVersion,
          );
          if (newOffset === 0) {
            setModpackResults(res.results);
          } else {
            setModpackResults((prev) => [...prev, ...res.results]);
          }
          setTotalHits(res.totalHits);
        } else {
          const loader = getLoaderFromServerType(selectedServer!.type);
          const res = await api.searchMods({
            q: q || undefined,
            loader,
            mcVersion: selectedServer!.mcVersion,
            sort,
            categories:
              selectedCategories.length > 0 ? selectedCategories : undefined,
            environment: environment ?? undefined,
            sources: activeSources.length < 2 ? activeSources : undefined,
            offset: newOffset,
            limit: LIMIT,
          });
          if (newOffset === 0) {
            setResults(res.results);
          } else {
            setResults((prev) => [...prev, ...res.results]);
          }
          setTotalHits(res.totalHits);
        }
        setOffset(newOffset);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearching(false);
        setLoadingMore(false);
      }
    },
    [
      selectedServer,
      searchMode,
      sort,
      selectedCategories,
      environment,
      activeSources,
    ],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(value, 0);
    }, 300);
  };

  const handleLoadMore = () => {
    doSearch(query, offset + LIMIT);
  };

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setQuery("");
    setResults([]);
    setModpackResults([]);
    setTotalHits(0);
    setOffset(0);
    setSearchError(null);
    setSelectedCategories([]);
    setEnvironment(null);

    if (selectedServer) {
      doSearch("", 0, mode);
    }
  };

  const handleSelectServer = (server: ServerWithStatus) => {
    setSelectedServerId(server.id);
  };

  const handleSortChange = (newSort: ModSortOption) => {
    setSort(newSort);
    setOffset(0);
  };

  const handleCategoriesChange = (slugs: string[]) => {
    setSelectedCategories(slugs);
    setOffset(0);
  };

  const handleEnvironmentChange = (env: ModEnvironment | null) => {
    setEnvironment(env);
    setOffset(0);
  };

  const handleSourcesChange = (sources: ModSource[]) => {
    setActiveSources(sources);
    setOffset(0);
  };

  useEffect(() => {
    if (!selectedServer) return;
    doSearch(query, 0, searchMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, sort, selectedCategories, environment, activeSources]);

  const loader = selectedServer
    ? getLoaderFromServerType(selectedServer.type)
    : null;

  const currentResults = searchMode === "mods" ? results : modpackResults;

  const canSearch = selectedServer !== null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Mods</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Browse, search, and install mods for your servers.
          </p>
        </div>

        {modCapableServers.length > 0 && (
          <ServerPicker
            servers={modCapableServers}
            selected={selectedServer}
            onSelect={handleSelectServer}
          />
        )}
      </div>

      {/* Segmented toggle */}
      <div className="mt-5 inline-flex rounded-lg border border-zinc-700 bg-zinc-800/50 p-0.5">
        {(["mods", "modpacks"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => handleSearchModeChange(mode)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              searchMode === mode
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {mode === "mods" ? "Mods" : "Modpacks"}
          </button>
        ))}
      </div>

      {/* No mod-capable servers */}
      {modCapableServers.length === 0 && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 py-16">
          <div className="rounded-full bg-zinc-800 p-3">
            <Package className="h-8 w-8 text-zinc-500" />
          </div>
          <h3 className="mt-4 text-base font-medium text-zinc-300">
            No mod-capable servers
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Create a Forge, Fabric, or NeoForge server to manage mods.
          </p>
        </div>
      )}

      {/* Search area */}
      {canSearch && (
        <div className="mt-6">
          {selectedServer && (
            <div className="mb-4 flex items-center gap-2 text-sm">
              {searchMode === "mods" && loader && (
                <span className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300">
                  {loader.charAt(0).toUpperCase() + loader.slice(1)}
                </span>
              )}
              <span className="text-zinc-500">
                {searchMode === "mods" ? "mods" : "modpacks"} for Minecraft{" "}
                <span className="font-medium text-zinc-300">
                  {selectedServer.mcVersion}
                </span>
              </span>
            </div>
          )}

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={
                searchMode === "mods" ? "Search mods..." : "Search modpacks..."
              }
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>

          {/* Two-column layout: results left, filters right */}
          <div className="mt-6 flex gap-6">
            {/* Left column: results header + results */}
            <div className="min-w-0 flex-1">
              <div className="mb-4 flex items-baseline justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    {query
                      ? `Results for \u2018${query}\u2019`
                      : searchMode === "mods"
                        ? "Popular Mods"
                        : "Popular Modpacks"}
                  </h3>
                  {totalHits > 0 && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {totalHits.toLocaleString()} results
                    </p>
                  )}
                </div>
              </div>

              <div>
                {searching && (
                  <div className="flex items-center justify-center py-16 gap-2 text-sm text-zinc-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Searching...
                  </div>
                )}

                {searchError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {searchError}
                  </div>
                )}

                {!searching &&
                  !searchError &&
                  currentResults.length === 0 &&
                  query.trim() && (
                    <div className="flex flex-col items-center justify-center py-16 text-sm text-zinc-500">
                      <Search className="h-8 w-8 text-zinc-600 mb-3" />
                      No {searchMode === "mods" ? "mods" : "modpacks"} found for
                      &ldquo;{query}&rdquo;
                    </div>
                  )}

                {!searching &&
                  !searchError &&
                  currentResults.length === 0 &&
                  !query.trim() &&
                  searchMode === "modpacks" && (
                    <div className="flex flex-col items-center justify-center py-16 text-sm text-zinc-500">
                      <Search className="h-8 w-8 text-zinc-600 mb-3" />
                      No modpacks found
                    </div>
                  )}

                {/* Mod results */}
                {!searching &&
                  searchMode === "mods" &&
                  results.length > 0 &&
                  selectedServer && (
                    <div className="space-y-3">
                      {results.map((mod) => (
                        <SearchResultCard
                          key={`${mod.source}-${mod.sourceId}`}
                          mod={mod}
                          serverId={selectedServer.id}
                          serverMcVersion={selectedServer.mcVersion}
                          loader={getLoaderFromServerType(selectedServer.type)}
                        />
                      ))}

                      {results.length < totalHits && (
                        <div className="pt-2">
                          <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                          >
                            {loadingMore ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading...
                              </span>
                            ) : (
                              `Load more (${results.length} of ${totalHits})`
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                {/* Modpack results */}
                {!searching &&
                  searchMode === "modpacks" &&
                  modpackResults.length > 0 && (
                    <div className="space-y-3">
                      {modpackResults.map((mp) => (
                        <ModpackSearchResultCard
                          key={`${mp.source}-${mp.sourceId}`}
                          modpack={mp}
                          onReview={setReviewModal}
                        />
                      ))}

                      {modpackResults.length < totalHits && (
                        <div className="pt-2">
                          <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                          >
                            {loadingMore ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading...
                              </span>
                            ) : (
                              `Load more (${modpackResults.length} of ${totalHits})`
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className="w-64 shrink-0">
              <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <ModFilterBar
                  sort={sort}
                  onSortChange={handleSortChange}
                  categories={
                    searchMode === "mods" ? allCategories : modpackCategories
                  }
                  selectedCategories={selectedCategories}
                  onCategoriesChange={handleCategoriesChange}
                  environment={environment}
                  onEnvironmentChange={handleEnvironmentChange}
                  sources={activeSources}
                  onSourcesChange={handleSourcesChange}
                  curseforgeConfigured={curseforgeConfigured}
                  showEnvironment={searchMode === "mods"}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt to select server */}
      {modCapableServers.length > 0 && !selectedServer && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 py-16">
          <div className="rounded-full bg-zinc-800 p-3">
            <Server className="h-8 w-8 text-zinc-500" />
          </div>
          <h3 className="mt-4 text-base font-medium text-zinc-300">
            Select a server
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Pick a server from the dropdown above to start browsing{" "}
            {searchMode === "mods" ? "mods" : "modpacks"}.
          </p>
        </div>
      )}

      {/* Modpack review modal */}
      {reviewModal && (
        <ModpackReviewModal
          data={reviewModal}
          servers={modCapableServers}
          onClose={() => setReviewModal(null)}
        />
      )}
    </div>
  );
}
