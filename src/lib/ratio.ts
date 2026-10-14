// Pure ratio engine: alignment, forward-fill, unit conversion and statistics.
// No React, no network. Every function is deterministic and unit-tested.

import type {
  AlignedPoint,
  Granularity,
  PricePoint,
  RatioPoint,
  RatioStats,
  Unit,
  ValueAt,
} from "./types";

export const GRAMS_PER_TROY_OUNCE = 31.1034768;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function bucketSize(granularity: Granularity): number {
  return granularity === "minute" ? MINUTE_MS : granularity === "hour" ? HOUR_MS : DAY_MS;
}

/** Start of the UTC minute, hour or day containing `t`. */
export function bucketStart(t: number, granularity: Granularity): number {
  const size = bucketSize(granularity);
  return Math.floor(t / size) * size;
}

/**
 * Buckets points by UTC hour/day. When several points share a bucket the latest observation wins.
 * Non-finite or non-positive prices are discarded.
 */
export function bucketize(points: readonly PricePoint[], granularity: Granularity): PricePoint[] {
  const sorted = points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.usd) && p.usd > 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  const byBucket = new Map<number, number>();
  for (const p of sorted) byBucket.set(bucketStart(p.t, granularity), p.usd);
  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([t, usd]) => ({ t, usd }));
}

/**
 * Aligns a coin series with a gold series on UTC buckets (PRD §7.3).
 * Gold is forward-filled from the last available close for buckets without a gold print
 * (weekends, holidays) and flagged `goldFilled`. Coin points with no gold at or before them are dropped.
 */
export function alignSeries(
  coin: readonly PricePoint[],
  gold: readonly PricePoint[],
  granularity: Granularity,
): AlignedPoint[] {
  const c = bucketize(coin, granularity);
  const g = bucketize(gold, granularity);
  const out: AlignedPoint[] = [];
  let j = -1;
  for (const p of c) {
    while (j + 1 < g.length && g[j + 1].t <= p.t) j++;
    if (j < 0) continue;
    const gp = g[j];
    out.push({ t: p.t, coinUsd: p.usd, goldUsdOz: gp.usd, goldFilled: gp.t !== p.t });
  }
  return out;
}

export function toRatio(points: readonly AlignedPoint[]): RatioPoint[] {
  return points.map((p) => ({ ...p, ratioOz: p.coinUsd / p.goldUsdOz }));
}

export function buildRatioSeries(
  coin: readonly PricePoint[],
  gold: readonly PricePoint[],
  granularity: Granularity,
): RatioPoint[] {
  return toRatio(alignSeries(coin, gold, granularity));
}

export function ozToGram(ratioOz: number): number {
  return ratioOz * GRAMS_PER_TROY_OUNCE;
}

export function unitFactor(unit: Unit): number {
  return unit === "g" ? GRAMS_PER_TROY_OUNCE : 1;
}

/** Converts a ratio expressed in troy ounces into the requested unit. */
export function convertRatio(ratioOz: number, unit: Unit): number {
  return ratioOz * unitFactor(unit);
}

export interface TimedValue {
  t: number;
  value: number;
}

/** Rescales a series so its first value is 100. Returns [] when the first value is not usable. */
export function indexTo100(series: readonly TimedValue[]): TimedValue[] {
  if (series.length === 0) return [];
  const base = series[0].value;
  if (!Number.isFinite(base) || base <= 0) return [];
  return series.map((p) => ({ t: p.t, value: (p.value / base) * 100 }));
}

function extreme(
  points: readonly RatioPoint[],
  better: (a: number, b: number) => boolean,
): ValueAt {
  let best: ValueAt = { value: points[0].ratioOz, t: points[0].t };
  for (const p of points) if (better(p.ratioOz, best.value)) best = { value: p.ratioOz, t: p.t };
  return best;
}

