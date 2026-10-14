import { describe, expect, it } from "vitest";
import {
  alignSeries,
  bucketize,
  bucketStart,
  buildComparison,
  buildRatioSeries,
  changeSince,
  computeStats,
  convertRatio,
  DAY_MS,
  GRAMS_PER_TROY_OUNCE,
  HOUR_MS,
  indexTo100,
  markGaps,
  MINUTE_MS,
  ozToGram,
  ratioChangeFromLegs,
  toRatio,
  trailingMean,
  unitFactor,
} from "./ratio";
import type { RatioPoint } from "./types";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const at = (iso: string) => Date.parse(iso);

function series(values: number[], start = day("2026-01-01"), step = DAY_MS): RatioPoint[] {
  return values.map((v, i) => ({
    t: start + i * step,
    coinUsd: v,
    goldUsdOz: 1,
    ratioOz: v,
    goldFilled: false,
  }));
}

describe("bucketStart", () => {
  it("floors to the UTC day or hour", () => {
    expect(bucketStart(at("2026-10-09T04:00:00Z"), "day")).toBe(day("2026-10-09"));
    expect(bucketStart(at("2026-10-11T13:34:20Z"), "hour")).toBe(at("2026-10-11T13:00:00Z"));
    expect(bucketStart(at("2026-10-11T13:34:20Z"), "minute")).toBe(at("2026-10-11T13:34:00Z"));
    expect(MINUTE_MS).toBe(60_000);
  });
});

describe("markGaps", () => {
  it("breaks the line after silences longer than three buckets", () => {
    const series = [0, 1, 2, 10, 11].map((i) => ({ t: i * HOUR_MS, value: i }));
    expect(markGaps(series, HOUR_MS)).toEqual([
      { t: 0, value: 0 },
      { t: HOUR_MS, value: 1 },
      { t: 2 * HOUR_MS, value: 2 },
      { t: 3 * HOUR_MS },
      { t: 10 * HOUR_MS, value: 10 },
      { t: 11 * HOUR_MS, value: 11 },
    ]);
    expect(markGaps(series.slice(0, 3), HOUR_MS)).toHaveLength(3);
    expect(markGaps([], HOUR_MS)).toEqual([]);
  });
});

describe("bucketize", () => {
  it("keeps the latest observation per bucket and drops invalid prices", () => {
    const out = bucketize(
      [
        { t: at("2026-10-11T13:34:00Z"), usd: 3 },
        { t: at("2026-10-11T13:00:00Z"), usd: 2 },
        { t: at("2026-10-11T12:00:00Z"), usd: 0 },
        { t: at("2026-10-11T11:00:00Z"), usd: Number.NaN },
      ],
      "hour",
    );
    expect(out).toEqual([{ t: at("2026-10-11T13:00:00Z"), usd: 3 }]);
  });
});

describe("alignSeries", () => {
  // Gold trades Thu/Fri/Mon only in this window; crypto trades every day.
  const gold = [
    { t: at("2026-10-08T04:00:00Z"), usd: 4200 },
    { t: at("2026-10-09T04:00:00Z"), usd: 4216.3 },
    { t: at("2026-10-12T04:00:00Z"), usd: 4230 },
  ];
  const coin = [
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
    "2026-10-12",
  ].map((d, i) => ({
    t: day(d),
    usd: 80_000 + i * 1000,
  }));

  it("forward-fills Friday's gold close into Saturday and Sunday and flags it", () => {
    const out = alignSeries(coin, gold, "day");
    const byDate = Object.fromEntries(
      out.map((p) => [new Date(p.t).toISOString().slice(0, 10), p]),
    );
    expect(byDate["2026-10-09"]).toMatchObject({ goldUsdOz: 4216.3, goldFilled: false });
    expect(byDate["2026-10-10"]).toMatchObject({ goldUsdOz: 4216.3, goldFilled: true });
    expect(byDate["2026-10-11"]).toMatchObject({ goldUsdOz: 4216.3, goldFilled: true });
    expect(byDate["2026-10-12"]).toMatchObject({ goldUsdOz: 4230, goldFilled: false });
  });

  it("drops leading coin points that have no gold value at or before them", () => {
    const out = alignSeries(coin, gold, "day");
    expect(out[0].t).toBe(day("2026-10-08"));
    expect(out).toHaveLength(5);
  });

  it("aligns hourly series by UTC hour", () => {
    const hourlyGold = [
      { t: at("2026-10-09T19:00:00Z"), usd: 4210 },
      { t: at("2026-10-09T21:00:00Z"), usd: 4216.3 },
    ];
    const hourlyCoin = [
      { t: at("2026-10-09T19:04:00Z"), usd: 82_000 },
      { t: at("2026-10-09T20:00:00Z"), usd: 82_100 },
      { t: at("2026-10-09T21:00:00Z"), usd: 82_200 },
      { t: at("2026-10-10T09:00:00Z"), usd: 82_300 },
    ];
    const out = alignSeries(hourlyCoin, hourlyGold, "hour");
    expect(out.map((p) => [p.goldUsdOz, p.goldFilled])).toEqual([
      [4210, false],
      [4210, true],
      [4216.3, false],
      [4216.3, true],
    ]);
    expect(out[0].t).toBe(at("2026-10-09T19:00:00Z"));
  });

  it("returns an empty series when gold starts after all coin points", () => {
    expect(alignSeries(coin.slice(0, 1), gold, "day")).toEqual([]);
  });
});

