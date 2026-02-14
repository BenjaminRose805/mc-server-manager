import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import type {
  PropertyDefinition,
  PropertyGroup,
  ServerPropertiesResponse,
  ServerWithStatus,
} from "@mc-server-manager/shared";
import { JVM_PRESETS } from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { useServerStore } from "@/stores/serverStore";
import { cn } from "@/lib/utils";
import { logger } from "@/utils/logger";

// ============================================================
// PropertiesForm — main component
// ============================================================

interface PropertiesFormProps {
  server: ServerWithStatus;
  className?: string;
}

export function PropertiesForm({ server, className }: PropertiesFormProps) {
  const { fetchServers } = useServerStore();

  // --- Data loading ---
  const [data, setData] = useState<ServerPropertiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Form state (working copy of properties) ---
  const [formProps, setFormProps] = useState<Record<string, string>>({});
  const [jvmArgs, setJvmArgs] = useState(server.jvmArgs);
  const [autoStart, setAutoStart] = useState(server.autoStart);
  const [dirty, setDirty] = useState(false);

  // --- Save state ---
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // --- Collapsed groups ---
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getServerProperties(server.id);
      setData(res);
      setFormProps({ ...res.properties });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to load server properties", {
        error: errorMsg,
        serverId: server.id,
      });
      setError(
        err instanceof Error ? err.message : "Failed to load properties",
      );
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  // Sync server-level config when server record changes externally
  useEffect(() => {
    setJvmArgs(server.jvmArgs);
  }, [server.jvmArgs]);

  useEffect(() => {
    setAutoStart(server.autoStart);
  }, [server.autoStart]);

  // --- Handlers ---

  const updateProperty = (key: string, value: string) => {
    setFormProps((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveSuccess(false);
  };

  const handleJvmArgsChange = (value: string) => {
    setJvmArgs(value);
    setDirty(true);
    setSaveSuccess(false);
  };

  const handleAutoStartChange = (value: boolean) => {
    setAutoStart(value);
    setDirty(true);
    setSaveSuccess(false);
  };

  const handleReset = () => {
    if (data) {
      setFormProps({ ...data.properties });
    }
    setJvmArgs(server.jvmArgs);
    setAutoStart(server.autoStart);
    setDirty(false);
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Save properties
      const res = await api.updateServerProperties(server.id, {
        properties: formProps,
      });
      setData(res);
      setFormProps({ ...res.properties });

      // Save server-level config if changed
      const serverUpdates: Record<string, unknown> = {};
      if (jvmArgs !== server.jvmArgs) serverUpdates.jvmArgs = jvmArgs;
      if (autoStart !== server.autoStart) serverUpdates.autoStart = autoStart;

      if (Object.keys(serverUpdates).length > 0) {
        await api.updateServer(
          server.id,
          serverUpdates as Parameters<typeof api.updateServer>[1],
        );
        await fetchServers();
      }

      setDirty(false);
      setSaveSuccess(true);
      toast.success("Settings saved successfully");
      // Auto-clear success message after 3s
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      logger.warn("Failed to save server settings", {
        error: msg,
        serverId: server.id,
      });
      setSaveError(msg);
      toast.error(`Failed to save settings: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const isRunning =
    server.status === "running" ||
    server.status === "starting" ||
    server.status === "stopping";

  // --- Render ---

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-20", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        <span className="ml-2 text-sm text-zinc-500">Loading settings...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn("px-1", className)}>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error || "Failed to load server properties."}
        </div>
      </div>
    );
  }

  // Collect "other" properties not in any known group
  const knownKeys = new Set(
    data.groups.flatMap((g) => g.properties.map((p) => p.key)),
  );
  const otherKeys = Object.keys(formProps)
    .filter((k) => !knownKeys.has(k))
    .sort();

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── Scrollable content ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-4">
        {/* Running server warning */}
        {isRunning && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Server is running</p>
              <p className="mt-0.5 text-xs text-amber-400/80">
                Changes to server.properties and JVM arguments will take effect
                after the next server restart.
              </p>
            </div>
          </div>
        )}

        {/* ── Auto Start Toggle ──────────────────────────────── */}
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Auto Start
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Automatically start this server when the application launches.
              </p>
            </div>
            <button
              onClick={() => handleAutoStartChange(!autoStart)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                autoStart ? "bg-emerald-600" : "bg-zinc-700",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  autoStart ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>

        {/* ── JVM Arguments Section ───────────────────────────── */}
        <JvmArgsEditor value={jvmArgs} onChange={handleJvmArgsChange} />

        {/* ── Property Groups ─────────────────────────────────── */}
        {data.groups.map((group) => (
          <PropertyGroupSection
            key={group.id}
            group={group}
            formProps={formProps}
            onChange={updateProperty}
            collapsed={collapsedGroups.has(group.id)}
            onToggle={() => toggleGroup(group.id)}
          />
        ))}

        {/* ── Other / Unknown Properties ──────────────────────── */}
        {otherKeys.length > 0 && (
          <OtherPropertiesSection
            keys={otherKeys}
            formProps={formProps}
            onChange={updateProperty}
            collapsed={collapsedGroups.has("other")}
            onToggle={() => toggleGroup("other")}
          />
        )}
      </div>

      {/* ── Save Bar (fixed at bottom, outside scroll) ────────── */}
      <div className="shrink-0 flex items-center gap-3 border-t border-zinc-800 bg-zinc-900 px-4 py-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </button>

        <button
          onClick={handleReset}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>

        {saveSuccess && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="h-4 w-4" />
            Saved
          </span>
        )}

        {saveError && <span className="text-sm text-red-400">{saveError}</span>}

        {dirty && !saveSuccess && !saveError && (
          <span className="text-xs text-zinc-500">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// JVM Arguments Editor
// ============================================================

function JvmArgsEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [showPresets, setShowPresets] = useState(false);
  const activePreset = JVM_PRESETS.find((p) => p.args === value);

  return (
    <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-100">JVM Arguments</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Memory allocation and Java Virtual Machine flags. These control how
          much RAM the server can use.
        </p>
      </div>

      <div className="px-4 py-4 space-y-3">
        {/* Preset buttons */}
        <div>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showPresets && "rotate-180",
              )}
            />
            {activePreset ? `Preset: ${activePreset.label}` : "Choose a preset"}
          </button>

          {showPresets && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {JVM_PRESETS.map((preset) => {
                const isActive = preset.args === value;
                return (
                  <button
                    key={preset.label}
                    onClick={() => {
                      onChange(preset.args);
                      setShowPresets(false);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      isActive
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-zinc-700 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isActive ? "text-emerald-400" : "text-zinc-200",
                        )}
                      >
                        {preset.label}
                      </span>
                      {isActive && (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Raw args textarea */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            Raw JVM Arguments
          </label>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Property Group Section
// ============================================================

function PropertyGroupSection({
  group,
  formProps,
  onChange,
  collapsed,
  onToggle,
}: {
  group: PropertyGroup;
  formProps: Record<string, string>;
  onChange: (key: string, value: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{group.label}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{group.description}</p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
            !collapsed && "rotate-180",
          )}
        />
      </button>

      {!collapsed && (
        <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
          {group.properties.map((prop) => (
            <PropertyField
              key={prop.key}
              definition={prop}
              value={formProps[prop.key] ?? prop.defaultValue}
              onChange={(v) => onChange(prop.key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Individual Property Field
// ============================================================

function PropertyField({
  definition,
  value,
  onChange,
}: {
  definition: PropertyDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const isDefault = value === definition.defaultValue;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-zinc-200">
              {definition.label}
            </label>
            {!isDefault && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                Modified
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 leading-relaxed">
            {definition.description}
          </p>
        </div>

        <div className="shrink-0 w-48">
          {definition.type === "boolean" && (
            <BooleanInput value={value} onChange={onChange} />
          )}
          {definition.type === "select" && (
            <SelectInput
              value={value}
              options={definition.options ?? []}
              onChange={onChange}
            />
          )}
          {definition.type === "number" && (
            <NumberInput
              value={value}
              min={definition.min}
              max={definition.max}
              onChange={onChange}
            />
          )}
          {definition.type === "string" && (
            <StringInput value={value} onChange={onChange} />
          )}
        </div>
      </div>

      {/* Property key hint */}
      <div className="mt-1 flex items-center gap-1 text-[10px] text-zinc-600">
        <Info className="h-3 w-3" />
        <code>{definition.key}</code>
      </div>
    </div>
  );
}

// ============================================================
// Input Components
// ============================================================

function BooleanInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const isTrue = value === "true";

  return (
    <button
      onClick={() => onChange(isTrue ? "false" : "true")}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
        isTrue ? "bg-emerald-600" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          isTrue ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
      {/* If the current value isn't in options, show it as-is */}
      {!options.some((o) => o.value === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  const numValue = parseInt(value, 10);
  const isInvalid =
    isNaN(numValue) ||
    (min !== undefined && numValue < min) ||
    (max !== undefined && numValue > max);

  return (
    <div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-md border bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 outline-none transition-colors focus:ring-1",
          isInvalid
            ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/50"
            : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500",
        )}
      />
      {isInvalid && (
        <p className="mt-1 text-[10px] text-red-400">
          {min !== undefined && max !== undefined
            ? `Must be between ${min} and ${max}`
            : min !== undefined
              ? `Must be at least ${min}`
              : `Must be at most ${max}`}
        </p>
      )}
    </div>
  );
}

function StringInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
    />
  );
}

// ============================================================
// Other (Unknown) Properties Section
// ============================================================

function OtherPropertiesSection({
  keys,
  formProps,
  onChange,
  collapsed,
  onToggle,
}: {
  keys: string[];
  formProps: Record<string, string>;
  onChange: (key: string, value: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Other Properties
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {keys.length} additional propert{keys.length === 1 ? "y" : "ies"}{" "}
            set by the server or mods
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
            !collapsed && "rotate-180",
          )}
        />
      </button>

      {!collapsed && (
        <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
          {keys.map((key) => (
            <div key={key} className="flex items-center gap-3 px-4 py-2.5">
              <code className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                {key}
              </code>
              <input
                type="text"
                value={formProps[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
                className="w-48 shrink-0 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
