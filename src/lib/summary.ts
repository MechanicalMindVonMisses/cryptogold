// Deterministic, unit-aware summary templates (PRD §7.4). Only numbers and the coin symbol are
// interpolated; no free text from external sources ever reaches the output.

import {
  countWords,
  formatChange,
  formatDate,
  formatMonthYear,
  formatPctMagnitude,
  formatRatio,
  MINUS,
  NBSP,
} from "./format";
import { isAtLeastThreeMonths, RANGES } from "./ranges";
import { computeStats, DAY_MS, HOUR_MS, MINUTE_MS } from "./ratio";
import type { GoldSource, RangeKey, RatioPoint, RatioStats, Unit } from "./types";

export const MAX_WORDS = 60;
export const MAX_SENTENCES = 4;
/** |change| below this many percent reads as "roughly flat" / "kept pace". */
export const FLAT_THRESHOLD_PCT = 1;
/** Within this fraction of the period high/low counts as "at a new period high/low". */
export const EXTREME_TOLERANCE = 0.005;

export interface SummaryInput {
  symbol: string;
  points: readonly RatioPoint[];
  unit: Unit;
  range: RangeKey;
  goldSource: GoldSource;
  /** Precomputed stats for `points`; computed when omitted. */
  stats?: RatioStats | null;
  /** Days actually available when the coin's history is shorter than the range. */
  /** How much history the series covers (ms) when it is shorter than the range. */
  truncatedSpanMs?: number | null;
  /** Live ratio in ounces for the headline sentence; defaults to the last point. */
  currentOz?: number | null;
}

export interface Summary {
  sentences: string[];
  text: string;
}

interface Part {
  text: string;
  /** Lower is more important; the highest-priority parts survive trimming. */
  priority: number;
}

const otherUnit = (unit: Unit): Unit => (unit === "oz" ? "g" : "oz");

function finish(parts: Part[]): Summary {
  const kept = [...parts];
  const tooLong = () =>
    kept.length > MAX_SENTENCES || countWords(kept.map((p) => p.text).join(" ")) > MAX_WORDS;
  while (tooLong()) {
    // Drop the least important sentence; ties drop the later one.
    let worst = 0;
    kept.forEach((p, i) => {
      if (p.priority >= kept[worst].priority) worst = i;
    });
    if (kept[worst].priority === 0) break;
    kept.splice(worst, 1);
  }
  const sentences = kept.map((p) => p.text);
  return { sentences, text: sentences.join(" ") };
}

/** S1: "1 BTC is worth 19.79 oz of gold (615.6 g)." */
export function currentSentence(symbol: string, ratioOz: number, unit: Unit): string {
  const primary = formatRatio(ratioOz, unit).text;
  const secondary = formatRatio(ratioOz, otherUnit(unit)).text;
  return `1 ${symbol} is worth ${primary} of gold (${secondary}).`;
}

export interface Span {
  n: number;
  unit: "minute" | "hour" | "day";
}

/** A duration in the largest whole unit that reads naturally: 11 minutes, 5 hours, 214 days. */
export function describeSpan(ms: number): Span {
  if (ms < HOUR_MS) return { n: Math.max(1, Math.round(ms / MINUTE_MS)), unit: "minute" };
  if (ms < DAY_MS) return { n: Math.round(ms / HOUR_MS), unit: "hour" };
  return { n: Math.round(ms / DAY_MS), unit: "day" };
}

const spanLabel = (s: Span) => `${s.n} ${s.unit}${s.n === 1 ? "" : "s"}`;

function periodPhrase(range: RangeKey, stats: RatioStats, span: Span | null): string {
  if (span)
    return span.unit === "day"
      ? `since ${formatDate(stats.startT)}`
      : `over the last ${spanLabel(span)}`;
  if (range === "max") return `since ${formatMonthYear(stats.startT)}`;
  return RANGES[range].phrase;
}

