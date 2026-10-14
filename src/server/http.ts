// Resilient JSON fetching for upstream providers: timeouts, retries with exponential backoff,
// Retry-After handling and a per-source rate-limit breaker. Errors never carry upstream bodies.

export type UpstreamErrorKind =
  "http" | "timeout" | "network" | "parse" | "rate_limited" | "invalid";

export class UpstreamError extends Error {
  constructor(
    readonly source: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly kind: UpstreamErrorKind,
  ) {
    super(`${source} request failed (${kind}${status === null ? "" : ` ${status}`})`);
    this.name = "UpstreamError";
  }

  get rateLimited(): boolean {
    return this.kind === "rate_limited";
  }
}

export const MAX_BACKOFF_MS = 30_000;

/** 1 s, 2 s, 4 s, … capped at 30 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

interface BreakerState {
  until: number;
  consecutive: number;
}

const breakers = new Map<string, BreakerState>();

/** Records a 429 and opens the breaker for the source: max(Retry-After, exponential backoff). */
function tripBreaker(source: string, retryAfterMs: number | null): number {
  const prev = breakers.get(source);
  const consecutive = (prev?.consecutive ?? 0) + 1;
  const wait = Math.min(Math.max(retryAfterMs ?? 0, backoffDelay(consecutive - 1)), 5 * 60_000);
  breakers.set(source, { until: Date.now() + wait, consecutive });
  return wait;
}

export function isRateLimited(source: string): boolean {
  const b = breakers.get(source);
  return b !== undefined && b.until > Date.now();
}

export function resetBreakersForTests(): void {
  breakers.clear();
}

export interface FetchJsonOptions {
  source: string;
  headers?: Record<string, string>;
  /** Per-attempt timeout. Default 8 s. */
  timeoutMs?: number;
  /** Additional attempts after the first. Default 2. */
  retries?: number;
  /** A 429 is retried in-request only when Retry-After is at most this long. Default 5 s. */
  maxRetryAfterMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleepImpl = defaultSleep;

/** Lets integration tests skip real backoff waits. */
export function setSleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  sleepImpl = fn ?? defaultSleep;
}

export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const { source, headers, timeoutMs = 8_000, retries = 2, maxRetryAfterMs = 5_000 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? sleepImpl;

  if (isRateLimited(source)) throw new UpstreamError(source, 429, true, "rate_limited");

  let lastError: UpstreamError = new UpstreamError(source, null, true, "network");
  let delay = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (delay > 0) await sleep(delay);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { accept: "application/json", ...headers },
          signal: controller.signal,
          cache: "no-store",
        });
      } catch {
        lastError = new UpstreamError(
          source,
          null,
          true,
          controller.signal.aborted ? "timeout" : "network",
        );
        delay = backoffDelay(attempt);
        continue;
      }

      if (res.ok) {
        try {
          const body = await res.json();
          breakers.delete(source);
          return body;
        } catch {
          throw new UpstreamError(
            source,
            res.status,
            false,
            controller.signal.aborted ? "timeout" : "parse",
          );
        }
      }

      // Never read or forward the upstream error body.
      await res.body?.cancel().catch(() => undefined);

      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const wait = tripBreaker(source, retryAfter);
        lastError = new UpstreamError(source, 429, true, "rate_limited");
        // The breaker stays open for other callers; this loop retries once the wait is over.
        if (attempt < retries && wait <= maxRetryAfterMs) {
          delay = wait;
          continue;
        }
        throw lastError;
      }
      if (res.status >= 500) {
        lastError = new UpstreamError(source, res.status, true, "http");
        delay = backoffDelay(attempt);
        continue;
      }
      throw new UpstreamError(source, res.status, false, "http");
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
