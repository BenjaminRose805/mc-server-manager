import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Copy,
  Trash2,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getUsers, updateUserRole, deleteUser } from "@/api/users";
import {
  createInvitation,
  getInvitations,
  deleteInvitation,
} from "@/api/invitations";
import type { User, Invitation, UserRole } from "@mc-server-manager/shared";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function expiresInToDate(expiresIn: string): string {
  const match = expiresIn.match(/^(\d+)([dhm])$/);
  if (!match) return new Date(Date.now() + 7 * 86400000).toISOString();
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms =
    unit === "d"
      ? value * 86400000
      : unit === "h"
        ? value * 3600000
        : value * 60000;
  return new Date(Date.now() + ms).toISOString();
}

const EXPIRES_OPTIONS = [
  { label: "1 hour", value: "1h" },
  { label: "12 hours", value: "12h" },
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
];

function RoleBadge({ role }: { role: UserRole }) {
  if (role === "owner") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
        <ShieldCheck className="h-3 w-3" />
        Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
        <Shield className="h-3 w-3" />
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-700/50 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
      Member
    </span>
  );
}

export default function Admin() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteExpiresIn, setInviteExpiresIn] = useState("7d");

  useEffect(() => {
    loadUsers();
    loadInvitations();
  }, []);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadInvitations() {
    setLoadingInvitations(true);
    try {
      const data = await getInvitations();
      setInvitations(data);
    } catch {
      toast.error("Failed to load invitations");
    } finally {
      setLoadingInvitations(false);
    }
  }

  async function handleRoleChange(userId: string, role: "admin" | "member") {
    try {
      const updated = await updateUserRole(userId, role);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      toast.success("Role updated");
    } catch {
      toast.error("Failed to update role");
    }
  }

  async function handleDeleteUser(userId: string, username: string) {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`))
      return;
    try {
      await deleteUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch {
      toast.error("Failed to delete user");
    }
  }

  async function handleCreateInvitation() {
    setCreating(true);
    try {
      const inv = await createInvitation({
        role: inviteRole,
        maxUses: inviteMaxUses,
        expiresAt: expiresInToDate(inviteExpiresIn),
      });
      setInvitations((prev) => [inv, ...prev]);
      setShowCreateForm(false);
      setInviteRole("member");
      setInviteMaxUses(1);
      setInviteExpiresIn("7d");
      toast.success("Invitation created");
    } catch {
      toast.error("Failed to create invitation");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteInvitation(id: string) {
    if (!window.confirm("Delete this invitation code?")) return;
    try {
      await deleteInvitation(id);
      setInvitations((prev) => prev.filter((i) => i.id !== id));
      toast.success("Invitation deleted");
    } catch {
      toast.error("Failed to delete invitation");
    }
  }

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied!");
    } catch {
      toast.error("Failed to copy code");
    }
  }

  const isOwnerOrAdmin =
    currentUser?.role === "owner" || currentUser?.role === "admin";

  if (!isOwnerOrAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Shield className="h-12 w-12 text-zinc-600" />
        <h2 className="mt-4 text-lg font-medium text-zinc-300">
          Access Denied
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          You need admin privileges to view this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Admin</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Manage users and invitation codes.
        </p>
      </div>

      <div className="mt-8">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-zinc-100">Users</h3>
          {!loadingUsers && (
            <span className="inline-flex items-center rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
              {users.length}
            </span>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Username
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Display Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="transition-colors hover:bg-zinc-800/30"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-zinc-100">
                        {u.username}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {u.displayName || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {u.role === "owner" ? (
                          <RoleBadge role="owner" />
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              handleRoleChange(
                                u.id,
                                e.target.value as "admin" | "member",
                              )
                            }
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.isActive ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-400">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.role !== "owner" && (
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-zinc-100">Invitations</h3>
            {!loadingInvitations && (
              <span className="inline-flex items-center rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                {invitations.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            {showCreateForm ? (
              <>
                <X className="h-4 w-4" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Create Invite
              </>
            )}
          </button>
        </div>

        {showCreateForm && (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "admin" | "member")
                  }
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Max Uses
                </label>
                <input
                  type="number"
                  min={0}
                  value={inviteMaxUses}
                  onChange={(e) =>
                    setInviteMaxUses(parseInt(e.target.value, 10) || 0)
                  }
                  className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="0 = unlimited"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Expires In
                </label>
                <select
                  value={inviteExpiresIn}
                  onChange={(e) => setInviteExpiresIn(e.target.value)}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {EXPIRES_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleCreateInvitation}
                disabled={creating}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Set max uses to 0 for unlimited. The invite code will be shown
              after creation.
            </p>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900">
          {loadingInvitations ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-500" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Users className="h-8 w-8 text-zinc-600" />
              <p className="mt-2 text-sm text-zinc-500">
                No invitation codes yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Code
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Uses
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Expires
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {invitations.map((inv) => (
                    <tr
                      key={inv.id}
                      className="transition-colors hover:bg-zinc-800/30"
                    >
                      <td className="px-4 py-3 font-mono text-sm text-zinc-100">
                        {inv.code}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {inv.uses}/{inv.maxUses === 0 ? "∞" : inv.maxUses}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={inv.role} />
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {formatDate(inv.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleCopyCode(inv.code)}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                            title="Copy code"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteInvitation(inv.id)}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                            title="Delete invitation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