describe("ratio and units", () => {
  it("computes ratioOz = coinUsd / goldUsdOz", () => {
    const [p] = toRatio([{ t: 0, coinUsd: 83_039, goldUsdOz: 4195.6, goldFilled: false }]);
    expect(p.ratioOz).toBeCloseTo(19.7919, 4);
    expect(buildRatioSeries([{ t: 0, usd: 10 }], [{ t: 0, usd: 4 }], "day")[0].ratioOz).toBe(2.5);
  });

  it("converts ounces to grams exactly (relative error < 1e-9)", () => {
    const exact = 615.537805872; // 19.79 × 31.1034768
    expect(Math.abs(ozToGram(19.79) - exact) / exact).toBeLessThan(1e-9);
    expect(GRAMS_PER_TROY_OUNCE).toBe(31.1034768);
    expect(convertRatio(2, "oz")).toBe(2);
    expect(convertRatio(2, "g")).toBe(2 * 31.1034768);
    expect(unitFactor("oz")).toBe(1);
  });

  it("indexes a series to 100 at its first value", () => {
    const out = indexTo100([
      { t: 1, value: 4 },
      { t: 2, value: 5 },
      { t: 3, value: 2 },
    ]);
    expect(out.map((p) => p.value)).toEqual([100, 125, 50]);
    expect(indexTo100([])).toEqual([]);
    expect(indexTo100([{ t: 1, value: 0 }])).toEqual([]);
  });

  it("derives the ratio change from the coin and gold legs", () => {
    expect(ratioChangeFromLegs(10, 0)).toBeCloseTo(10, 10);
    expect(ratioChangeFromLegs(2, 1)).toBeCloseTo(0.990099, 5);
    expect(ratioChangeFromLegs(0, 0)).toBe(0);
  });
});

describe("computeStats", () => {
  // Hand-computed reference series (10 daily points).
  const values = [10, 12, 11, 15, 9, 13, 14, 12, 16, 15];
  const points = series(values);

  it("computes current, change, extremes, average and percentile", () => {
    const s = computeStats(points)!;
    expect(s.first).toBe(10);
    expect(s.current).toBe(15);
    expect(s.changePct).toBeCloseTo(50, 10);
    expect(s.high).toEqual({ value: 16, t: points[8].t });
    expect(s.low).toEqual({ value: 9, t: points[4].t });
    expect(s.avg).toBeCloseTo(12.7, 10);
    expect(s.percentile).toBe(90);
    expect(s.count).toBe(10);
    expect(s.startT).toBe(points[0].t);
    expect(s.endT).toBe(points[9].t);
    expect(s.ma30).toBeNull();
    expect(s.ma90).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(computeStats([])).toBeNull();
  });

  it("computes trailing 30/90-day averages when the series spans them", () => {
    const long = series(Array.from({ length: 120 }, (_, i) => i + 1));
    const s = computeStats(long)!;
    // Last 30 values are 91..120 → mean 105.5; last 90 are 31..120 → mean 75.5.
    expect(s.ma30).toBeCloseTo(105.5, 10);
    expect(s.ma90).toBeCloseTo(75.5, 10);
    expect(trailingMean(long.slice(0, 20), 30)).toBeNull();
    expect(trailingMean([], 30)).toBeNull();
  });
});

describe("changeSince", () => {
  it("compares the last point with the value in force at the window start", () => {
    const hourly = series([100, 101, 102, 103, 110], at("2026-10-10T00:00:00Z"), 12 * HOUR_MS);
    // Last point is at +48h; 24h earlier is +24h (value 102).
    expect(changeSince(hourly, 24 * HOUR_MS)).toBeCloseTo((110 / 102 - 1) * 100, 10);
  });

  it("uses the first point when the series starts within the tolerance", () => {
    const daily = series([10, 11, 12, 13, 15], day("2026-01-03"));
    expect(changeSince(daily, 6 * DAY_MS)).toBeNull();
    expect(changeSince(daily, 6 * DAY_MS, 3 * DAY_MS)).toBeCloseTo(50, 10);
  });

  it("returns null when the series is too short", () => {
    expect(changeSince(series([1, 2]), 7 * DAY_MS)).toBeNull();
    expect(changeSince(series([1]), DAY_MS)).toBeNull();
  });
});

describe("buildComparison", () => {
  it("indexes each series to 100 at the latest common start", () => {
    const a = { id: "a", points: series([10, 11, 12, 13]) };
    const b = { id: "b", points: series([2, 3, 6], day("2026-01-02")) };
    const out = buildComparison([a, b]);
    expect(out.start).toBe(day("2026-01-02"));
    expect(out.truncated).toBe(true);
    expect(out.lines.map((l) => l.points[0].value)).toEqual([100, 100]);
    expect(out.lines[0].changePct).toBeCloseTo((13 / 11 - 1) * 100, 10);
    expect(out.lines[1].changePct).toBeCloseTo(200, 10);
  });

  it("handles empty input and same-start series", () => {
    expect(buildComparison([])).toEqual({ start: null, lines: [], truncated: false });
    const out = buildComparison([
      { id: "a", points: series([1, 2]) },
      { id: "b", points: series([4, 2]) },
    ]);
    expect(out.truncated).toBe(false);
    expect(out.lines[1].changePct).toBeCloseTo(-50, 10);
  });
});
