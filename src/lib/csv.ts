import { ozToGram } from "./ratio";
import type { Granularity, RangeKey, RatioPoint } from "./types";

export const CSV_HEADER = "date,coin_usd,gold_usd_oz,ratio_oz,ratio_g";

/** ISO date for daily buckets, ISO date-time (UTC, no milliseconds) for hourly buckets. */
export function isoTime(t: number, granularity: Granularity): string {
  const iso = new Date(t).toISOString();
  return granularity === "day" ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

/** Serialises a ratio series at full numeric precision (FR-15). */
export function toCsv(points: readonly RatioPoint[], granularity: Granularity): string {
  const rows = points.map((p) =>
    [isoTime(p.t, granularity), p.coinUsd, p.goldUsdOz, p.ratioOz, ozToGram(p.ratioOz)]
      .map(String)
      .join(","),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

export function exportFilename(
  symbol: string,
  range: RangeKey,
  ext: "csv" | "png",
  now = Date.now(),
): string {
  const safe = symbol.toLowerCase().replace(/[^a-z0-9-]/g, "") || "coin";
  return `auratio-${safe}-${range}-${new Date(now).toISOString().slice(0, 10)}.${ext}`;
}
