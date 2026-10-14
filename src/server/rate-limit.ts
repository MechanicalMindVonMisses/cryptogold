// Per-visitor request limit for the public site. Keeps one client (or a script) from exhausting the
// FreeCryptoAPI and CoinGecko quotas the whole site shares. In-memory token buckets, per server process.

/** Burst size and sustained rate: 120 requests at once, refilling 2 per second (120 a minute). */
export const RATE_LIMIT = { capacity: 120, refillPerSecond: 2 } as const;
const MAX_TRACKED_CLIENTS = 10_000;

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

/**
 * The visitor's address. Behind Cloudflare Tunnel the server only listens on 127.0.0.1, so these
 * headers come from Cloudflare (or the machine's own user), not from arbitrary internet clients.
 */
export function clientKey(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "local"
  );
}

/** Takes one token; returns how many seconds to wait when the bucket is empty. */
export function takeToken(key: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.clear(); // crude bound; buckets refill anyway
    bucket = { tokens: RATE_LIMIT.capacity, updated: now };
    buckets.set(key, bucket);
  }
  const elapsedS = Math.max(0, (now - bucket.updated) / 1000);
  bucket.tokens = Math.min(
    RATE_LIMIT.capacity,
    bucket.tokens + elapsedS * RATE_LIMIT.refillPerSecond,
  );
  bucket.updated = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterS: 0 };
  }
  return { ok: false, retryAfterS: Math.ceil((1 - bucket.tokens) / RATE_LIMIT.refillPerSecond) };
}

/** A ready 429 response when the client is over its limit, otherwise null. */
export function rateLimitResponse(request: Request): Response | null {
  const { ok, retryAfterS } = takeToken(clientKey(request));
  if (ok) return null;
  return Response.json(
    { error: "rate_limited", source: "auratio" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterS) } },
  );
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
