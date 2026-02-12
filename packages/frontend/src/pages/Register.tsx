import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { register } from "@/api/auth";
import { useAuth } from "@/contexts/AuthContext";

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();

  const [inviteCode, setInviteCode] = useState(searchParams.get("code") ?? "");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);
  const displayNameValid =
    displayName.trim().length >= 1 && displayName.trim().length <= 50;
  const passwordValid = password.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inviteCode.trim()) {
      setError("Invite code is required.");
      return;
    }
    if (!usernameValid) {
      setError(
        "Username must be 3-20 characters (letters, numbers, underscore).",
      );
      return;
    }
    if (!displayNameValid) {
      setError("Display name must be 1-50 characters.");
      return;
    }
    if (!passwordValid) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const response = await register({
        inviteCode: inviteCode.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
      login(response);
      navigate("/");
    } catch (err: unknown) {
      let message = "Registration failed";
      if (err instanceof Error) {
        message = err.message;
      }
      if (err && typeof err === "object" && "code" in err) {
        const code = (err as { code?: string }).code;
        if (code === "INVITE_INVALID") message = "Invalid invite code.";
        else if (code === "INVITE_EXPIRED")
          message = "This invite code has expired.";
        else if (code === "INVITE_USED")
          message = "This invite code has already been used.";
      }
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="text-2xl font-bold text-zinc-100">Join Community</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Enter your invite code to create an account.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-200">
              Invite Code
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Enter your invite code"
              autoComplete="off"
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-200">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="my_username"
              autoComplete="username"
              className={`mt-1.5 w-full rounded-md border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1 ${
                username && !usernameValid
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                  : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500"
              }`}
            />
            <p className="mt-1 text-xs text-zinc-500">
              3-20 characters. Letters, numbers, and underscores only.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-200">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John"
              autoComplete="name"
              className={`mt-1.5 w-full rounded-md border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1 ${
                displayName && !displayNameValid
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                  : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500"
              }`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-200">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              className={`mt-1.5 w-full rounded-md border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:ring-1 ${
                password && !passwordValid
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                  : "border-zinc-700 focus:border-zinc-500 focus:ring-zinc-500"
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Joining..." : "Join Community"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-400">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-emerald-400 transition-colors hover:text-emerald-300"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
