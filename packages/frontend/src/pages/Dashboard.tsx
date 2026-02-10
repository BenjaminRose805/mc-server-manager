import { useEffect } from 'react';
import { Link } from 'react-router';
import { Plus, Server, RefreshCw } from 'lucide-react';
import { useServerStore } from '@/stores/serverStore';
import { ServerCard } from '@/components/ServerCard';

export function Dashboard() {
  const { servers, loading, error, fetchServers } = useServerStore();

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {servers.length === 0
              ? 'Get started by creating your first Minecraft server.'
              : `Managing ${servers.length} server${servers.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchServers()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            to="/servers/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Create Server
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load servers: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && servers.length === 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[120px] animate-pulse rounded-lg border border-zinc-800 bg-zinc-900"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && servers.length === 0 && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 py-16">
          <div className="rounded-full bg-zinc-800 p-3">
            <Server className="h-8 w-8 text-zinc-500" />
          </div>
          <h3 className="mt-4 text-base font-medium text-zinc-300">
            No servers yet
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Create your first Minecraft server to get started.
          </p>
          <Link
            to="/servers/new"
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Create Server
          </Link>
        </div>
      )}

      {/* Server grid */}
      {servers.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
