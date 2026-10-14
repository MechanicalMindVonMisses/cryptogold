// Binance provider: last resort for the PAXG gold-proxy price when XAUS, FreeCryptoAPI and CoinGecko fail.
// No key needed.

import { z } from "zod";
import { ALT_BINANCE_BASE_URL, DEFAULT_BINANCE_BASE_URL, getConfig } from "../config";
import { fetchJson, UpstreamError } from "../http";

const SOURCE = "binance";

async function bnFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  const base = getConfig().binanceBaseUrl;
  try {
    return await fetchJson(`${base}${path}?${query}`, { source: SOURCE });
  } catch (err) {
    // Some networks block api.binance.com; the public market-data mirror serves the same endpoints.
    const unreachable =
      err instanceof UpstreamError && (err.kind === "network" || err.kind === "timeout");
    if (unreachable && base === DEFAULT_BINANCE_BASE_URL) {
      return fetchJson(`${ALT_BINANCE_BASE_URL}${path}?${query}`, { source: SOURCE });
    }
    throw err;
  }
}

const TickerSchema = z.object({ symbol: z.string(), price: z.string() });

export async function getTickerPrice(pair: string): Promise<number> {
  const parsed = TickerSchema.safeParse(await bnFetch("/api/v3/ticker/price", { symbol: pair }));
  const price = parsed.success ? Number(parsed.data.price) : NaN;
  if (!Number.isFinite(price) || price <= 0)
    throw new UpstreamError(SOURCE, null, false, "invalid");
  return price;
}
