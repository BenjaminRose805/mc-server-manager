export function isDesktop(): boolean {
  return typeof window !== "undefined" && "electronAPI" in window;
}

export async function getBackendBaseUrl(): Promise<string> {
  return isDesktop() ? "http://localhost:3001" : "";
}

export function getBackendBaseUrlSync(): string {
  return isDesktop() ? "http://localhost:3001" : "";
}
