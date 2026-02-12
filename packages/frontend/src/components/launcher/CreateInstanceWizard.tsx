import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import type {
  CreateInstanceRequest,
  MinecraftVersion,
  LoaderType,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";

type WizardStep = "version" | "loader" | "configure" | "review";

const STEPS: WizardStep[] = ["version", "loader", "configure", "review"];

const STEP_LABELS: Record<WizardStep, string> = {
  version: "Version",
  loader: "Mod Loader",
  configure: "Configure",
  review: "Review & Create",
};

const LOADER_OPTIONS: {
  id: LoaderType | "none";
  name: string;
  description: string;
}[] = [
  { id: "none", name: "None", description: "Vanilla Minecraft, no mods." },
  {
    id: "fabric",
    name: "Fabric",
    description: "Lightweight, modern modding platform.",
  },
  {
    id: "forge",
    name: "Forge",
    description: "Classic modding platform with the largest ecosystem.",
  },
  {
    id: "neoforge",
    name: "NeoForge",
    description: "Modern fork of Forge for 1.20.2+.",
  },
  {
    id: "quilt",
    name: "Quilt",
    description: "Fabric-compatible loader with extra features.",
  },
];

interface CreateInstanceWizardProps {
  onClose: () => void;
  onCreate: (data: CreateInstanceRequest) => void;
}

export function CreateInstanceWizard({
  onClose,
  onCreate,
}: CreateInstanceWizardProps) {
  const [step, setStep] = useState<WizardStep>("version");
  const [mcVersion, setMcVersion] = useState("");
  const [versionType, setVersionType] = useState<"release" | "snapshot">(
    "release",
  );
  const [loader, setLoader] = useState<LoaderType | "none">("none");
  const [name, setName] = useState("");
  const [ramMin, setRamMin] = useState(2);
  const [ramMax, setRamMax] = useState(4);

  const stepIndex = STEPS.indexOf(step);

  const goNext = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx < STEPS.length) setStep(STEPS[nextIdx]);
  }, [stepIndex]);

  const goBack = useCallback(() => {
    const prevIdx = stepIndex - 1;
    if (prevIdx >= 0) setStep(STEPS[prevIdx]);
  }, [stepIndex]);

  useEffect(() => {
    if (step === "configure" && !name && mcVersion) {
      const loaderLabel =
        loader !== "none"
          ? ` ${loader.charAt(0).toUpperCase() + loader.slice(1)}`
          : "";
      setName(`Minecraft ${mcVersion}${loaderLabel}`);
    }
  }, [step, name, mcVersion, loader]);

  const handleCreate = () => {
    onCreate({
      name: name.trim() || `Minecraft ${mcVersion}`,
      mcVersion,
      versionType: versionType === "snapshot" ? "snapshot" : "release",
      loader: loader === "none" ? undefined : loader,
      ramMin,
      ramMax,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-lg font-bold text-zinc-100">New Instance</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <StepIndicator current={step} />

        <div className="px-6 pb-6">
          {step === "version" && (
            <VersionStep
              selected={mcVersion}
              onSelect={setMcVersion}
              filter={versionType}
              onFilterChange={setVersionType}
              onNext={goNext}
            />
          )}
          {step === "loader" && (
            <LoaderStep
              selected={loader}
              onSelect={setLoader}
              onNext={goNext}
              onBack={goBack}
            />
          )}
          {step === "configure" && (
            <ConfigureStep
              name={name}
              onNameChange={setName}
              ramMin={ramMin}
              ramMax={ramMax}
              onRamMinChange={setRamMin}
              onRamMaxChange={setRamMax}
              onNext={goNext}
              onBack={goBack}
            />
          )}
          {step === "review" && (
            <ReviewStep
              mcVersion={mcVersion}
              loader={loader}
              name={name}
              ramMin={ramMin}
              ramMax={ramMax}
              onBack={goBack}
              onCreate={handleCreate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.indexOf(current);

  return (
    <div className="flex items-center gap-2 px-6 py-4">
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

function VersionStep({
  selected,
  onSelect,
  filter,
  onFilterChange,
  onNext,
}: {
  selected: string;
  onSelect: (v: string) => void;
  filter: "release" | "snapshot";
  onFilterChange: (f: "release" | "snapshot") => void;
  onNext: () => void;
}) {
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getLauncherVersions(filter === "snapshot" ? undefined : "release")
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [filter]);

  const filtered = versions.filter((v) =>
    v.id.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <h3 className="text-lg font-semibold text-zinc-100">Select Version</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Choose the Minecraft version for this instance.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search versions..."
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-700">
          <button
            onClick={() => onFilterChange("release")}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors",
              filter === "release"
                ? "bg-emerald-600 text-white"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200",
            )}
          >
            Releases
          </button>
          <button
            onClick={() => onFilterChange("snapshot")}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors",
              filter === "snapshot"
                ? "bg-emerald-600 text-white"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200",
            )}
          >
            All
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading versions...
        </div>
      )}

      {!loading && (
        <div className="mt-4 max-h-[300px] overflow-y-auto rounded-lg border border-zinc-800">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No versions match your search.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 p-3 sm:grid-cols-4 md:grid-cols-5">
              {filtered.slice(0, 60).map((v) => {
                const isSelected = v.id === selected;
                return (
                  <button
                    key={v.id}
                    onClick={() => onSelect(v.id)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-center text-sm transition-colors",
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : v.type === "release"
                          ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                          : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                    )}
                  >
                    {v.id}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          disabled={!selected}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function LoaderStep({
  selected,
  onSelect,
  onNext,
  onBack,
}: {
  selected: LoaderType | "none";
  onSelect: (l: LoaderType | "none") => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-zinc-100">Mod Loader</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Optionally select a mod loader for this instance.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {LOADER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className={cn(
              "relative rounded-lg border p-4 text-left transition-colors",
              selected === opt.id
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-zinc-700 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-800/80",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">
                {opt.name}
              </span>
              {selected === opt.id && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-400">{opt.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
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

function ConfigureStep({
  name,
  onNameChange,
  ramMin,
  ramMax,
  onRamMinChange,
  onRamMaxChange,
  onNext,
  onBack,
}: {
  name: string;
  onNameChange: (v: string) => void;
  ramMin: number;
  ramMax: number;
  onRamMinChange: (v: number) => void;
  onRamMaxChange: (v: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [nameError, setNameError] = useState<string | null>(null);

  const validate = (): boolean => {
    if (!name.trim()) {
      setNameError("Instance name is required");
      return false;
    }
    setNameError(null);
    return true;
  };

  const handleNext = () => {
    if (validate()) onNext();
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-zinc-100">Configuration</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Name your instance and set memory allocation.
      </p>

      <div className="mt-6 max-w-lg space-y-6">
        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Instance Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              onNameChange(e.target.value);
              setNameError(null);
            }}
            className={cn(
              "mt-1.5 w-full rounded-md border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1",
              nameError
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500",
            )}
            placeholder="My Minecraft Instance"
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-400">{nameError}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Maximum RAM ({ramMax} GB)
          </label>
          <input
            type="range"
            min={1}
            max={32}
            value={ramMax}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              onRamMaxChange(val);
              if (ramMin > val) onRamMinChange(val);
            }}
            className="mt-2 w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>1 GB</span>
            <span>32 GB</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-200">
            Minimum RAM ({ramMin} GB)
          </label>
          <input
            type="range"
            min={1}
            max={ramMax}
            value={ramMin}
            onChange={(e) => onRamMinChange(parseInt(e.target.value, 10))}
            className="mt-2 w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>1 GB</span>
            <span>{ramMax} GB</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
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

function ReviewStep({
  mcVersion,
  loader,
  name,
  ramMin,
  ramMax,
  onBack,
  onCreate,
}: {
  mcVersion: string;
  loader: LoaderType | "none";
  name: string;
  ramMin: number;
  ramMax: number;
  onBack: () => void;
  onCreate: () => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-zinc-100">Review & Create</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Confirm your instance settings.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
        <SummaryRow label="Instance Name" value={name} />
        <SummaryRow label="Minecraft Version" value={mcVersion} />
        <SummaryRow
          label="Mod Loader"
          value={
            loader === "none"
              ? "None (Vanilla)"
              : loader.charAt(0).toUpperCase() + loader.slice(1)
          }
        />
        <SummaryRow label="RAM" value={`${ramMin} GB - ${ramMax} GB`} last />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Check className="h-4 w-4" />
          Create Instance
        </button>
      </div>
    </div>
  );
}

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
