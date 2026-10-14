// GoldProvider facade: XAUS first, PAXG proxy as fallback. Callers never talk to a gold source directly,
// so a source can be swapped here without touching routes or UI.

import { HOUR_MS } from "@/lib/ratio";
import { isLiveStale, LIVE_STALE_MS } from "@/lib/staleness";
import type { GoldSource, PricePoint, RangeKey } from "@/lib/types";
import { cachedFetch, TTL, type CachedResult } from "../cache/cache";
import { fetchPaxgSpot } from "./paxg";
import { fetchXausHistory, fetchXausSpot, XAUS_CHART_PARAMS, type GoldSpot } from "./xaus";

export interface Sourced<T> {
  data: T;
  source: GoldSource;
  stale: boolean;
}

export interface GoldProvider {
  getSpot(): Promise<Sourced<GoldSpot>>;
  getHistory(range: RangeKey): Promise<Sourced<PricePoint[]>>;
}

/**
 * Uses the primary result unless it failed, or it is a stale cached copy older than `maxPrimaryAgeMs`;
 * then tries the fallback. If both fail, a stale primary copy still beats an error.
 */
async function withFallback<T>(
  primary: () => Promise<CachedResult<T>>,
  fallback: () => Promise<CachedResult<T>>,
  maxPrimaryAgeMs: number,
): Promise<Sourced<T>> {
  let primaryResult: CachedResult<T> | null = null;
  let primaryError: unknown = null;
  try {
    primaryResult = await primary();
    if (!primaryResult.stale || Date.now() - primaryResult.storedAt < maxPrimaryAgeMs) {
      return { data: primaryResult.value, source: "xaus", stale: primaryResult.stale };
    }
  } catch (err) {
    primaryError = err;
  }
  try {
    const fb = await fallback();
    return { data: fb.value, source: "paxg", stale: fb.stale };
  } catch (fallbackError) {
    if (primaryResult) return { data: primaryResult.value, source: "xaus", stale: true };
    throw primaryError ?? fallbackError;
  }
}

export async function getGoldSpot(): Promise<Sourced<GoldSpot>> {
  const result = await withFallback(
    () => cachedFetch("xaus:spot", TTL.spot, fetchXausSpot),
    () => cachedFetch("paxg:spot", TTL.spot, fetchPaxgSpot),
    LIVE_STALE_MS,
  );
  return { ...result, stale: result.stale || result.data.stale || isLiveStale(result.data.asOf) };
}

/** XAUS gold closes, used only for gold's own 24h change (charts use recorded prices). */
export async function getGoldHistory(range: RangeKey): Promise<Sourced<PricePoint[]>> {
  const { range: xausRange, interval } = XAUS_CHART_PARAMS[range];
  const ttl = interval === "1h" ? TTL.hourlyHistory : TTL.dailyHistory;
  const result = await cachedFetch(`xaus:chart:${xausRange}:${interval}`, ttl, () =>
    fetchXausHistory(range),
  );
  return { data: result.value, source: "xaus", stale: result.stale };
}

/** Gold's own change (%) over the last 24 h from hourly closes, carrying the last close forward. */
export function goldChangeOver24h(points: readonly PricePoint[], now = Date.now()): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1];
  let base: PricePoint | undefined;
  for (const p of sorted) {
    if (p.t <= now - 24 * HOUR_MS) base = p;
    else break;
  }
  return base ? (last.usd / base.usd - 1) * 100 : null;
}

export async function getGoldChange24h(): Promise<number | null> {
  try {
    const history = await getGoldHistory("7d");
    return goldChangeOver24h(history.data);
  } catch {
    return null;
  }
}

export const goldProvider: GoldProvider = { getSpot: getGoldSpot, getHistory: getGoldHistory };
