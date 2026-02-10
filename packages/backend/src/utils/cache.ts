/**
 * Generic TTL cache utility.
 *
 * Provides a simple in-memory cache with time-to-live expiration.
 * Used by providers to cache version lists and other API responses.
 */

/** Default TTL: 10 minutes. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class TTLCache<T> {
  private data: T | null = null;
  private cachedAt = 0;
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get the cached value, or fetch a new one if expired.
   * @param fetcher - Async function to fetch fresh data
   */
  async get(fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.data !== null && now - this.cachedAt < this.ttlMs) {
      return this.data;
    }

    this.data = await fetcher();
    this.cachedAt = now;
    return this.data;
  }

  /**
   * Invalidate the cache, forcing a fresh fetch on next get().
   */
  invalidate(): void {
    this.data = null;
    this.cachedAt = 0;
  }
}
