// XAUS gold provider: live spot (USD per troy ounce), TRY FX rate and hourly/daily history.
// Docs: https://xaus.com/api — free, no key; clients should cache ≥ 60 s.

import { z } from "zod";
import { HOUR_MS } from "@/lib/ratio";
import type { PricePoint, RangeKey } from "@/lib/types";
import { fetchJson, UpstreamError } from "../http";

export const XAUS_BASE_URL = "https://xaus.com/api/v1";
const SOURCE = "xaus";

export interface GoldSpot {
  usdPerOz: number;
  asOf: string;
  /** Upstream says the price is stale. */
  stale: boolean;
}

const SpotSchema = z.object({
  xau: z.object({ price: z.number().positive(), currency: z.string() }),
  spot_usd_oz: z.number().positive().optional(),
  fx_rate: z.number().positive().optional(),
  fx_source: z.string().optional(),
  fx_stale: z.boolean().optional(),
  price_as_of: z.string().optional(),
  updated_at: z.string().optional(),
  stale: z.boolean().optional(),
  data_state: z.object({ age_seconds: z.number().optional() }).optional(),
});

/** Seconds after which a live price counts as stale (PRD FR-12: 15 minutes). */
const LIVE_STALE_SECONDS = 15 * 60;

function parseOrThrow<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new UpstreamError(SOURCE, null, false, "invalid");
  return parsed.data;
}

export function parseXausSpot(json: unknown): GoldSpot {
  const data = parseOrThrow(SpotSchema, json);
  const usdPerOz = data.xau.currency === "USD" ? data.xau.price : data.spot_usd_oz;
  if (usdPerOz === undefined) throw new UpstreamError(SOURCE, null, false, "invalid");
  // XAUS sets `stale` whenever it answers from its own cache, even seconds-old data, so staleness is
  // judged by age instead (the facade also checks `asOf`).
  const age = data.data_state?.age_seconds;
  return {
    usdPerOz,
    asOf: data.price_as_of ?? data.updated_at ?? new Date().toISOString(),
    stale: age !== undefined && age > LIVE_STALE_SECONDS,
  };
}

export async function fetchXausSpot(): Promise<GoldSpot> {
  return parseXausSpot(
    await fetchJson(`${XAUS_BASE_URL}/spot?unit=oz&currency=USD&compact=1`, { source: SOURCE }),
  );
}

export interface FxRate {
  rate: number;
  asOf: string;
  source: string;
  stale: boolean;
}

export function parseXausFx(json: unknown): FxRate {
  const data = parseOrThrow(SpotSchema, json);
  if (data.fx_rate === undefined) throw new UpstreamError(SOURCE, null, false, "invalid");
  return {
    rate: data.fx_rate,
    asOf: data.updated_at ?? data.price_as_of ?? new Date().toISOString(),
    source: data.fx_source ?? "xaus.com",
    stale: data.fx_stale ?? false,
  };
}

export async function fetchXausFx(currency: "TRY"): Promise<FxRate> {
  return parseXausFx(
    await fetchJson(`${XAUS_BASE_URL}/spot?unit=oz&currency=${currency}&compact=1`, {
      source: SOURCE,
    }),
  );
}

const ChartSchema = z.object({
  interval: z.string(),
  points: z.array(z.object({ t: z.number(), c: z.number() })),
});

type XausInterval = "1h" | "1d";

/**
 * XAUS chart parameters per app range. Hourly ranges share one 3-month hourly series so a window
 * that opens on a weekend still has the preceding Friday close to carry forward.
 * "max" uses 10 years of daily closes (XAUS "max" is monthly).
 */
export const XAUS_CHART_PARAMS: Record<RangeKey, { range: string; interval: XausInterval }> = {
  "7d": { range: "3mo", interval: "1h" },
  "1m": { range: "3mo", interval: "1h" },
  "3m": { range: "3mo", interval: "1d" },
  "6m": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1d" },
  max: { range: "10y", interval: "1d" },
};

/**
 * Normalises XAUS bars to price observations.
 * Hourly bars are stamped at their open, so the close is observed one hour later; a bar stamped
 * off the hour (the session-close snapshot, e.g. 20:59:59) is observed at that instant.
 * Daily bars (stamped 04:00 UTC) keep their timestamp: the UTC date is the trading day.
 */
export function parseXausChart(json: unknown): PricePoint[] {
  const data = parseOrThrow(ChartSchema, json);
  const hourly = data.interval === "1h";
  return data.points
    .filter((p) => Number.isFinite(p.c) && p.c > 0)
    .map((p) => {
      const ms = p.t * 1000;
      const t = hourly ? (ms % HOUR_MS === 0 ? ms + HOUR_MS : ms + 1000) : ms;
      return { t, usd: p.c };
    });
}

export async function fetchXausHistory(range: RangeKey): Promise<PricePoint[]> {
  const { range: r, interval } = XAUS_CHART_PARAMS[range];
  return parseXausChart(
    await fetchJson(`${XAUS_BASE_URL}/chart?symbol=xau&range=${r}&interval=${interval}`, {
      source: SOURCE,
    }),
  );
}
