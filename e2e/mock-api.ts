// Deterministic stand-in for the app's /api routes so E2E tests never depend on live markets.

import type { Page, Route } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const GOLD = 4195.6;

interface MockCoin {
  symbol: string;
  name: string;
  usd: number;
  change24h: number;
  /** How many days AuRatio has recorded for this coin (0 = nothing yet). */
  recordedDays: number;
}

export const COINS: Record<string, MockCoin> = {
  bitcoin: { symbol: "BTC", name: "Bitcoin", usd: 83_039, change24h: 2.1, recordedDays: 2500 },
  ethereum: { symbol: "ETH", name: "Ethereum", usd: 2503.04, change24h: 0.2, recordedDays: 2500 },
  sui: { symbol: "SUI", name: "Sui", usd: 1.1, change24h: -1.1, recordedDays: 2500 },
  solana: { symbol: "SOL", name: "Solana", usd: 150, change24h: 3.4, recordedDays: 20 },
  "new-coin": { symbol: "NEW", name: "New Coin", usd: 2, change24h: 0, recordedDays: 0 },
};

const RANGE_DAYS: Record<string, number | null> = {
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "5y": 1826,
  max: null,
};

const RANGE_POINTS: Record<string, { n: number; step: number; granularity: "hour" | "day" }> = {
  "7d": { n: 168, step: HOUR, granularity: "hour" },
  "1m": { n: 720, step: HOUR, granularity: "hour" },
  "3m": { n: 91, step: DAY, granularity: "day" },
  "6m": { n: 181, step: DAY, granularity: "day" },
  "1y": { n: 365, step: DAY, granularity: "day" },
  "5y": { n: 2000, step: DAY, granularity: "day" },
  max: { n: 2500, step: DAY, granularity: "day" },
};

export interface MockOptions {
  goldSource?: "xaus" | "paxg";
  /** HTTP status for /api/spot (e.g. 502). */
  spotStatus?: number;
  rateLimited?: boolean;
}

export interface MockHandle {
  requests: string[];
  set(options: MockOptions): void;
}

function history(id: string, range: string, now: number, goldSource: string) {
  const coin = COINS[id];
  const spec = RANGE_POINTS[range];
  // Only what has been recorded exists.
  const n = Math.min(spec.n, Math.floor((coin.recordedDays * DAY) / spec.step));
  const lastBucket = Math.floor(now / spec.step) * spec.step;
  const target = coin.usd / GOLD;
  const points = Array.from({ length: n }, (_, i) => {
    const t = lastBucket - (n - 1 - i) * spec.step;
    // Ends exactly at the live ratio; earlier points wander deterministically.
    const k = (n - 1 - i) / n;
    const ratioOz = target * (1 + 0.25 * k * Math.sin(i / 17) + 0.1 * k);
    return { t, coinUsd: ratioOz * GOLD, goldUsdOz: GOLD, ratioOz, goldFilled: false };
  });
  const days = RANGE_DAYS[range];
  const recordedFrom = coin.recordedDays > 0 ? now - coin.recordedDays * DAY : null;
  return {
    id,
    range,
    granularity: spec.granularity,
    points,
    meta: {
      coinSource: "freecryptoapi",
      goldSource,
      availableFrom: points[0]?.t ?? null,
      truncated: days !== null && coin.recordedDays < days,
      recordedFrom,
      lastRecordedAt: recordedFrom === null ? null : now,
      recordingStale: false,
      goldStale: false,
      goldLastT: now,
    },
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function mockApi(page: Page, initial: MockOptions = {}): Promise<MockHandle> {
  let options: MockOptions = { ...initial };
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    const now = Date.now();
    const goldSource = options.goldSource ?? "xaus";
    switch (url.pathname) {
      case "/api/spot": {
        if (options.spotStatus && options.spotStatus >= 400) {
          return json(
            route,
            { error: "upstream_unavailable", source: "coingecko" },
            options.spotStatus,
          );
        }
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        const known = ids.filter((id) => COINS[id]);
        return json(route, {
          gold: {
            usdPerOz: GOLD,
            asOf: new Date(now).toISOString(),
            source: goldSource,
            stale: false,
            change24h: 0,
          },
          coins: known.map((id) => ({
            id,
            symbol: COINS[id].symbol,
            name: COINS[id].name,
            image: null,
            rank: 1,
            usd: COINS[id].usd,
            change24h: COINS[id].change24h,
            ratioOz: COINS[id].usd / GOLD,
            ratioChange24h: COINS[id].change24h,
            asOf: new Date(now).toISOString(),
            priceSource: "freecryptoapi",
          })),
          missing: ids.filter((id) => !COINS[id]),
          coinsStale: !!options.rateLimited,
          rateLimited: !!options.rateLimited,
        });
      }
      case "/api/history": {
        const id = url.searchParams.get("id") ?? "";
        const range = url.searchParams.get("range") ?? "";
        if (!COINS[id] || !RANGE_POINTS[range])
          return json(route, { error: "not_found", source: "coingecko" }, 404);
        return json(route, history(id, range, now, goldSource));
      }
      case "/api/search": {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const results = Object.entries(COINS)
          .filter(([id, c]) => id.startsWith(q) || c.symbol.toLowerCase().startsWith(q))
          .map(([id, c], i) => ({ id, symbol: c.symbol, name: c.name, thumb: null, rank: i + 1 }));
        return json(route, { results });
      }
      case "/api/fx":
        return json(route, {
          currency: "TRY",
          rate: 49.333088,
          asOf: new Date(now).toISOString(),
          source: "open.er-api.com",
          stale: false,
        });
      default:
        return json(route, { error: "not_found", source: "request" }, 404);
    }
  });
  return {
    requests,
    set(next) {
      options = { ...options, ...next };
    },
  };
}

export const apiCalls = (handle: MockHandle, path: string) =>
  handle.requests.filter((r) => r.startsWith(path));
