// Number, percent, money and date formatting (PRD §7.2). Pure and locale-stable (en-GB/en-US output).

import { convertRatio } from "./ratio";
import type { DisplayCurrency, Granularity, Unit } from "./types";

/** Non-breaking space between a number and "%" so the pair never wraps ("8.4 %"). */
export const NBSP = " ";
/** Typographic minus sign. */
export const MINUS = "−";

const groupedFixed = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const FIXED_0 = groupedFixed(0);
const FIXED_1 = groupedFixed(1);
const FIXED_2 = groupedFixed(2);

/** Drops trailing zeros from a plain decimal string ("2.10" → "2.1", "3.000" → "3"). */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** `sig` significant digits, as a plain decimal string when the magnitude allows it. */
export function formatSignificant(value: number, sig: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs < 1e-6 || abs >= 1e21) {
    const [mantissa, exponent] = value.toExponential(sig - 1).split("e");
    return `${trimZeros(mantissa)}e${exponent}`;
  }
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return trimZeros(value.toFixed(Math.min(decimals, 20)));
}

/**
 * Magnitude-aware amount formatting:
 * ≥ 100 → 1 decimal (615.6) · ≥ 1 → 2 decimals (19.79) · 0.01–1 → 4 significant digits (0.5966)
 * · < 0.01 → compact, 3 significant digits (0.000912, 4.3e-9).
 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100) return FIXED_1.format(value);
  if (abs >= 1) return FIXED_2.format(value);
  if (abs >= 0.01) return formatSignificant(value, 4);
  return formatSignificant(value, 3);
}

export interface FormattedRatio {
  value: string;
  unit: "oz" | "g" | "mg";
  text: string;
}

/**
 * Formats a ratio (stored in ounces) in the requested unit. Gram values below 0.01 g switch to
 * milligrams so micro-caps stay readable ("0.0021 g" → "2.1 mg").
 */
export function formatRatio(ratioOz: number, unit: Unit): FormattedRatio {
  const v = convertRatio(ratioOz, unit);
  if (unit === "g" && Number.isFinite(v) && v !== 0 && Math.abs(v) < 0.01) {
    const value = formatSignificant(v * 1000, 3);
    return { value, unit: "mg", text: `${value} mg` };
  }
  const value = formatAmount(v);
  return { value, unit, text: `${value} ${unit}` };
}

/**
 * Unit and multiplier for drawing a whole series (chart axis). Matches `formatRatio`: when even the
 * series maximum is below 0.01 g, the axis is in milligrams.
 */
export function displayScale(
  maxRatioOz: number,
  unit: Unit,
): { unit: "oz" | "g" | "mg"; factor: number } {
  if (unit === "oz") return { unit: "oz", factor: 1 };
  const grams = convertRatio(1, "g");
  return maxRatioOz * grams < 0.01
    ? { unit: "mg", factor: grams * 1000 }
    : { unit: "g", factor: grams };
}

/** Long form for small gram values: "0.0021 g = 2.1 mg". Other values match `formatRatio`. */
export function formatRatioLong(ratioOz: number, unit: Unit): string {
  const short = formatRatio(ratioOz, unit);
  if (short.unit !== "mg") return short.text;
  return `${formatSignificant(convertRatio(ratioOz, "g"), 2)} g = ${short.text}`;
}

/** Axis/tick label for a value already expressed in the display unit. */
export function formatAxisValue(value: number): string {
  return formatAmount(value);
}

/**
 * Axis formatter that adds just enough precision to tell gridlines apart when the series barely moves
 * (e.g. a few minutes of recording: 19.8135 … 19.8152 instead of nine labels reading "19.82").
 */
export function axisFormatter(min: number, max: number): (value: number) => string {
  const span = max - min;
  const top = Math.max(Math.abs(min), Math.abs(max));
  if (!Number.isFinite(span) || span <= 0 || top === 0) return formatAxisValue;
  // Digits needed so a tenth of the span is visible.
  const needed = Math.ceil(-Math.log10(span / 10));
  if (top >= 1) {
    const decimals = Math.min(8, Math.max(top >= 100 ? 1 : 2, needed));
    const fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return (v) => fmt.format(v);
  }
  const sig = Math.min(12, Math.max(4, Math.ceil(Math.log10(top)) + needed));
  return (v) => formatSignificant(v, sig);
}

/** Absolute percent for prose: < 10 → 1 decimal ("8.4"), otherwise whole number ("12"). */
export function formatPctMagnitude(absPct: number): string {
  const a = Math.abs(absPct);
  return a < 10 ? FIXED_1.format(a) : FIXED_0.format(a);
}

export type Direction = "up" | "down" | "flat";

export interface FormattedChange {
  direction: Direction;
  arrow: string;
  /** Signed text, e.g. "+8.4 %" or "−3.1 %". */
  text: string;
  /** Accessible wording, e.g. "up 8.4 percent". */
  label: string;
}

/** Signed percent with an arrow so colour is never the only signal (FR-6). */
export function formatChange(pct: number | null | undefined, decimals = 1): FormattedChange {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { direction: "flat", arrow: "", text: "—", label: "not available" };
  }
  const rounded = Number(pct.toFixed(decimals));
  const abs = groupedFixed(decimals).format(Math.abs(rounded));
  if (rounded > 0)
    return { direction: "up", arrow: "▲", text: `+${abs}${NBSP}%`, label: `up ${abs} percent` };
  if (rounded < 0)
    return {
      direction: "down",
      arrow: "▼",
      text: `${MINUS}${abs}${NBSP}%`,
      label: `down ${abs} percent`,
    };
  return {
    direction: "flat",
    arrow: "■",
    text: `0.${"0".repeat(decimals)}${NBSP}%`,
    label: "unchanged",
  };
}

const CURRENCY_SYMBOL: Record<DisplayCurrency, string> = { USD: "$", TRY: "₺" };

/** Money with magnitude-aware precision: ≥ 10,000 → 0 decimals, ≥ 1 → 2 decimals, < 1 → 4 significant. */
export function formatMoney(value: number, currency: DisplayCurrency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  const symbol = CURRENCY_SYMBOL[currency];
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  let body: string;
  if (abs >= 10_000) body = FIXED_0.format(abs);
  else if (abs >= 1) body = FIXED_2.format(abs);
  else body = formatSignificant(abs, 4);
  return `${sign}${symbol}${body}`;
}

const DATE_UTC = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_YEAR_UTC = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const WEEKDAY_UTC = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** "3 Mar 2026". Daily buckets are UTC dates, so format in UTC to avoid off-by-one days. */
export function formatDate(t: number): string {
  return DATE_UTC.format(t);
}

export function formatMonthYear(t: number): string {
  return MONTH_YEAR_UTC.format(t);
}

export function formatWeekday(t: number): string {
  return WEEKDAY_UTC.format(t);
}

/** Date for a series point: UTC date for daily data, local date + time for hourly data. */
export function formatPointTime(t: number, granularity: Granularity, timeZone?: string): string {
  if (granularity === "day") return formatDate(t);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(t);
}

/** Local "HH:MM" clock time. */
export function formatClock(t: number | string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(t));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
