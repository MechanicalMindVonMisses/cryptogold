import { RANGE_KEYS, RANGES } from "./ranges";
import { DAY_MS } from "./ratio";
import type { HistoryMeta, RangeKey } from "./types";

export interface RangeAvailability {
  enabled: boolean;
  /** Tooltip text explaining why a range is disabled. */
  reason?: string;
}

export type AvailabilityMap = Record<RangeKey, RangeAvailability>;

/** Whole days between `from` and `now`, at least 1. */
export function daysAvailable(from: number, now: number): number {
  return Math.max(1, Math.round((now - from) / DAY_MS));
}

/**
 * Decides which range chips are usable (FR-3) from the 1-year history metadata of the selected coin.
 * History is recorded by AuRatio itself, so a coin's history starts when recording started: ranges
 * beyond the first one that already shows everything recorded are disabled with a reason.
 * Unknown metadata (still loading) leaves every range enabled.
 */
export function rangeAvailability(yearMeta: HistoryMeta | undefined, now: number): AvailabilityMap {
  const map = Object.fromEntries(RANGE_KEYS.map((k) => [k, { enabled: true }])) as AvailabilityMap;
  if (!yearMeta || !yearMeta.truncated) return map;

  let covering: RangeKey;
  let reason: string;
  if (yearMeta.recordedFrom === null) {
    covering = "7d";
    reason = "No history recorded for this coin yet";
  } else {
    const days = daysAvailable(yearMeta.recordedFrom, now);
    covering = RANGE_KEYS.find((k) => (RANGES[k].days ?? Infinity) >= days - 1) ?? "1y";
    reason = `Only ${days} day${days === 1 ? "" : "s"} of history recorded so far`;
  }
  let past = false;
  for (const k of RANGE_KEYS) {
    if (past) map[k] = { enabled: false, reason };
    if (k === covering) past = true;
  }
  return map;
}

/** The range to actually display: the requested one, or the largest enabled range below it. */
export function effectiveRange(requested: RangeKey, availability: AvailabilityMap): RangeKey {
  if (availability[requested].enabled) return requested;
  const idx = RANGE_KEYS.indexOf(requested);
  for (let i = idx - 1; i >= 0; i--) if (availability[RANGE_KEYS[i]].enabled) return RANGE_KEYS[i];
  return "7d";
}
