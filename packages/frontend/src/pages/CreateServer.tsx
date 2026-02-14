import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Search,
  Server,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ServerType,
  McVersion,
  JavaInfo,
  SystemInfo,
  DownloadRequest,
  ForgeVersionInfo,
  NeoForgeVersionInfo,
} from "@mc-server-manager/shared";
import { checkJavaMcCompat } from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/serverStore";
import { logger } from "@/utils/logger";

// ============================================================
// Types
// ============================================================

interface WizardState {
  serverType: ServerType;
  mcVersion: string;
  forgeVersion: string;
  name: string;
  port: number;
  minMemory: string;
  maxMemory: string;
  javaPath: string;
}

type WizardStep = "type" | "version" | "configure" | "create";

const STEPS: WizardStep[] = ["type", "version", "configure", "create"];

const STEP_LABELS: Record<WizardStep, string> = {
  type: "Server Type",
  version: "Version",
  configure: "Configure",
  create: "Review & Create",
};

const MEMORY_PRESETS = [
  { label: "1 GB", value: "1G" },
  { label: "2 GB", value: "2G" },
  { label: "4 GB", value: "4G" },
  { label: "6 GB", value: "6G" },
  { label: "8 GB", value: "8G" },
];

const SERVER_TYPES: {
  id: ServerType;
  name: string;
  description: string;
  available: boolean;
}[] = [
  {
    id: "vanilla",
    name: "Vanilla",
    description: "The official Mojang server. Pure, unmodified Minecraft.",
    available: true,
  },
  {
    id: "paper",
    name: "Paper",
    description: "High-performance Spigot fork with plugin support.",
    available: true,
  },
  {
    id: "fabric",
    name: "Fabric",
    description: "Lightweight modding platform for modern Minecraft.",
    available: true,
  },
  {
    id: "forge",
    name: "Forge",
    description: "The classic modding platform with the largest mod ecosystem.",
    available: true,
  },
  {
    id: "neoforge",
    name: "NeoForge",
    description: "Modern fork of Forge for Minecraft 1.20.2+.",
    available: true,
  },
];

// ============================================================
// Main Wizard Component
// ============================================================

