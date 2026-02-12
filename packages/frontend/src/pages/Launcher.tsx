import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Plus, Gamepad2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type {
  LauncherInstance,
  CreateInstanceRequest,
} from "@mc-server-manager/shared";
import { api } from "@/api/client";
import { InstanceGrid } from "@/components/launcher/InstanceGrid";
import { CreateInstanceWizard } from "@/components/launcher/CreateInstanceWizard";

export default function Launcher() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<LauncherInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateWizard, setShowCreateWizard] = useState(false);

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getLauncherInstances();
      setInstances(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load instances",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const handleCreate = async (data: CreateInstanceRequest) => {
    try {
      await api.createLauncherInstance(data);
      toast.success("Instance created!");
      setShowCreateWizard(false);
      fetchInstances();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create instance",
      );
    }
  };

  const handlePlay = (id: string) => {
    navigate(`/launcher/${id}`);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteLauncherInstance(id);
      toast.success("Instance deleted.");
      setInstances((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete instance",
      );
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Game Launcher</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {instances.length === 0
              ? "Create an instance to start playing Minecraft."
              : `${instances.length} instance${instances.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInstances}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateWizard(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            New Instance
          </button>
        </div>
      </div>

      {loading && instances.length === 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-[180px] animate-pulse rounded-lg border border-zinc-800 bg-zinc-900"
            />
          ))}
        </div>
      )}

      {!loading && instances.length === 0 && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 py-16">
          <div className="rounded-full bg-zinc-800 p-3">
            <Gamepad2 className="h-8 w-8 text-zinc-500" />
          </div>
          <h3 className="mt-4 text-base font-medium text-zinc-300">
            No instances yet
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Create one to get started.
          </p>
          <button
            onClick={() => setShowCreateWizard(true)}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            New Instance
          </button>
        </div>
      )}

      {instances.length > 0 && (
        <div className="mt-6">
          <InstanceGrid
            instances={instances}
            onPlay={handlePlay}
            onDelete={handleDelete}
          />
        </div>
      )}

      {showCreateWizard && (
        <CreateInstanceWizard
          onClose={() => setShowCreateWizard(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