function periodAdjective(range: RangeKey, span: Span | null): string {
  if (span) return `${span.n}-${span.unit}`;
  return RANGES[range].adjective;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** S2: "That's up 8.4 % over the last 30 days." */
export function changeSentence(changePct: number, phrase: string): string {
  if (Math.abs(changePct) < FLAT_THRESHOLD_PCT) return `That's roughly flat ${phrase}.`;
  const word = changePct > 0 ? "up" : "down";
  return `That's ${word} ${formatPctMagnitude(changePct)}${NBSP}% ${phrase}.`;
}

/** S3: position relative to the period high (top half) or low (bottom half). */
export function positionSentence(
  currentOz: number,
  stats: RatioStats,
  unit: Unit,
  adjective: string,
): string {
  const high = stats.high.value;
  const low = stats.low.value;
  if (currentOz >= high * (1 - EXTREME_TOLERANCE)) return `It is at a new ${adjective} high.`;
  if (currentOz <= low * (1 + EXTREME_TOLERANCE)) return `It is at a new ${adjective} low.`;
  if (currentOz >= (high + low) / 2) {
    const pct = formatPctMagnitude((1 - currentOz / high) * 100);
    const value = formatRatio(high, unit).text;
    return `It sits ${pct}${NBSP}% below its ${adjective} high of ${value} (${formatDate(stats.high.t)}).`;
  }
  const pct = formatPctMagnitude((currentOz / low - 1) * 100);
  const value = formatRatio(low, unit).text;
  return `It sits ${pct}${NBSP}% above its ${adjective} low of ${value} (${formatDate(stats.low.t)}).`;
}

/** S4: "Over the past year, BTC has outperformed gold; the 30-day average is above the 90-day average." */
export function trendSentence(symbol: string, stats: RatioStats, phrase: string): string {
  const verdict =
    stats.changePct > FLAT_THRESHOLD_PCT
      ? "outperformed gold"
      : stats.changePct < -FLAT_THRESHOLD_PCT
        ? "underperformed gold"
        : "kept pace with gold";
  let ma = "";
  if (stats.ma30 !== null && stats.ma90 !== null) {
    const relation =
      stats.ma30 > stats.ma90 ? "above" : stats.ma30 < stats.ma90 ? "below" : "level with";
    ma = `; the 30-day average is ${relation} the 90-day average`;
  }
  return `${capitalize(phrase)}, ${symbol} has ${verdict}${ma}.`;
}

export const PAXG_NOTE = "Gold priced via PAXG proxy.";

export function notEnoughHistory(symbol: string): string {
  return `Not enough history yet for ${symbol}.`;
}

export function truncatedNote(span: Span): string {
  return `Showing the ${spanLabel(span)} recorded so far.`;
}

export function buildSummary(input: SummaryInput): Summary {
  const { symbol, points, unit, range, goldSource } = input;
  const span =
    input.truncatedSpanMs === null || input.truncatedSpanMs === undefined
      ? null
      : describeSpan(input.truncatedSpanMs);
  const currentOz =
    input.currentOz ?? (points.length > 0 ? points[points.length - 1].ratioOz : null);
  const notes: Part[] = [];
  if (goldSource === "paxg") notes.push({ text: PAXG_NOTE, priority: 1 });

  if (points.length < 2) {
    const parts: Part[] = [];
    if (currentOz !== null && Number.isFinite(currentOz)) {
      parts.push({ text: currentSentence(symbol, currentOz, unit), priority: 0 });
    }
    parts.push({ text: notEnoughHistory(symbol), priority: 0 });
    return finish([...parts, ...notes]);
  }

  const stats = input.stats ?? computeStats(points);
  if (!stats || currentOz === null)
    return finish([{ text: notEnoughHistory(symbol), priority: 0 }]);

  const phrase = periodPhrase(range, stats, span);
  const parts: Part[] = [
    { text: currentSentence(symbol, currentOz, unit), priority: 0 },
    { text: changeSentence(stats.changePct, phrase), priority: 0 },
    {
      text: positionSentence(currentOz, stats, unit, periodAdjective(range, span)),
      priority: 2,
    },
  ];
  if (isAtLeastThreeMonths(range))
    parts.push({ text: trendSentence(symbol, stats, phrase), priority: 3 });
  if (span) notes.unshift({ text: truncatedNote(span), priority: 1 });
  return finish([...parts, ...notes]);
}

export interface CompareSummaryLine {
  symbol: string;
  changePct: number;
}

export interface CompareSummaryInput {
  lines: readonly CompareSummaryLine[];
  /** Common start used for indexing (ms). */
  start: number | null;
  truncated: boolean;
  goldSource: GoldSource;
}

function signedPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? MINUS : "";
  return `${sign}${formatPctMagnitude(pct)}${NBSP}%`;
}

/** "<best> did best against gold (+x %), <worst> did worst (−y %)." plus indexing context. */
export function buildCompareSummary(input: CompareSummaryInput): Summary {
  const { lines, start, truncated, goldSource } = input;
  if (lines.length < 2 || start === null) {
    return finish([{ text: "Pick at least two coins to compare against gold.", priority: 0 }]);
  }
  const best = lines.reduce((a, b) => (b.changePct > a.changePct ? b : a));
  const worst = lines.reduce((a, b) => (b.changePct < a.changePct ? b : a));
  const parts: Part[] = [
    {
      text: `${best.symbol} did best against gold (${signedPct(best.changePct)}), ${worst.symbol} did worst (${signedPct(worst.changePct)}).`,
      priority: 0,
    },
    {
      text: truncated
        ? `All lines start at 100 on ${formatDate(start)}, the first date every coin has data.`
        : `All lines start at 100 on ${formatDate(start)}.`,
      priority: 0,
    },
  ];
  if (goldSource === "paxg") parts.push({ text: PAXG_NOTE, priority: 1 });
  return finish(parts);
}

/** Compact watchlist row text: "19.79 oz · ▲ +2.1 % 24h". */
export function buildOneLiner(ratioOz: number, unit: Unit, ratioChange24h: number | null): string {
  const ratio = formatRatio(ratioOz, unit).text;
  if (ratioChange24h === null || !Number.isFinite(ratioChange24h)) return ratio;
  const change = formatChange(ratioChange24h);
  return `${ratio} · ${change.arrow}${NBSP}${change.text} 24h`;
}