export function CreateServer() {
  const navigate = useNavigate();
  const { fetchServers } = useServerStore();

  const [step, setStep] = useState<WizardStep>("type");
  const [state, setState] = useState<WizardState>({
    serverType: "vanilla",
    mcVersion: "",
    forgeVersion: "",
    name: "",
    port: 25565,
    minMemory: "1G",
    maxMemory: "2G",
    javaPath: "java",
  });

  // System info for memory recommendations
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  // Fetch system info on mount
  useEffect(() => {
    api
      .getJavaInfo()
      .then(setJavaInfo)
      .catch((err) => {
        logger.warn("Failed to fetch Java info", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    api
      .getSystemInfo()
      .then(setSystemInfo)
      .catch((err) => {
        logger.warn("Failed to fetch system info", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  // Auto-set java path from detected info
  useEffect(() => {
    if (javaInfo?.found && javaInfo.path) {
      setState((s) => ({ ...s, javaPath: javaInfo.path! }));
    }
  }, [javaInfo]);

  const stepIndex = STEPS.indexOf(step);

  const goNext = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx < STEPS.length) {
      setStep(STEPS[nextIdx]);
    }
  }, [stepIndex]);

  const goBack = useCallback(() => {
    const prevIdx = stepIndex - 1;
    if (prevIdx >= 0) {
      setStep(STEPS[prevIdx]);
    }
  }, [stepIndex]);

  const update = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState((s) => ({ ...s, [key]: value }));
    },
    [],
  );

  return (
    <div>
      {/* Header */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <h2 className="mt-4 text-2xl font-bold tracking-tight">Create Server</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Set up a new Minecraft server in a few steps.
      </p>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Step content */}
      <div className="mt-8">
        {step === "type" && (
          <TypeStep
            selected={state.serverType}
            onSelect={(t) => {
              update("serverType", t);
              if (t !== "forge" && t !== "neoforge") {
                update("forgeVersion", "");
              }
            }}
            onNext={goNext}
          />
        )}
        {step === "version" && (
          <VersionStep
            serverType={state.serverType}
            selected={state.mcVersion}
            onSelect={(v) => update("mcVersion", v)}
            forgeVersion={state.forgeVersion}
            onForgeVersionSelect={(v) => update("forgeVersion", v)}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "configure" && (
          <ConfigureStep
            state={state}
            update={update}
            systemInfo={systemInfo}
            javaInfo={javaInfo}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "create" && (
          <CreateStep
            state={state}
            javaInfo={javaInfo}
            onBack={goBack}
            onComplete={async (serverId) => {
              await fetchServers();
              toast.success("Server created successfully!");
              navigate(`/servers/${serverId}`);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Step Indicator
// ============================================================

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.indexOf(current);

  return (
    <div className="mt-8 flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = s === current;

        return (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-8",
                  isComplete ? "bg-emerald-500" : "bg-zinc-700",
                )}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                  isComplete
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                      ? "border-2 border-emerald-500 text-emerald-400"
                      : "border border-zinc-700 text-zinc-500",
                )}
              >
                {isComplete ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "hidden text-sm font-medium sm:inline",
                  isCurrent ? "text-zinc-200" : "text-zinc-500",
                )}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Step 1: Server Type Selection
// ============================================================

function TypeStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: ServerType;
  onSelect: (type: ServerType) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold">Choose Server Type</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Select the type of Minecraft server you want to run.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {SERVER_TYPES.map((type) => (
          <button
            key={type.id}
            disabled={!type.available}
            onClick={() => onSelect(type.id)}
            className={cn(
              "relative rounded-lg border p-4 text-left transition-colors",
              type.available
                ? selected === type.id
                  ? "border-emerald-500 bg-emerald-500/5"
                  : "border-zinc-700 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800/80"
                : "cursor-not-allowed border-zinc-800 bg-zinc-900/50 opacity-50",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">
                {type.name}
              </span>
              {!type.available && (
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                  Coming Soon
                </span>
              )}
              {selected === type.id && type.available && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-400">{type.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Version Picker
// ============================================================

function VersionStep({
  serverType,
  selected,
  onSelect,
  forgeVersion,
  onForgeVersionSelect,
  onNext,
  onBack,
}: {
  serverType: ServerType;
  selected: string;
  onSelect: (version: string) => void;
  forgeVersion: string;
  onForgeVersionSelect: (version: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [search, setSearch] = useState("");

  const [forgeInfo, setForgeInfo] = useState<ForgeVersionInfo | null>(null);
  const [neoforgeInfo, setNeoforgeInfo] = useState<NeoForgeVersionInfo | null>(
    null,
  );
  const [forgeLoading, setForgeLoading] = useState(false);

  const needsLoaderVersion =
    serverType === "forge" || serverType === "neoforge";

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getVersions(serverType, showSnapshots)
      .then((v) => {
        setVersions(v);
        setLoading(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to fetch versions",
        );
        setLoading(false);
      });
  }, [serverType, showSnapshots]);

  useEffect(() => {
    if (!needsLoaderVersion || !selected) {
      setForgeInfo(null);
      setNeoforgeInfo(null);
      onForgeVersionSelect("");
      return;
    }
    setForgeLoading(true);
    onForgeVersionSelect("");
    api
      .getVersionInfo(serverType, selected)
      .then((info) => {
        if (serverType === "neoforge") {
          const ni = info as NeoForgeVersionInfo;
          setNeoforgeInfo(ni);
          setForgeInfo(null);
          if (ni.latest) {
            onForgeVersionSelect(ni.latest);
          }
        } else {
          const fi = info as ForgeVersionInfo;
          setForgeInfo(fi);
          setNeoforgeInfo(null);
          if (fi.latest) {
            onForgeVersionSelect(fi.latest);
          }
        }
        setForgeLoading(false);
      })
      .catch((err) => {
        logger.warn("Failed to fetch versions", {
          error: err instanceof Error ? err.message : String(err),
        });
        setForgeInfo(null);
        setNeoforgeInfo(null);
        setForgeLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverType, selected]);

  const filtered = versions.filter((v) =>
    v.id.toLowerCase().includes(search.toLowerCase()),
  );

  // Group versions by major version (e.g., "1.21", "1.20")
  const grouped = new Map<string, McVersion[]>();
  for (const v of filtered) {
    const parts = v.id.split(".");
    const major = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : v.id;
    if (!grouped.has(major)) grouped.set(major, []);
    grouped.get(major)!.push(v);
  }

  return (
    <div>
      <h3 className="text-lg font-semibold">Select Version</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Choose the Minecraft version for your server.
      </p>

      {/* Controls */}
      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search versions..."
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={showSnapshots}
            onChange={(e) => setShowSnapshots(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50"
          />
          Show snapshots
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading versions...
        </div>
      )}

      {/* Version list */}
      {!loading && !error && (
        <div className="mt-4 max-h-[400px] overflow-y-auto rounded-lg border border-zinc-800">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No versions match your search.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {Array.from(grouped.entries()).map(([major, versionList]) => (
                <VersionGroup
                  key={major}
                  major={major}
                  versions={versionList}
                  selected={selected}
                  onSelect={onSelect}
                  latestRelease={versions.find((v) => v.type === "release")?.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {serverType === "forge" && selected && (
        <ForgeVersionPicker
          forgeInfo={forgeInfo}
          loading={forgeLoading}
          selected={forgeVersion}
          onSelect={onForgeVersionSelect}
        />
      )}

      {serverType === "neoforge" && selected && (
        <NeoForgeVersionPicker
          neoforgeInfo={neoforgeInfo}
          loading={forgeLoading}
          selected={forgeVersion}
          onSelect={onForgeVersionSelect}
        />
      )}

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!selected || (needsLoaderVersion && !forgeVersion)}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Version Group (collapsible)
// ============================================================

function VersionGroup({
  major,
  versions,
  selected,
  onSelect,
  latestRelease,
}: {
  major: string;
  versions: McVersion[];
  selected: string;
  onSelect: (v: string) => void;
  latestRelease?: string;
}) {
  const hasSelected = versions.some((v) => v.id === selected);
  const isFirstGroup = versions.some((v) => v.id === latestRelease);
  const [open, setOpen] = useState(hasSelected || isFirstGroup);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800/50"
      >
        <span>
          {major}.x
          <span className="ml-2 text-xs text-zinc-500">
            ({versions.length} version{versions.length !== 1 ? "s" : ""})
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-zinc-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-1.5 px-4 pb-3 sm:grid-cols-4 md:grid-cols-6">
          {versions.map((v) => {
            const isSelected = v.id === selected;
            const isLatest = v.id === latestRelease;
            return (
              <button
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={cn(
                  "relative rounded-md border px-3 py-1.5 text-center text-sm transition-colors",
                  isSelected
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : v.type === "snapshot"
                      ? "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800",
                )}
              >
                {v.id}
                {isLatest && (
                  <span
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400"
                    title="Latest release"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ForgeVersionPicker({
  forgeInfo,
  loading,
  selected,
  onSelect,
}: {
  forgeInfo: ForgeVersionInfo | null;
  loading: boolean;
  selected: string;
  onSelect: (v: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Forge versions...
      </div>
    );
  }

  if (!forgeInfo) return null;

  const displayVersions = showAll
    ? forgeInfo.forgeVersions
    : forgeInfo.forgeVersions.slice(0, 12);

  return (
    <div className="mt-6">
      <h4 className="text-sm font-semibold text-zinc-200">Forge Version</h4>
      <p className="mt-1 text-xs text-zinc-400">
        Select a Forge build for this Minecraft version.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {displayVersions.map((v) => {
          const isSelected = v === selected;
          const isLatest = v === forgeInfo.latest;
          return (
            <button
              key={v}
              onClick={() => onSelect(v)}
              className={cn(
                "relative rounded-md border px-3 py-1.5 text-center text-xs transition-colors",
                isSelected
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800",
              )}
            >
              {v}
              {isLatest && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400"
                  title="Latest"
                />
              )}
            </button>
          );
        })}
      </div>

      {!showAll && forgeInfo.forgeVersions.length > 12 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Show all {forgeInfo.forgeVersions.length} versions...
        </button>
      )}
    </div>
  );
}

function NeoForgeVersionPicker({
  neoforgeInfo,
  loading,
  selected,
  onSelect,
}: {
  neoforgeInfo: NeoForgeVersionInfo | null;
  loading: boolean;
  selected: string;
  onSelect: (v: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading NeoForge versions...
      </div>
    );
  }

  if (!neoforgeInfo) return null;

  const displayVersions = showAll
    ? neoforgeInfo.neoforgeVersions
    : neoforgeInfo.neoforgeVersions.slice(0, 12);

  return (
    <div className="mt-6">
      <h4 className="text-sm font-semibold text-zinc-200">NeoForge Version</h4>
      <p className="mt-1 text-xs text-zinc-400">
        Select a NeoForge build for this Minecraft version.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {displayVersions.map((v) => {
          const isSelected = v === selected;
          const isLatest = v === neoforgeInfo.latest;
          return (
            <button
              key={v}
              onClick={() => onSelect(v)}
              className={cn(
                "relative rounded-md border px-3 py-1.5 text-center text-xs transition-colors",
                isSelected
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800",
              )}
            >
              {v}
              {isLatest && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400"
                  title="Latest"
                />
              )}
            </button>
          );
        })}
      </div>

      {!showAll && neoforgeInfo.neoforgeVersions.length > 12 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Show all {neoforgeInfo.neoforgeVersions.length} versions...
        </button>
      )}
    </div>
  );
}

// ============================================================
// Step 3: Configure
// ============================================================

function ConfigureStep({
  state,
  update,
  systemInfo,
  javaInfo,
  onNext,
  onBack,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  systemInfo: SystemInfo | null;
  javaInfo: JavaInfo | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const [nameError, setNameError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);

  // Auto-generate name if empty when arriving at this step
  useEffect(() => {
    if (!state.name) {
      const typeName =
        SERVER_TYPES.find((t) => t.id === state.serverType)?.name ?? "Server";
      update("name", `${typeName} ${state.mcVersion}`);
    }
    // Only run on mount of this step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = (): boolean => {
    let valid = true;

    if (!state.name.trim()) {
      setNameError("Server name is required");
      valid = false;
    } else if (state.name.length > 100) {
      setNameError("Server name must be 100 characters or less");
      valid = false;
    } else {
      setNameError(null);
    }

    if (state.port < 1024 || state.port > 65535) {
      setPortError("Port must be between 1024 and 65535");
      valid = false;
    } else {
      setPortError(null);
    }

    return valid;
  };

  const handleNext = () => {
    if (validate()) {
      onNext();
    }
  };

  const totalMemGB = systemInfo
    ? Math.floor(systemInfo.totalMemoryMB / 1024)
    : null;

  return (
    <div>
      <h3 className="text-lg font-semibold">Configure Server</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Set the name, port, and memory for your server.
      </p>

      <div className="mt-6 max-w-lg space-y-6">
        {/* Server Name */}
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Server Name
          </label>
          <input
            type="text"
            value={state.name}
            onChange={(e) => {
              update("name", e.target.value);
              setNameError(null);
            }}
            className={cn(
              "mt-1.5 w-full rounded-md border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1",
              nameError
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500",
            )}
            placeholder="My Minecraft Server"
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-400">{nameError}</p>
          )}
        </div>

        {/* Port */}
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Port
          </label>
          <input
            type="number"
            value={state.port}
            onChange={(e) => {
              update("port", parseInt(e.target.value, 10) || 0);
              setPortError(null);
            }}
            min={1024}
            max={65535}
            className={cn(
              "mt-1.5 w-full rounded-md border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1",
              portError
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500",
            )}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Default is 25565. Use a different port for multiple servers.
          </p>
          {portError && (
            <p className="mt-1 text-xs text-red-400">{portError}</p>
          )}
        </div>

        {/* Memory */}
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Maximum Memory
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {MEMORY_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => update("maxMemory", preset.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  state.maxMemory === preset.value
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {totalMemGB && (
            <p className="mt-1.5 text-xs text-zinc-500">
              System has {totalMemGB} GB total RAM. Recommended: allocate at
              most half for Minecraft.
            </p>
          )}
        </div>

        {/* Min Memory */}
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Minimum Memory
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {MEMORY_PRESETS.filter(
              (p) => parseMemoryGB(p.value) <= parseMemoryGB(state.maxMemory),
            ).map((preset) => (
              <button
                key={preset.value}
                onClick={() => update("minMemory", preset.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  state.minMemory === preset.value
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Java Path */}
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Java Path
          </label>
          <input
            type="text"
            value={state.javaPath}
            onChange={(e) => update("javaPath", e.target.value)}
            className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
          {javaInfo?.found ? (
            <p className="mt-1 text-xs text-emerald-400">
              Java detected: {javaInfo.version}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-400">
              Java not detected on system. Please set the path manually.
            </p>
          )}
          {/* Java / MC version compatibility warning */}
          {javaInfo?.found &&
            javaInfo.version &&
            (() => {
              const warning = checkJavaMcCompat(
                javaInfo.version,
                state.mcVersion,
              );
              if (!warning) return null;
              return (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{warning}</span>
                </div>
              );
            })()}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Review
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function parseMemoryGB(value: string): number {
  const num = parseInt(value, 10);
  if (value.endsWith("G")) return num;
  if (value.endsWith("M")) return num / 1024;
  return num;
}

// ============================================================
// Helper: Build type-safe download request
// ============================================================

function buildDownloadRequest(
  serverId: string,
  mcVersion: string,
  serverType: ServerType,
  forgeVersion?: string,
): DownloadRequest {
  switch (serverType) {
    case "vanilla":
      return { serverId, mcVersion, serverType: "vanilla" };
    case "paper":
      return { serverId, mcVersion, serverType: "paper" };
    case "fabric":
      return { serverId, mcVersion, serverType: "fabric" };
    case "forge":
      if (!forgeVersion) throw new Error("Forge version is required");
      return { serverId, mcVersion, serverType: "forge", forgeVersion };
    case "neoforge":
      if (!forgeVersion) throw new Error("NeoForge version is required");
      return {
        serverId,
        mcVersion,
        serverType: "neoforge",
        neoforgeVersion: forgeVersion,
      };
  }
}

// ============================================================
// Step 4: Review & Create
// ============================================================

type CreatePhase =
  | "review"
  | "creating"
  | "downloading"
  | "installing"
  | "done"
  | "error";

function CreateStep({
  state,
  javaInfo,
  onBack,
  onComplete,
}: {
  state: WizardState;
  javaInfo: JavaInfo | null;
  onBack: () => void;
  onComplete: (serverId: string) => void;
}) {
  const [phase, setPhase] = useState<CreatePhase>("review");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [createdServerId, setCreatedServerId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadJobIdRef = useRef<string | null>(null);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const jvmArgs = `-Xmx${state.maxMemory} -Xms${state.minMemory}`;

  const handleCreate = async () => {
    setPhase("creating");
    setError(null);

    try {
      // Step 1: Create the server record + directory
      const server = await api.createServer({
        name: state.name.trim(),
        type: state.serverType,
        mcVersion: state.mcVersion,
        port: state.port,
        jvmArgs,
        javaPath: state.javaPath,
      });

      setCreatedServerId(server.id);

      // Step 2: Start the JAR download
      setPhase("downloading");
      const downloadRequest = buildDownloadRequest(
        server.id,
        state.mcVersion,
        state.serverType,
        state.forgeVersion || undefined,
      );
      const downloadJob = await api.startDownload(downloadRequest);
      downloadJobIdRef.current = downloadJob.id;

      // Step 3: Poll for download progress
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.getDownloadStatus(downloadJob.id);
          setProgress(job.progress);

          if (job.status === "installing") {
            setPhase("installing");
            if (job.log && job.log.length > 0) {
              setInstallLog(job.log);
            }
          } else if (job.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPhase("done");
          } else if (job.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setError(job.error || "Download failed");
            setPhase("error");
          }
        } catch (err) {
          logger.warn("Download status poll failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          // polling errors are retried on the next interval
        }
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to create server", { error: errorMsg });
      setError(err instanceof Error ? err.message : "Failed to create server");
      setPhase("error");
    }
  };

  const handleCancel = async () => {
    if (!downloadJobIdRef.current || cancelling) return;
    setCancelling(true);
    try {
      await api.cancelDownload(downloadJobIdRef.current);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setError("Download cancelled");
      setPhase("error");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to cancel download", { error: errorMsg });
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel download",
      );
    } finally {
      setCancelling(false);
    }
  };

  const typeName =
    SERVER_TYPES.find((t) => t.id === state.serverType)?.name ??
    state.serverType;

  return (
    <div>
      <h3 className="text-lg font-semibold">
        {phase === "review" && "Review & Create"}
        {phase === "creating" && "Creating Server..."}
        {phase === "downloading" && "Downloading Server JAR..."}
        {phase === "installing" &&
          (state.serverType === "neoforge"
            ? "Installing NeoForge..."
            : "Installing Forge...")}
        {phase === "done" && "Server Created!"}
        {phase === "error" && "Error"}
      </h3>

      {/* Review summary */}
      {phase === "review" && (
        <>
          <p className="mt-1 text-sm text-zinc-400">
            Confirm your server settings before creating.
          </p>

          <div className="mt-6 max-w-lg overflow-hidden rounded-lg border border-zinc-800">
            <SummaryRow label="Server Type" value={typeName} />
            <SummaryRow label="Minecraft Version" value={state.mcVersion} />
            {state.serverType === "forge" && state.forgeVersion && (
              <SummaryRow label="Forge Version" value={state.forgeVersion} />
            )}
            {state.serverType === "neoforge" && state.forgeVersion && (
              <SummaryRow label="NeoForge Version" value={state.forgeVersion} />
            )}
            <SummaryRow label="Server Name" value={state.name} />
            <SummaryRow label="Port" value={String(state.port)} />
            <SummaryRow
              label="Memory"
              value={`${state.minMemory} - ${state.maxMemory}`}
            />
            <SummaryRow label="JVM Args" value={jvmArgs} />
            <SummaryRow label="Java" value={state.javaPath} last />
          </div>

          {/* Java / MC version compatibility warning */}
          {javaInfo?.found &&
            javaInfo.version &&
            (() => {
              const warning = checkJavaMcCompat(
                javaInfo.version,
                state.mcVersion,
              );
              if (!warning) return null;
              return (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Java Version Warning</p>
                    <p className="mt-1 text-xs text-amber-400/80">{warning}</p>
                  </div>
                </div>
              );
            })()}

          {/* EULA notice */}
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
            <p className="font-medium">Minecraft EULA</p>
            <p className="mt-1 text-xs text-amber-400/80">
              By creating this server, you agree to the{" "}
              <a
                href="https://aka.ms/MinecraftEULA"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-amber-300"
              >
                Minecraft End User License Agreement
              </a>
              . The EULA will be automatically accepted on server creation.
            </p>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Server className="h-4 w-4" />
              Create Server
            </button>
          </div>
        </>
      )}

      {(phase === "creating" ||
        phase === "downloading" ||
        phase === "installing") && (
        <div className="mt-8 max-w-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm text-zinc-300">
              {phase === "creating" && "Setting up server directory..."}
              {phase === "downloading" &&
                `Downloading server JAR... ${progress}%`}
              {phase === "installing" &&
                (state.serverType === "neoforge"
                  ? "Running NeoForge installer... this may take a few minutes"
                  : "Running Forge installer... this may take a few minutes")}
            </span>
          </div>

          {(phase === "downloading" || phase === "installing") && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {phase === "downloading"
                  ? `Downloading Minecraft ${state.mcVersion} server JAR...`
                  : state.serverType === "neoforge"
                    ? "Installing NeoForge libraries and patching server..."
                    : "Installing Forge libraries and patching server..."}
              </p>
            </div>
          )}

          {phase === "installing" && installLog.length > 0 && (
            <div className="mt-4 max-h-[160px] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-400">
              {installLog.slice(-20).map((line, i) => (
                <div key={i} className="leading-5">
                  {line}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {cancelling ? "Cancelling..." : "Cancel Download"}
          </button>
        </div>
      )}

      {/* Done */}
      {phase === "done" && createdServerId && (
        <div className="mt-8 max-w-lg">
          <div className="flex items-center gap-3 text-emerald-400">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium">
              Server "{state.name}" created successfully!
            </span>
          </div>

          <button
            onClick={() => onComplete(createdServerId)}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Go to Server
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div className="mt-8 max-w-lg">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-red-400">
              <AlertCircle className="h-4 w-4" />
              Failed to create server
            </div>
            <p className="mt-1 text-sm text-red-400/80">{error}</p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Retry
            </button>
            {createdServerId && (
              <button
                onClick={() => onComplete(createdServerId)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Go to Server Anyway
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Summary Row
// ============================================================

function SummaryRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3 text-sm",
        !last && "border-b border-zinc-800",
      )}
    >
      <span className="font-medium text-zinc-400">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  );
}
