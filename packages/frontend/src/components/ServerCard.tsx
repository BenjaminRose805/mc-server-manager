import { Link } from 'react-router';
import { Users, Clock, MemoryStick } from 'lucide-react';
import type { ServerWithStatus } from '@mc-server-manager/shared';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';

interface ServerCardProps {
  server: ServerWithStatus;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function serverTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function ServerCard({ server }: ServerCardProps) {
  const isOnline = server.status === 'running';

  return (
    <Link
      to={`/servers/${server.id}`}
      className={cn(
        'group block rounded-lg border bg-zinc-900 p-5 transition-colors',
        'hover:border-zinc-600 hover:bg-zinc-800/80',
        isOnline ? 'border-zinc-700' : 'border-zinc-800',
      )}
    >
      {/* Header: name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-100 group-hover:text-white">
            {server.name}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {serverTypeLabel(server.type)} {server.mcVersion} &middot; Port{' '}
            {server.port}
          </p>
        </div>
        <StatusBadge status={server.status} />
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {server.playerCount} player{server.playerCount !== 1 ? 's' : ''}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatUptime(server.uptime)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MemoryStick className="h-3.5 w-3.5" />
          {server.jvmArgs.match(/-Xmx(\S+)/)?.[1] || '--'}
        </span>
      </div>
    </Link>
  );
}
