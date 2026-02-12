import type { LauncherInstance } from "@mc-server-manager/shared";
import { InstanceCard } from "./InstanceCard";

interface InstanceGridProps {
  instances: LauncherInstance[];
  onPlay: (id: string) => void;
  onDelete: (id: string) => void;
}

export function InstanceGrid({
  instances,
  onPlay,
  onDelete,
}: InstanceGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {instances.map((instance) => (
        <InstanceCard
          key={instance.id}
          instance={instance}
          onPlay={onPlay}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
