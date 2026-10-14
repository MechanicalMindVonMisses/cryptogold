import { isRangeKey } from "./ranges";
import type { RangeKey, Unit } from "./types";

export const MAX_COMPARE = 4;
export const COIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function isCoinId(value: unknown): value is string {
  return typeof value === "string" && COIN_ID_PATTERN.test(value);
}

export function isUnit(value: unknown): value is Unit {
  return value === "oz" || value === "g";
}

export interface UrlState {
  coin?: string;
  range?: RangeKey;
  unit?: Unit;
  /** Present only when compare mode is on. */
  compare?: string[];
}

/** Parses and validates the shareable view state (FR-16). Invalid values are ignored. */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const state: UrlState = {};
  const coin = params.get("coin");
  if (isCoinId(coin)) state.coin = coin;
  const range = params.get("range");
  if (isRangeKey(range)) state.range = range;
  const unit = params.get("unit");
  if (isUnit(unit)) state.unit = unit;
  const compare = params.get("compare");
  if (compare !== null) {
    const ids = [...new Set(compare.split(",").filter(isCoinId))].slice(0, MAX_COMPARE);
    if (ids.length >= 2) state.compare = ids;
  }
  return state;
}

export function serializeUrlState(
  state: Required<Omit<UrlState, "compare">> & { compare: string[] | null },
): string {
  const params = new URLSearchParams();
  params.set("coin", state.coin);
  params.set("range", state.range);
  params.set("unit", state.unit);
  if (state.compare && state.compare.length > 0) params.set("compare", state.compare.join(","));
  // Commas are valid in query strings; keep them readable.
  return `?${params.toString().replace(/%2C/g, ",")}`;
}