/** Mean of points in the trailing `days` window, or null when the series does not span that long. */
export function trailingMean(points: readonly RatioPoint[], days: number): number | null {
  if (points.length === 0) return null;
  const endT = points[points.length - 1].t;
  const window = days * DAY_MS;
  // One bucket of slack so a 90-day daily series qualifies for a 90-day average.
  if (endT - points[0].t < window - DAY_MS) return null;
  let sum = 0;
  let n = 0;
  for (let i = points.length - 1; i >= 0 && points[i].t > endT - window; i--) {
    sum += points[i].ratioOz;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** Statistics over a ratio series (in ounces; scale-invariant fields need no conversion). */
export function computeStats(points: readonly RatioPoint[]): RatioStats | null {
  if (points.length === 0) return null;
  const first = points[0].ratioOz;
  const current = points[points.length - 1].ratioOz;
  let sum = 0;
  let atOrBelow = 0;
  for (const p of points) {
    sum += p.ratioOz;
    if (p.ratioOz <= current) atOrBelow++;
  }
  return {
    first,
    current,
    changePct: (current / first - 1) * 100,
    high: extreme(points, (a, b) => a > b),
    low: extreme(points, (a, b) => a < b),
    avg: sum / points.length,
    ma30: trailingMean(points, 30),
    ma90: trailingMean(points, 90),
    percentile: (atOrBelow / points.length) * 100,
    startT: points[0].t,
    endT: points[points.length - 1].t,
    count: points.length,
  };
}

/**
 * Percentage change of the ratio between the latest point and the value in force `windowMs` earlier
 * (the latest point at or before that instant). When the series starts at most `toleranceMs` after
 * that instant (e.g. a weekend at the window start), its first point is used. Otherwise null.
 */
export function changeSince(
  points: readonly RatioPoint[],
  windowMs: number,
  toleranceMs = 0,
): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = last.t - windowMs;
  let base: RatioPoint | undefined;
  for (const p of points) {
    if (p.t <= target) base = p;
    else break;
  }
  if (!base && points[0].t - target <= toleranceMs) base = points[0];
  if (!base || base === last) return null;
  return (last.ratioOz / base.ratioOz - 1) * 100;
}

/** Ratio change implied by the coin's and gold's own USD changes: (1+c)/(1+g) − 1, in percent. */
export function ratioChangeFromLegs(coinChangePct: number, goldChangePct: number): number {
  return ((1 + coinChangePct / 100) / (1 + goldChangePct / 100) - 1) * 100;
}

export interface CompareInput {
  id: string;
  points: readonly RatioPoint[];
}

export interface CompareLine {
  id: string;
  points: TimedValue[];
  /** Change over the common window, in percent. */
  changePct: number;
}

export interface CompareResult {
  /** Common start (ms) used for indexing, or null when the series do not overlap. */
  start: number | null;
  lines: CompareLine[];
  /** True when at least one series had data before the common start. */
  truncated: boolean;
}

/**
 * Intersects several ratio series on their latest common start and indexes each to 100 there.
 * Series without any point at or after the common start are dropped.
 */
export function buildComparison(inputs: readonly CompareInput[]): CompareResult {
  const usable = inputs.filter((s) => s.points.length > 0);
  if (usable.length === 0) return { start: null, lines: [], truncated: false };
  const start = Math.max(...usable.map((s) => s.points[0].t));
  const earliest = Math.min(...usable.map((s) => s.points[0].t));
  const lines: CompareLine[] = [];
  for (const s of usable) {
    const trimmed = s.points.filter((p) => p.t >= start).map((p) => ({ t: p.t, value: p.ratioOz }));
    const indexed = indexTo100(trimmed);
    if (indexed.length === 0) continue;
    lines.push({ id: s.id, points: indexed, changePct: indexed[indexed.length - 1].value - 100 });
  }
  return { start, lines, truncated: start > earliest };
}

export interface MaybeTimedValue {
  t: number;
  /** Undefined marks a break in the line. */
  value?: number;
}

/**
 * Inserts a break after any point followed by a silence longer than `maxGapBuckets` buckets, so a
 * chart doesn't draw a straight line across time when nothing was recorded (server switched off).
 */
export function markGaps(
  series: readonly TimedValue[],
  bucketMs: number,
  maxGapBuckets = 3,
): MaybeTimedValue[] {
  const out: MaybeTimedValue[] = [];
  for (let i = 0; i < series.length; i++) {
    out.push(series[i]);
    const next = series[i + 1];
    if (next && next.t - series[i].t > maxGapBuckets * bucketMs)
      out.push({ t: series[i].t + bucketMs });
  }
  return out;
}
