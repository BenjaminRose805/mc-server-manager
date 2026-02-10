import { useState, useCallback, useEffect, useRef } from "react";
import { Trash2, AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeleteServerDialog — Modal confirmation with optional file deletion
// ---------------------------------------------------------------------------

interface DeleteServerDialogProps {
  serverName: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => Promise<void>;
}

export function DeleteServerDialog({
  serverName,
  open,
  onClose,
  onConfirm,
}: DeleteServerDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDeleteFiles(false);
      setDeleting(false);
      // Focus cancel button on open for safe default
      setTimeout(() => cancelRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, deleting, onClose]);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm(deleteFiles);
    } catch {
      // Error handling done by caller; just reset loading state
      setDeleting(false);
    }
  }, [deleteFiles, onConfirm]);

  if (!open) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={deleting ? undefined : onClose}
    >
      {/* Dialog */}
      <div
        className="relative mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={deleting}
          className="absolute right-3 top-3 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          {/* Icon + Title */}
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-red-500/10 p-2.5">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-zinc-100">
                Delete Server
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                Are you sure you want to delete{" "}
                <span className="font-medium text-zinc-200">{serverName}</span>?
                This will remove the server configuration from the manager.
              </p>
            </div>
          </div>

          {/* Delete files checkbox */}
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 transition-colors hover:border-zinc-600">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              disabled={deleting}
              className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-red-500 accent-red-500"
            />
            <div>
              <span className="text-sm font-medium text-zinc-200">
                Also delete server files from disk
              </span>
              <p className="mt-0.5 text-xs text-zinc-500">
                This will permanently remove the world data, configuration
                files, and server JAR. This cannot be undone.
              </p>
            </div>
          </label>

          {/* Warning when deleting files */}
          {deleteFiles && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                World data and all server files will be permanently deleted.
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              ref={cancelRef}
              onClick={onClose}
              disabled={deleting}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={deleting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                "border-red-600/50 bg-red-600/20 text-red-400",
                !deleting && "hover:bg-red-600/30 hover:text-red-300",
                deleting && "opacity-70 cursor-not-allowed",
              )}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deleting ? "Deleting..." : "Delete Server"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
