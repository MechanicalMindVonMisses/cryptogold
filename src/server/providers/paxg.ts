// PAXG fallback gold provider. Each PAXG token is backed by one troy ounce of LBMA gold, so its
// price is a close proxy for spot gold. Used only when XAUS is unavailable, and always labelled.

import { UpstreamError } from "../http";
import { getTickerPrice } from "./binance";
import { getMarkets } from "./coingecko";
import { getLivePrices } from "./freecryptoapi";
import type { GoldSpot } from "./xaus";

export const PAXG_COINGECKO_ID = "pax-gold";
export const PAXG_BINANCE_PAIR = "PAXGUSDT";

export async function fetchPaxgSpot(): Promise<GoldSpot> {
  try {
    const live = (await getLivePrices(["PAXG"])).get("PAXG");
    if (live) return { usdPerOz: live.usd, asOf: live.asOf, stale: false };
  } catch {
    // fall through to CoinGecko, then Binance
  }
  try {
    const [market] = await getMarkets([PAXG_COINGECKO_ID]);
    if (!market) throw new UpstreamError("coingecko", null, false, "invalid");
    return { usdPerOz: market.usd, asOf: market.asOf, stale: false };
  } catch {
    const price = await getTickerPrice(PAXG_BINANCE_PAIR);
    return { usdPerOz: price, asOf: new Date().toISOString(), stale: false };
  }
}
