import { useState, useEffect, useCallback, useRef } from "react";
import {
  User,
  Trash2,
  ExternalLink,
  Loader2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Monitor,
} from "lucide-react";
import { toast } from "sonner";
import type {
  LauncherAccount,
  MSAuthDeviceCode,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { isDesktop } from "@/utils/desktop";

interface AccountManagerProps {
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
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

type AuthPhase =
  | "idle"
  | "requesting"
  | "awaiting"
  | "polling"
  | "success"
  | "error";

export function AccountManager({
  selectedAccountId,
  onSelectAccount,
}: AccountManagerProps) {
  const [accounts, setAccounts] = useState<LauncherAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [authPhase, setAuthPhase] = useState<AuthPhase>("idle");
  const [deviceCode, setDeviceCode] = useState<MSAuthDeviceCode | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.getLauncherAccounts();
      setAccounts(data);
    } catch {
      toast.error("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startAuth = async () => {
    if (!isDesktop()) {
      toast.error("Authentication requires the desktop app");
      return;
    }

    setAuthPhase("requesting");
    setAuthError(null);

    try {
      const code = await window.electronAPI!.msAuthStart();
      setDeviceCode(code);
      setAuthPhase("awaiting");

      pollRef.current = setInterval(async () => {
        try {
          const status = await window.electronAPI!.msAuthPoll();

          if (status.status === "complete" && status.account) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;

            await api.createLauncherAccount({
              username: status.account.username,
              uuid: status.account.uuid,
              accountType: status.account.accountType,
            });

            setAuthPhase("success");
            toast.success(`Signed in as ${status.account.username}`);
            await fetchAccounts();
            onSelectAccount(status.account.id);

            setTimeout(() => {
              setAuthPhase("idle");
              setDeviceCode(null);
            }, 2000);
          } else if (status.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setAuthPhase("error");
            setAuthError("Code expired. Please try again.");
          } else if (status.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setAuthPhase("error");
            setAuthError(status.error ?? "Authentication failed");
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setAuthPhase("error");
          setAuthError("Lost connection during authentication");
        }
      }, 5000);
    } catch {
      setAuthPhase("error");
      setAuthError("Failed to start authentication");
    }
  };

  const removeAccount = async (account: LauncherAccount) => {
    try {
      if (isDesktop()) {
        try {
          await window.electronAPI!.removeAccount(account.uuid);
        } catch {
          /* noop */
        }
      }
      await api.deleteLauncherAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      toast.success(`Removed ${account.username}`);
    } catch {
      toast.error("Failed to remove account");
    }
  };

  const cancelAuth = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setAuthPhase("idle");
    setDeviceCode(null);
    setAuthError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Accounts
        </h3>
        <button
          onClick={startAuth}
          disabled={authPhase !== "idle" && authPhase !== "error"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "border border-zinc-700 bg-zinc-800 text-zinc-300",
            "hover:bg-zinc-700 hover:text-zinc-100",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Account
        </button>
      </div>

      {!isDesktop() && (
        <div className="flex items-start gap-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <p className="text-sm text-sky-300/80">
            Authentication requires the desktop app. Accounts added via the
            desktop client will appear here.
          </p>
        </div>
      )}

      {(authPhase === "awaiting" ||
        authPhase === "requesting" ||
        authPhase === "polling") &&
        deviceCode && (
          <DeviceCodeCard
            deviceCode={deviceCode}
            phase={authPhase}
            onCancel={cancelAuth}
          />
        )}

      {authPhase === "requesting" && !deviceCode && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          <span className="text-sm text-zinc-400">
            Starting authentication...
          </span>
        </div>
      )}

      {authPhase === "success" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-300">
            Signed in successfully
          </span>
        </div>
      )}

      {authPhase === "error" && authError && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-300">{authError}</span>
          </div>
          <button
            onClick={startAuth}
            className="text-sm font-medium text-red-400 transition-colors hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 py-8 text-center">
          <User className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-2 text-sm text-zinc-500">No accounts added yet</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccountId;
            return (
              <li key={account.id}>
                <button
                  onClick={() => onSelectAccount(account.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                    isSelected
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/60",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      isSelected ? "bg-emerald-500/20" : "bg-zinc-800",
                    )}
                  >
                    {isSelected ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <User className="h-4 w-4 text-zinc-500" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        isSelected ? "text-emerald-300" : "text-zinc-200",
                      )}
                    >
                      {account.username}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Last used {formatRelativeTime(account.lastUsed)}
                    </p>
                  </div>

                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    {account.accountType === "msa" ? "Microsoft" : "Legacy"}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAccount(account);
                    }}
                    className="rounded p-1.5 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title="Remove account"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface DeviceCodeCardProps {
  deviceCode: MSAuthDeviceCode;
  phase: AuthPhase;
  onCancel: () => void;
}

function DeviceCodeCard({ deviceCode, phase, onCancel }: DeviceCodeCardProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(deviceCode.userCode);
      setCopied(true);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy code");
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
      <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <p className="text-sm font-medium text-zinc-300">
          Sign in with Microsoft
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Enter this code at the link below
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 px-4 py-6">
        <button
          onClick={copyCode}
          className={cn(
            "rounded-lg border-2 border-dashed px-6 py-3 transition-colors",
            copied
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-zinc-700 bg-zinc-950 hover:border-zinc-600",
          )}
          title="Click to copy"
        >
          <span className="select-all font-mono text-2xl font-bold tracking-widest text-zinc-100">
            {deviceCode.userCode}
          </span>
        </button>

        <a
          href={deviceCode.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open microsoft.com/link
        </a>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {phase === "requesting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          <span>Waiting for sign-in...</span>
        </div>
      </div>

      <div className="border-t border-zinc-800 px-4 py-2.5">
        <button
          onClick={onCancel}
          className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
