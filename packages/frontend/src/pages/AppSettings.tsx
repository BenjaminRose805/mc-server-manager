import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  Coffee,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  RotateCcw,
  Save,
  ScrollText,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AppSettings,
  JavaInfo,
  SystemInfo,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Settings page skeleton
// ---------------------------------------------------------------------------

function SettingsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <div className="h-5 w-40 rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-64 rounded bg-zinc-800/60" />
          <div className="mt-4 h-9 w-full rounded-md bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppSettings page
// ---------------------------------------------------------------------------

export function AppSettings() {
  // Data
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<Partial<AppSettings>>({});
  const [dirty, setDirty] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Java validation
  const [validatingJava, setValidatingJava] = useState(false);
  const [javaValidation, setJavaValidation] = useState<JavaInfo | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, j, sys] = await Promise.all([
        api.getSettings(),
        api.getJavaInfo(),
        api.getSystemInfo(),
      ]);
      setSettings(s);
      setForm(s);
      setJavaInfo(j);
      setSystemInfo(sys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateField = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setForm((prev: Partial<AppSettings>) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(form);
      setSettings(updated);
      setForm(updated);
      setDirty(false);
      setSaveSuccess(true);
      toast.success("Settings saved");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save settings";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setForm(settings);
      setDirty(false);
      setSaveSuccess(false);
      setJavaValidation(null);
    }
  };

  const validateJavaPath = async (path: string) => {
    if (!path.trim()) return;
    setValidatingJava(true);
    setJavaValidation(null);
    try {
      const info = await api.getJavaInfo(path);
      setJavaValidation(info);
    } catch {
      setJavaValidation({ found: false, path: null, version: null });
    } finally {
      setValidatingJava(false);
    }
  };

  // -- Render --

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Application-level configuration.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6">
          <SettingsSkeleton />
        </div>
      ) : settings ? (
        <div className="mt-6 space-y-6">
          {/* ── Java Path ──────────────────────────────────────────── */}
          <SettingGroup
            icon={Coffee}
            title="Java Path"
            description={
              javaInfo?.found
                ? `Detected: ${javaInfo.path} (Java ${javaInfo.version})`
                : "No Java detected on system PATH"
            }
          >
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.javaPath ?? ""}
                  onChange={(e) => updateField("javaPath", e.target.value)}
                  placeholder="java"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                />
                <button
                  onClick={() => validateJavaPath(form.javaPath ?? "java")}
                  disabled={validatingJava}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  {validatingJava ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )}
                  Validate
                </button>
              </div>

              {javaValidation && (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                    javaValidation.found
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border border-red-500/30 bg-red-500/10 text-red-400",
                  )}
                >
                  {javaValidation.found ? (
                    <>
                      <Check className="h-4 w-4 shrink-0" />
                      Found Java {javaValidation.version} at{" "}
                      {javaValidation.path}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Java not found at this path
                    </>
                  )}
                </div>
              )}

              <p className="text-xs text-zinc-500">
                Path to the Java binary used to run Minecraft servers. Use
                &quot;java&quot; to use the system default, or provide an
                absolute path.
              </p>
            </div>
          </SettingGroup>

          {/* ── Data Directory ─────────────────────────────────────── */}
          <SettingGroup
            icon={FolderOpen}
            title="Data Directory"
            description="Where server files, backups, and the database are stored"
          >
            <div className="space-y-2">
              <input
                type="text"
                value={form.dataDir ?? ""}
                onChange={(e) => updateField("dataDir", e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Changing this requires moving existing files manually. Existing
                servers will continue using their current paths.
              </div>
            </div>
          </SettingGroup>

          {/* ── Default JVM Args ───────────────────────────────────── */}
          <SettingGroup
            icon={Cpu}
            title="Default JVM Arguments"
            description="Default arguments used when creating new servers"
          >
            <div className="space-y-2">
              <textarea
                value={form.defaultJvmArgs ?? ""}
                onChange={(e) => updateField("defaultJvmArgs", e.target.value)}
                rows={2}
                spellCheck={false}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                These arguments are applied as the default when creating new
                servers. Individual servers can override them.
              </p>
            </div>
          </SettingGroup>

          {/* ── Max Console Lines ──────────────────────────────────── */}
          <SettingGroup
            icon={ScrollText}
            title="Console Buffer Size"
            description="Maximum number of console output lines kept in memory per server"
          >
            <div className="space-y-2">
              <input
                type="number"
                value={form.maxConsoleLines ?? 1000}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) updateField("maxConsoleLines", val);
                }}
                min={100}
                max={10000}
                step={100}
                className="w-48 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              />
              <p className="text-xs text-zinc-500">
                Number of lines kept in the ring buffer (100–10,000). Higher
                values use more memory. Default: 1000.
              </p>
            </div>
          </SettingGroup>

          {/* ── System Info ────────────────────────────────────────── */}
          {systemInfo && (
            <SettingGroup
              icon={HardDrive}
              title="System Information"
              description="Read-only system details"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <InfoCard label="Platform" value={systemInfo.platform} />
                <InfoCard label="Architecture" value={systemInfo.arch} />
                <InfoCard
                  label="Total RAM"
                  value={`${Math.round(systemInfo.totalMemoryMB / 1024)} GB`}
                />
                <InfoCard label="CPU Cores" value={String(systemInfo.cpus)} />
              </div>
            </SettingGroup>
          )}

          {/* ── Save Bar ──────────────────────────────────────────── */}
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-1 py-3">
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

            {dirty && !saveSuccess && (
              <span className="text-xs text-zinc-500">Unsaved changes</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setting group container
// ---------------------------------------------------------------------------

function SettingGroup({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only info card
// ---------------------------------------------------------------------------

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-zinc-300">{value}</p>
    </div>
  );
}
