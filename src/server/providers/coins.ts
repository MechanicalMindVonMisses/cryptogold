// Cached CoinGecko market data (identity, 24h change, fallback price) for the spot route.

import { cachedFetch, TTL } from "../cache/cache";
import { getMarkets } from "./coingecko";

/** Per-coin market data primed by the spot route; served from cache when CoinGecko fails. */
export const marketKey = (id: string) => `cg:market:${id}`;

/** Batched market data for a set of ids (cache key is order-independent). */
export async function getMarketsCached(ids: readonly string[]) {
  const key = `cg:markets:${[...ids].sort().join(",")}`;
  return cachedFetch(key, TTL.coinMeta, () => getMarkets(ids));
}
