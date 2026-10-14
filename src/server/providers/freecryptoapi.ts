// FreeCryptoAPI provider: batched live coin prices by ticker symbol (prices come from Binance).
// The key is sent as a Bearer token and never leaves the server. History endpoints need a paid plan,
// so AuRatio records these live prices itself (see server/recorder.ts).

import { z } from "zod";
import { cachedFetch, peekCache, primeCache, TTL } from "../cache/cache";
import { getConfig } from "../config";
import { fetchJson, UpstreamError } from "../http";

export const FREECRYPTOAPI_BASE_URL = "https://api.freecryptoapi.com/v1";
const SOURCE = "freecryptoapi";
const SYMBOL_PATTERN = /^[A-Z0-9]{1,15}$/;
const MAX_SYMBOLS_PER_CALL = 50;

export interface LivePrice {
  usd: number;
  /** When we received the price. FreeCryptoAPI's own `date` field has no timezone, so it isn't used. */
  asOf: string;
}

const DataSchema = z.union([
  z.object({
    status: z.literal("success"),
    symbols: z.array(z.object({ symbol: z.string(), last: z.string() })),
  }),
  z.object({ status: z.literal(false), error: z.string().optional() }),
]);

/** Parses getData; unknown symbols are simply absent from the result. */
export function parseData(json: unknown, receivedAt = new Date()): Map<string, LivePrice> {
  const parsed = DataSchema.safeParse(json);
  if (!parsed.success) throw new UpstreamError(SOURCE, null, false, "invalid");
  if (parsed.data.status === false) {
    // e.g. "No access. Please upgrade your subscription" or a bad key: never forward the text.
    throw new UpstreamError(SOURCE, null, false, "http");
  }
  const out = new Map<string, LivePrice>();
  for (const s of parsed.data.symbols) {
    const usd = Number(s.last);
    if (Number.isFinite(usd) && usd > 0)
      out.set(s.symbol.toUpperCase(), { usd, asOf: receivedAt.toISOString() });
  }
  return out;
}

/** Live USD prices for ticker symbols, in as few requests as possible. Invalid symbols are skipped. */
interface Budget {
  day: number;
  used: number;
}
const budget: Budget = { day: -1, used: 0 };

/**
 * Counts FreeCryptoAPI requests per UTC day and refuses once the configured budget is spent, so a busy
 * public site can't exceed the plan's monthly quota. Refusals surface as a rate limit: live prices
 * fall back to CoinGecko and the recorder leaves a gap until the next UTC day.
 */
function spendBudget(now = Date.now()): void {
  const day = Math.floor(now / 86_400_000);
  if (budget.day !== day) {
    budget.day = day;
    budget.used = 0;
  }
  if (budget.used >= getConfig().freecryptoapiDailyBudget) {
    throw new UpstreamError(SOURCE, 429, true, "rate_limited");
  }
  budget.used += 1;
}

export function budgetUsedToday(): number {
  return budget.day === Math.floor(Date.now() / 86_400_000) ? budget.used : 0;
}

export function resetBudgetForTests(): void {
  budget.day = -1;
  budget.used = 0;
}

export async function getLivePrices(symbols: readonly string[]): Promise<Map<string, LivePrice>> {
  const valid = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) =>
    SYMBOL_PATTERN.test(s),
  );
  const { freecryptoapiKey } = getConfig();
  const out = new Map<string, LivePrice>();
  for (let i = 0; i < valid.length; i += MAX_SYMBOLS_PER_CALL) {
    const batch = valid.slice(i, i + MAX_SYMBOLS_PER_CALL);
    const query = new URLSearchParams({ symbol: batch.join(" ") }).toString(); // spaces encode as "+"
    spendBudget();
    const json = await fetchJson(`${FREECRYPTOAPI_BASE_URL}/getData?${query}`, {
      source: SOURCE,
      headers: { authorization: `Bearer ${freecryptoapiKey}` },
    });
    for (const [symbol, price] of parseData(json)) out.set(symbol, price);
  }
  return out;
}

export interface CachedLivePrice extends LivePrice {
  /** Served from an expired cache entry because FreeCryptoAPI could not be reached. */
  stale: boolean;
}

/**
 * Prices stay in the cache for 2 minutes. The dashboard accepts prices up to 90 s old, so between
 * recorder ticks (every 60 s) visitors are served without extra requests; the recorder asks for
 * younger prices so it fetches each tick.
 */
const PRICE_CACHE_MS = 2 * TTL.spot;
export const DEFAULT_MAX_AGE_MS = 90_000;

/** Symbols FreeCryptoAPI does not list are remembered for this long, so they never cost a call a minute. */
export const ABSENT_TTL_MS = 60 * 60_000;
const priceKey = (symbol: string) => `fca:price:${symbol}`;

/**
 * Live prices through a per-symbol cache shared by the recorder and the spot route: within a minute,
 * a symbol is fetched once no matter who asks. Only symbols without a fresh entry are requested, in
 * one batch. When FreeCryptoAPI fails, expired entries are returned flagged `stale`.
 *
 * `maxAgeMs` lets the recorder insist on a price fetched since its previous tick; otherwise a tick
 * landing just before the cache expiry would record the same price twice.
 */
export async function getLivePricesCached(
  symbols: readonly string[],
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<Map<string, CachedLivePrice>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) =>
    SYMBOL_PATTERN.test(s),
  );
  const out = new Map<string, CachedLivePrice>();
  const missing: string[] = [];
  const now = Date.now();
  for (const symbol of wanted) {
    const cached = peekCache<LivePrice | null>(priceKey(symbol));
    // Absent symbols keep their hour-long entry; prices must also be young enough for this caller.
    const fresh =
      cached && !cached.stale && (cached.value === null || now - cached.storedAt <= maxAgeMs);
    if (cached && fresh) {
      if (cached.value) out.set(symbol, { ...cached.value, stale: false });
    } else {
      missing.push(symbol);
    }
  }
  if (missing.length === 0) return out;

  try {
    // Coalesces identical concurrent batches (e.g. a recorder tick and a page load in the same moment).
    const batch = await cachedFetch(`fca:batch:${missing.join(",")}`, 5_000, () =>
      getLivePrices(missing),
    );
    if (batch.stale) throw batch.error;
    for (const symbol of missing) {
      const price = batch.value.get(symbol);
      if (price) {
        primeCache(priceKey(symbol), price, PRICE_CACHE_MS);
        out.set(symbol, { ...price, stale: false });
      } else {
        primeCache(priceKey(symbol), null, ABSENT_TTL_MS);
      }
    }
  } catch (err) {
    for (const symbol of missing) {
      const old = peekCache<LivePrice | null>(priceKey(symbol))?.value;
      if (old) out.set(symbol, { ...old, stale: true });
    }
    if (out.size === 0) throw err;
  }
  return out;
}
