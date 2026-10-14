import { ratioChangeFromLegs } from "@/lib/ratio";
import type { CoinPriceSource, CoinSpotDto, SpotResponse } from "@/lib/types";
import { peekCache, primeCache, TTL } from "../cache/cache";
import { isRateLimited, UpstreamError } from "../http";
import type { CoinMarket } from "../providers/coingecko";
import { getMarketsCached, marketKey } from "../providers/coins";
import { getLivePricesCached } from "../providers/freecryptoapi";
import { getGoldChange24h, getGoldSpot } from "../providers/gold";
import { getStore } from "../store/price-store";

/**
 * A FreeCryptoAPI price is used for a coin only if it is within this fraction of CoinGecko's price
 * for the same CoinGecko id. Ticker symbols are not unique, so this stops a different coin that
 * shares the symbol from supplying the price.
 */
export const LIVE_PRICE_TOLERANCE = 0.25;

interface PricedCoin extends CoinMarket {
  priceSource: CoinPriceSource;
  /** The price came from a cached copy because its source failed. */
  stale: boolean;
}

interface CoinData {
  coins: PricedCoin[];
  /** CoinGecko (identity, 24h change) answered from cache because it is rate-limited. */
  rateLimited: boolean;
}

/**
 * Coin identity, 24h change and a fallback price from CoinGecko: one batched call, cached for 5 minutes.
 * If that fails, per-coin cached copies (kept up to 24 h) are used.
 */
async function getCoinMarkets(ids: readonly string[]): Promise<CoinData> {
  try {
    const result = await getMarketsCached(ids);
    if (!result.stale) for (const m of result.value) primeCache(marketKey(m.id), m, TTL.coinMeta);
    const rateLimited =
      result.stale &&
      result.error instanceof UpstreamError &&
      (result.error.rateLimited || isRateLimited("coingecko"));
    return {
      coins: result.value.map((m) => ({ ...m, priceSource: "coingecko", stale: result.stale })),
      rateLimited,
    };
  } catch (err) {
    const found: PricedCoin[] = [];
    for (const id of ids) {
      const cached = peekCache<CoinMarket>(marketKey(id));
      if (cached) found.push({ ...cached.value, priceSource: "coingecko", stale: true });
    }
    if (found.length === 0) throw err;
    return { coins: found, rateLimited: err instanceof UpstreamError && err.rateLimited };
  }
}

/** Replaces prices with FreeCryptoAPI's live prices where the symbol is verified. */
async function applyLivePrices(coins: PricedCoin[]): Promise<PricedCoin[]> {
  if (coins.length === 0) return coins;
  try {
    // Shared with the recorder: usually already fetched this minute, so this costs no request.
    const live = await getLivePricesCached(coins.map((c) => c.symbol));
    return coins.map((c) => {
      const p = live.get(c.symbol.toUpperCase());
      // A cached CoinGecko price (≤ 24 h old) is still fine for this collision check.
      if (!p || Math.abs(p.usd / c.usd - 1) > LIVE_PRICE_TOLERANCE) return c;
      return { ...c, usd: p.usd, asOf: p.asOf, priceSource: "freecryptoapi", stale: p.stale };
    });
  } catch {
    return coins; // CoinGecko prices remain as the fallback.
  }
}

/** Coins with a verified FreeCryptoAPI price get (or keep) a place in the recorder's list. */
function trackForRecording(coins: readonly PricedCoin[]): void {
  const verified = coins.filter((c) => c.priceSource === "freecryptoapi");
  if (verified.length === 0) return;
  try {
    getStore().trackCoins(verified.map((c) => ({ id: c.id, symbol: c.symbol })));
  } catch (err) {
    // Recording is best-effort; live prices must not fail because storage is unavailable.
    console.warn(
      "[auratio] could not register coins for recording:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function getSpot(ids: readonly string[]): Promise<SpotResponse> {
  const [gold, markets, goldChange24h] = await Promise.all([
    getGoldSpot(),
    getCoinMarkets(ids),
    getGoldChange24h(),
  ]);
  const priced = await applyLivePrices(markets.coins);
  trackForRecording(priced);
  const byId = new Map(priced.map((m) => [m.id, m]));
  const out: CoinSpotDto[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) {
      missing.push(id);
      continue;
    }
    out.push({
      id: m.id,
      symbol: m.symbol,
      name: m.name,
      image: m.image,
      rank: m.rank,
      usd: m.usd,
      change24h: m.change24h,
      ratioOz: m.usd / gold.data.usdPerOz,
      ratioChange24h:
        m.change24h !== null && goldChange24h !== null
          ? ratioChangeFromLegs(m.change24h, goldChange24h)
          : null,
      asOf: m.asOf,
      priceSource: m.priceSource,
    });
  }
  const notLive = priced.filter((c) => c.priceSource !== "freecryptoapi");
  return {
    gold: {
      usdPerOz: gold.data.usdPerOz,
      asOf: gold.data.asOf,
      source: gold.source,
      stale: gold.stale,
      change24h: goldChange24h,
    },
    coins: out,
    missing,
    coinsStale: priced.some((c) => c.stale),
    // Updates are only "paused" when a coin's price actually depends on the rate-limited source.
    rateLimited: markets.rateLimited && notLive.length > 0,
  };
}
