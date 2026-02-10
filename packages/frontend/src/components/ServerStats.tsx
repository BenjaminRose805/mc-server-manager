import { Users, Clock, MemoryStick, Wifi } from 'lucide-react';
import type { ServerWithStatus } from '@mc-server-manager/shared';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// ServerStats — real-time status display: players, uptime, memory, port
// ---------------------------------------------------------------------------

interface ServerStatsProps {
  server: ServerWithStatus;
  className?: string;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseMemory(jvmArgs: string): string {
  const match = jvmArgs.match(/-Xmx(\S+)/);
  return match?.[1] || '--';
}

export function ServerStats({ server, className }: ServerStatsProps) {
  const isOnline = server.status === 'running';

  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      {/* Players */}
      <StatItem
        icon={Users}
        label="Players"
        value={
          isOnline
            ? `${server.playerCount}${server.players.length > 0 ? ` (${server.players.join(', ')})` : ''}`
            : '--'
        }
        highlight={server.playerCount > 0}
      />

      {/* Uptime */}
      <StatItem
        icon={Clock}
        label="Uptime"
        value={isOnline ? formatUptime(server.uptime) : '--'}
      />

      {/* Memory */}
      <StatItem
        icon={MemoryStick}
        label="Memory"
        value={parseMemory(server.jvmArgs)}
      />

      {/* Port */}
      <StatItem icon={Wifi} label="Port" value={String(server.port)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal stat item
// ---------------------------------------------------------------------------

interface StatItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  highlight?: boolean;
}

function StatItem({ icon: Icon, label, value, highlight }: StatItemProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          highlight ? 'text-emerald-400' : 'text-zinc-500',
        )}
      />
      <div className="flex flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <span
          className={cn(
            'text-sm font-medium',
            highlight ? 'text-emerald-300' : 'text-zinc-300',
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
