// Shared domain types and API contracts. Pure types only: safe to import from client and server.

export type Unit = "oz" | "g";
export type RangeKey = "7d" | "1m" | "3m" | "6m" | "1y" | "5y" | "max";
/** "minute" is used only while a coin has under a few hours of recorded history. */
export type Granularity = "minute" | "hour" | "day";
export type GoldSource = "xaus" | "paxg";
/** History is recorded by this app from FreeCryptoAPI live prices. */
export type CoinSource = "freecryptoapi";
export type CoinPriceSource = "freecryptoapi" | "coingecko" | "binance";
export type DisplayCurrency = "USD" | "TRY";
export type ThemePref = "system" | "light" | "dark";

/** A single USD price observation. `t` is epoch milliseconds (UTC). */
export interface PricePoint {
  t: number;
  usd: number;
}

export interface AlignedPoint {
  t: number;
  coinUsd: number;
  goldUsdOz: number;
  /** True when the gold value was carried forward from an earlier close (weekend/holiday). */
  goldFilled: boolean;
}

export interface RatioPoint extends AlignedPoint {
  ratioOz: number;
}

export interface ValueAt {
  value: number;
  t: number;
}

export interface RatioStats {
  first: number;
  current: number;
  changePct: number;
  high: ValueAt;
  low: ValueAt;
  avg: number;
  ma30: number | null;
  ma90: number | null;
  /** Share of points (0–100) at or below the current value. */
  percentile: number;
  startT: number;
  endT: number;
  count: number;
}

// ---------- Internal API contracts (§9.3) ----------

export interface GoldSpotDto {
  usdPerOz: number;
  asOf: string;
  source: GoldSource;
  stale: boolean;
  /** Gold's own 24h change (%) from the hourly close series; null when unknown. */
  change24h: number | null;
}

export interface CoinSpotDto {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  usd: number;
  /** Coin's 24h change in USD (%). */
  change24h: number | null;
  ratioOz: number;
  /** 24h change of the coin/gold ratio (%). */
  ratioChange24h: number | null;
  asOf: string;
  /** Where the live price came from (FreeCryptoAPI normally; CoinGecko or Binance as fallbacks). */
  priceSource: CoinPriceSource;
}

export interface SpotResponse {
  gold: GoldSpotDto;
  coins: CoinSpotDto[];
  /** Requested ids the coin source did not return (delisted or unknown). */
  missing: string[];
  /** True when coin prices come from cache because the upstream is unavailable or rate-limited. */
  coinsStale: boolean;
  rateLimited: boolean;
}

export interface HistoryMeta {
  coinSource: CoinSource;
  /** "paxg" when any gold price in the window came from the PAXG fallback. */
  goldSource: GoldSource;
  /** First timestamp in the returned series (ms), or null when it is empty. */
  availableFrom: number | null;
  /** True when the recorded history is shorter than the requested range. */
  truncated: boolean;
  /** When recording of this coin started (ms), or null if nothing is recorded yet. */
  recordedFrom: number | null;
  /** Latest recorded coin price (ms), or null. */
  lastRecordedAt: number | null;
  /** No coin price recorded in the last 15 minutes although history exists (recorder stopped or failing). */
  recordingStale: boolean;
  /** No gold price recorded in the last 15 minutes. */
  goldStale: boolean;
  /** Latest recorded gold price (ms), or null. */
  goldLastT: number | null;
}

export interface HistoryResponse {
  id: string;
  range: RangeKey;
  granularity: Granularity;
  points: RatioPoint[];
  meta: HistoryMeta;
}

export interface SearchResult {
  id: string;
  symbol: string;
  name: string;
  thumb: string | null;
  rank: number | null;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface FxResponse {
  currency: "TRY";
  /** Units of `currency` per 1 USD. */
  rate: number;
  asOf: string;
  source: string;
  stale: boolean;
}

export interface ApiErrorBody {
  error: string;
  source: string;
}
