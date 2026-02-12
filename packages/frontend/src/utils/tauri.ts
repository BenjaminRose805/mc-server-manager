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
