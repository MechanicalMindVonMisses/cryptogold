// In-memory TTL cache with LRU bounds, in-flight request coalescing and stale-if-error (PRD §7.5).

interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
}

export class TtlLruCache {
  private readonly map = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 500,
    /** Expired entries are kept this long so they can be served when the upstream fails. */
    private readonly maxStaleMs = 24 * 3_600_000,
  ) {}

  get(key: string, now = Date.now()): Entry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (now - entry.expiresAt > this.maxStaleMs) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, value: unknown, ttlMs: number, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export interface CachedResult<T> {
  value: T;
  /** True when served from an expired entry because the refresh failed. */
  stale: boolean;
  storedAt: number;
  /** The refresh error when `stale` is true. */
  error?: unknown;
}

interface CacheGlobals {
  cache: TtlLruCache;
  inflight: Map<string, Promise<CachedResult<unknown>>>;
}

// Survive module reloads in `next dev` so hot reloads don't burn upstream rate limits.
const g = globalThis as typeof globalThis & { __auratioCache?: CacheGlobals };
const state: CacheGlobals = (g.__auratioCache ??= {
  cache: new TtlLruCache(),
  inflight: new Map(),
});

/**
 * Returns a fresh cached value, or runs `fn` once for all concurrent callers of the same key.
 * When `fn` fails and an expired value exists, that value is returned with `stale: true`.
 */
export function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const entry = state.cache.get(key, now);
  if (entry && entry.expiresAt > now) {
    return Promise.resolve({ value: entry.value as T, stale: false, storedAt: entry.storedAt });
  }
  const pending = state.inflight.get(key);
  if (pending) return pending as Promise<CachedResult<T>>;

  const promise = (async (): Promise<CachedResult<T>> => {
    try {
      const value = await fn();
      const storedAt = Date.now();
      state.cache.set(key, value, ttlMs, storedAt);
      return { value, stale: false, storedAt };
    } catch (error) {
      const old = state.cache.get(key);
      if (old) return { value: old.value as T, stale: true, storedAt: old.storedAt, error };
      throw error;
    } finally {
      state.inflight.delete(key);
    }
  })();
  state.inflight.set(key, promise as Promise<CachedResult<unknown>>);
  return promise;
}

/** Stores a value produced elsewhere (e.g. one item of a batched response). */
export function primeCache(key: string, value: unknown, ttlMs: number): void {
  state.cache.set(key, value, ttlMs);
}

/** Reads a cached value without fetching; expired entries are returned with `stale: true`. */
export function peekCache<T>(key: string): CachedResult<T> | undefined {
  const entry = state.cache.get(key);
  if (!entry) return undefined;
  return {
    value: entry.value as T,
    stale: entry.expiresAt <= Date.now(),
    storedAt: entry.storedAt,
  };
}

export function clearCacheForTests(): void {
  state.cache.clear();
  state.inflight.clear();
}

export const TTL = {
  spot: 60_000,
  /** CoinGecko identity + 24h change; live prices come from FreeCryptoAPI every minute. */
  coinMeta: 5 * 60_000,
  hourlyHistory: 15 * 60_000,
  dailyHistory: 6 * 3_600_000,
  search: 24 * 3_600_000,
  catalogue: 24 * 3_600_000,
  fx: 12 * 3_600_000,
} as const;
