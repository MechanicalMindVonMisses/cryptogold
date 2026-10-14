// CoinGecko provider: search and coin identity (names, icons, 24h change; fallback prices).
// An optional Demo key is sent as `x-cg-demo-api-key` and never leaves the server; without one the
// keyless public API is used.

import { z } from "zod";
import type { SearchResult } from "@/lib/types";
import { getConfig } from "../config";
import { fetchJson, UpstreamError } from "../http";

export const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const SOURCE = "coingecko";

let keyRejected = false;

export function resetCoingeckoForTests(): void {
  keyRejected = false;
}

async function cgFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${COINGECKO_BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
  const { coingeckoApiKey } = getConfig();
  if (!coingeckoApiKey || keyRejected) return fetchJson(url, { source: SOURCE });
  try {
    return await fetchJson(url, {
      source: SOURCE,
      headers: { "x-cg-demo-api-key": coingeckoApiKey },
    });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 401) {
      keyRejected = true;
      console.warn(
        "[auratio] CoinGecko rejected COINGECKO_DEMO_API_KEY (401). Continuing on the keyless public API " +
          "with lower rate limits; check the key in .env.local.",
      );
      return fetchJson(url, { source: SOURCE });
    }
    throw err;
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new UpstreamError(SOURCE, null, false, "invalid");
  return parsed.data;
}

// ---------- /search ----------

const SearchSchema = z.object({
  coins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      symbol: z.string(),
      market_cap_rank: z.number().nullable().optional(),
      thumb: z.string().nullable().optional(),
    }),
  ),
});

export const SEARCH_LIMIT = 10;

function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseSearch(json: unknown): SearchResult[] {
  return parseOrThrow(SearchSchema, json)
    .coins.slice(0, SEARCH_LIMIT)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      thumb: safeImageUrl(c.thumb),
      rank: c.market_cap_rank ?? null,
    }));
}

export async function searchCoins(query: string): Promise<SearchResult[]> {
  return parseSearch(await cgFetch("/search", { query }));
}

// ---------- /coins/markets (batched spot with metadata) ----------

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  usd: number;
  change24h: number | null;
  asOf: string;
}

const MarketsSchema = z.array(
  z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string(),
    image: z.string().nullable().optional(),
    market_cap_rank: z.number().nullable().optional(),
    current_price: z.number().nullable(),
    price_change_percentage_24h: z.number().nullable().optional(),
    last_updated: z.string().nullable().optional(),
  }),
);

export function parseMarkets(json: unknown): CoinMarket[] {
  return parseOrThrow(MarketsSchema, json)
    .filter((c) => c.current_price !== null && c.current_price > 0)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      image: safeImageUrl(c.image),
      rank: c.market_cap_rank ?? null,
      usd: c.current_price as number,
      change24h: c.price_change_percentage_24h ?? null,
      asOf: c.last_updated ?? new Date().toISOString(),
    }));
}

/** One call for the whole watchlist (≤ 250 ids). */
export async function getMarkets(ids: readonly string[]): Promise<CoinMarket[]> {
  return parseMarkets(
    await cgFetch("/coins/markets", {
      vs_currency: "usd",
      ids: ids.join(","),
      per_page: "250",
      page: "1",
      price_change_percentage: "24h",
    }),
  );
}
