export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const tauriModule = "@tauri-apps/api/core";
  const mod: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T>;
  } = await import(/* @vite-ignore */ tauriModule);
  return mod.invoke(cmd, args);
}

let resolvedBaseUrl: string | null = null;

export async function getBackendBaseUrl(): Promise<string> {
  if (resolvedBaseUrl) return resolvedBaseUrl;

  if (!isTauri()) {
    resolvedBaseUrl = "";
    return resolvedBaseUrl;
  }

  for (let i = 0; i < 60; i++) {
    try {
      const port = await tauriInvoke<number | null>("get_backend_port");
      if (port) {
        resolvedBaseUrl = `http://localhost:${port}`;
        return resolvedBaseUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  resolvedBaseUrl = "http://localhost:3001";
  return resolvedBaseUrl;
}

export function getBackendBaseUrlSync(): string {
  return resolvedBaseUrl ?? (isTauri() ? "http://localhost:3001" : "");
}
