export async function waitForBackend(
  url: string = "http://localhost:3001/api/system/info",
  maxAttempts: number = 30,
  intervalMs: number = 500,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // expected: backend not listening yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Backend failed to start within timeout");
}
