// Pure tooltip content builders (unit-tested without a canvas).

import {
  formatChange,
  formatMoney,
  formatPointTime,
  formatRatio,
  formatWeekday,
} from "@/lib/format";
import type { DisplayCurrency, Granularity, RatioPoint, Unit } from "@/lib/types";

export interface PriceDisplay {
  currency: DisplayCurrency;
  /** Units of `currency` per USD. */
  rate: number;
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export interface TooltipContent {
  title: string;
  rows: TooltipRow[];
  note?: string;
}

/** For each point, the time of the latest real (not forward-filled) gold close at or before it. */
export function lastCloseTimes(points: readonly RatioPoint[]): Array<number | null> {
  let last: number | null = null;
  return points.map((p) => {
    if (!p.goldFilled) last = p.t;
    return last;
  });
}

/**
 * Historical prices stay in USD: there is no historical USD/TRY series, and converting old prices at
 * today's rate would misstate them.
 */
export function ratioTooltip(
  point: RatioPoint,
  lastCloseT: number | null,
  opts: { unit: Unit; symbol: string; granularity: Granularity },
): TooltipContent {
  const { unit, symbol, granularity } = opts;
  return {
    title: formatPointTime(point.t, granularity),
    rows: [
      { label: `1 ${symbol}`, value: formatRatio(point.ratioOz, unit).text },
      { label: `${symbol} price`, value: formatMoney(point.coinUsd) },
      { label: "Gold", value: `${formatMoney(point.goldUsdOz)}/oz` },
    ],
    note:
      point.goldFilled && lastCloseT !== null
        ? `gold: last close ${formatWeekday(lastCloseT)}`
        : undefined,
  };
}

export interface CompareTooltipLine {
  symbol: string;
  color: string;
  /** Indexed value at the hovered time, or undefined if the coin has no point there. */
  value: number | undefined;
}

export function compareTooltip(
  t: number,
  granularity: Granularity,
  lines: readonly CompareTooltipLine[],
): TooltipContent {
  return {
    title: formatPointTime(t, granularity),
    rows: lines.map((l) => ({
      label: l.symbol,
      color: l.color,
      value:
        l.value === undefined ? "—" : `${l.value.toFixed(1)} (${formatChange(l.value - 100).text})`,
    })),
  };
}
