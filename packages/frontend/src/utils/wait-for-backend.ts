import { getBackendBaseUrl } from "./desktop";

export async function waitForBackend(
  maxAttempts: number = 60,
  intervalMs: number = 500,
): Promise<void> {
  const base = await getBackendBaseUrl();
  const url = `${base}/api/system/info`;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Backend failed to start within timeout");
}
