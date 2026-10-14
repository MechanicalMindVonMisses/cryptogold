// Test double for every upstream: serves recorded fixtures and synthetic, internally consistent data
// so providers, the recorder and route handlers can be exercised end to end without the network.

import cgMarkets from "./cg-markets.json";
import cgSearchSui from "./cg-search-sui.json";
import xausSpot from "./xaus-spot.json";
import xausSpotTry from "./xaus-spot-try.json";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type Host = "xaus" | "coingecko" | "binance" | "freecryptoapi";

export interface FakeUpstreamOptions {
  now: number;
  /** Force every request to a host to fail with this HTTP status (or "network"). */
  fail?: Partial<Record<Host, number | "network">>;
  /** Custom handlers checked before the defaults. Return undefined to fall through. */
  override?: (url: URL) => Response | undefined;
}

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

const KNOWN = new Map<string, { symbol: string; name: string; usd: number }>(
  cgMarkets.map((c) => [c.id, { symbol: c.symbol, name: c.name, usd: c.current_price }]),
);
KNOWN.set("pax-gold", { symbol: "paxg", name: "PAX Gold", usd: 4187.36 });
KNOWN.set("young-coin", { symbol: "yng", name: "Young Coin", usd: 0.5 });
KNOWN.set("solana", { symbol: "sol", name: "Solana", usd: 150 });

/** Symbols FreeCryptoAPI doesn't list (CoinGecko does). */
export const FCA_UNLISTED = new Set(["YNG"]);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const wave = (t: number, base: number) => base * (1 + 0.05 * Math.sin(t / (9 * DAY)));
const isWeekday = (t: number) => {
  const d = new Date(t).getUTCDay();
  return d !== 0 && d !== 6;
};

const RANGE_DAYS: Record<string, number> = { "1mo": 31, "3mo": 92, "6mo": 183, "1y": 365 };

/** XAUS chart: weekday-only closes (gold doesn't trade at weekends). */
function xausChart(url: URL, now: number) {
  const days = RANGE_DAYS[url.searchParams.get("range") ?? ""] ?? 365;
  const interval = url.searchParams.get("interval") ?? "1d";
  const points: { t: number; c: number }[] = [];
  const start = Math.floor((now - days * DAY) / DAY) * DAY;
  if (interval === "1h") {
    for (let t = start; t < now - HOUR; t += HOUR)
      if (isWeekday(t)) points.push({ t: t / 1000, c: wave(t, 4000) });
  } else {
    for (let t = start + 4 * HOUR; t < now; t += DAY)
      if (isWeekday(t)) points.push({ t: t / 1000, c: wave(t, 4000) });
  }
  return json({
    symbol: "xau",
    range: url.searchParams.get("range"),
    interval,
    currency: "USD",
    points,
  });
}

export function fakeUpstream(options: FakeUpstreamOptions) {
  const calls: RecordedCall[] = [];

  const handle = (url: URL): Response => {
    const host: Host | null = url.hostname.includes("xaus")
      ? "xaus"
      : url.hostname.includes("freecryptoapi")
        ? "freecryptoapi"
        : url.hostname.includes("coingecko")
          ? "coingecko"
          : url.hostname.includes("binance")
            ? "binance"
            : null;
    if (!host) return json({ error: "unexpected host" }, 599);
    const forced = options.fail?.[host];
    if (forced === "network") throw new TypeError("fetch failed");
    if (typeof forced === "number")
      return json({ error: "upstream secret detail", apiKey: "leaked?" }, forced);
    const custom = options.override?.(url);
    if (custom) return custom;

    const now = options.now;
    const path = url.pathname;
    if (host === "xaus") {
      if (path.endsWith("/spot")) {
        const body = url.searchParams.get("currency") === "TRY" ? xausSpotTry : xausSpot;
        return json({
          ...body,
          price_as_of: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        });
      }
      if (path.endsWith("/chart")) return xausChart(url, now);
    }
    if (host === "coingecko") {
      if (path.endsWith("/search")) return json(cgSearchSui);
      if (path.endsWith("/coins/markets")) {
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        const out = ids
          .filter((id) => KNOWN.has(id))
          .map((id) => {
            const c = KNOWN.get(id)!;
            const recorded = cgMarkets.find((m) => m.id === id);
            return {
              id,
              symbol: c.symbol,
              name: c.name,
              image: recorded?.image ?? null,
              market_cap_rank: recorded?.market_cap_rank ?? null,
              current_price: c.usd,
              price_change_percentage_24h: recorded?.price_change_percentage_24h ?? 0,
              last_updated: new Date(now).toISOString(),
            };
          });
        return json(out);
      }
    }
    if (host === "freecryptoapi" && path.endsWith("/getData")) {
      // Live prices a hair off CoinGecko's (different venue); unknown symbols are omitted.
      const wanted = (url.searchParams.get("symbol") ?? "").split(/[ +]/).filter(Boolean);
      const symbols = wanted.flatMap((sym) => {
        const coin = [...KNOWN.values()].find((c) => c.symbol.toUpperCase() === sym);
        if (!coin || FCA_UNLISTED.has(sym)) return [];
        return [
          {
            symbol: sym,
            last: String(coin.usd * 1.002),
            date: "2026-10-11 17:31:57",
            source_exchange: "binance",
          },
        ];
      });
      return json({ status: "success", symbols });
    }
    if (host === "binance" && path.endsWith("/ticker/price")) {
      const pair = url.searchParams.get("symbol") ?? "";
      const coin = [...KNOWN.values()].find((c) => `${c.symbol.toUpperCase()}USDT` === pair);
      if (!coin) return json({ code: -1121, msg: "Invalid symbol." }, 400);
      return json({ symbol: pair, price: String(coin.usd * 1.001) });
    }
    return json({ error: "not found" }, 404);
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: url.href, headers });
    return handle(url);
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}
