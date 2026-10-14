import type { FxResponse, SearchResponse } from "@/lib/types";
import { cachedFetch, TTL } from "../cache/cache";
import { searchCoins } from "../providers/coingecko";
import { fetchXausFx } from "../providers/xaus";

export async function search(query: string): Promise<SearchResponse> {
  const q = query.trim().toLowerCase();
  const result = await cachedFetch(`cg:search:${q}`, TTL.search, () => searchCoins(q));
  return { results: result.value };
}

export async function getFx(currency: "TRY"): Promise<FxResponse> {
  const result = await cachedFetch(`xaus:fx:${currency}`, TTL.fx, () => fetchXausFx(currency));
  return {
    currency,
    rate: result.value.rate,
    asOf: result.value.asOf,
    source: result.value.source,
    stale: result.stale || result.value.stale,
  };
}
