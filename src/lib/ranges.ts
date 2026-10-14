import type { Granularity, RangeKey } from "./types";

export interface RangeSpec {
  key: RangeKey;
  label: string;
  /** Calendar days covered, or null for "all available". */
  days: number | null;
  granularity: Granularity;
  /** Used in summary sentences: "up 8.4 % over the last 30 days". */
  phrase: string;
  /** Used for "its 1-year high". */
  adjective: string;
}

export const RANGE_KEYS = [
  "7d",
  "1m",
  "3m",
  "6m",
  "1y",
  "5y",
  "max",
] as const satisfies readonly RangeKey[];

export const RANGES: Record<RangeKey, RangeSpec> = {
  "7d": {
    key: "7d",
    label: "7D",
    days: 7,
    granularity: "hour",
    phrase: "over the last 7 days",
    adjective: "7-day",
  },
  "1m": {
    key: "1m",
    label: "1M",
    days: 30,
    granularity: "hour",
    phrase: "over the last 30 days",
    adjective: "30-day",
  },
  "3m": {
    key: "3m",
    label: "3M",
    days: 90,
    granularity: "day",
    phrase: "over the last 3 months",
    adjective: "3-month",
  },
  "6m": {
    key: "6m",
    label: "6M",
    days: 180,
    granularity: "day",
    phrase: "over the last 6 months",
    adjective: "6-month",
  },
  "1y": {
    key: "1y",
    label: "1Y",
    days: 365,
    granularity: "day",
    phrase: "over the past year",
    adjective: "1-year",
  },
  "5y": {
    key: "5y",
    label: "5Y",
    days: 1826,
    granularity: "day",
    phrase: "over the last 5 years",
    adjective: "5-year",
  },
  max: {
    key: "max",
    label: "Max",
    days: null,
    granularity: "day",
    phrase: "since launch",
    adjective: "all-time",
  },
};

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && (RANGE_KEYS as readonly string[]).includes(value);
}

/** The trend sentence (S4) is only written for ranges of three months or longer. */
export function isAtLeastThreeMonths(range: RangeKey): boolean {
  return range !== "7d" && range !== "1m";
}
