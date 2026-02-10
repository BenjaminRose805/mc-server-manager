import type { ServerStatus } from '@mc-server-manager/shared';
import { cn } from '@/lib/utils';

const statusConfig: Record<
  ServerStatus,
  { label: string; dotClass: string; textClass: string; bgClass: string }
> = {
  running: {
    label: 'Running',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-400/10 border-emerald-400/20',
  },
  starting: {
    label: 'Starting',
    dotClass: 'bg-amber-400 animate-pulse',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-400/10 border-amber-400/20',
  },
  stopping: {
    label: 'Stopping',
    dotClass: 'bg-amber-400 animate-pulse',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-400/10 border-amber-400/20',
  },
  stopped: {
    label: 'Stopped',
    dotClass: 'bg-zinc-500',
    textClass: 'text-zinc-400',
    bgClass: 'bg-zinc-400/10 border-zinc-400/20',
  },
  crashed: {
    label: 'Crashed',
    dotClass: 'bg-red-400',
    textClass: 'text-red-400',
    bgClass: 'bg-red-400/10 border-red-400/20',
  },
  provisioning: {
    label: 'Provisioning',
    dotClass: 'bg-blue-400 animate-pulse',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-400/10 border-blue-400/20',
  },
};

interface StatusBadgeProps {
  status: ServerStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.bgClass,
        config.textClass,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  );
}
