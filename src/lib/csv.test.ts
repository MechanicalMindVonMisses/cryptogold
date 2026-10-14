import { describe, expect, it } from "vitest";
import { CSV_HEADER, exportFilename, isoTime, toCsv } from "./csv";
import type { RatioPoint } from "./types";

const points: RatioPoint[] = [
  {
    t: Date.UTC(2026, 9, 9),
    coinUsd: 83039.123456789,
    goldUsdOz: 4216.2998,
    ratioOz: 19.695111,
    goldFilled: false,
  },
  {
    t: Date.UTC(2026, 9, 10),
    coinUsd: 83500,
    goldUsdOz: 4216.2998,
    ratioOz: 19.80444,
    goldFilled: true,
  },
];

describe("toCsv", () => {
  it("writes the header and one row per point at full precision", () => {
    const lines = toCsv(points, "day").trimEnd().split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[0]).toBe("date,coin_usd,gold_usd_oz,ratio_oz,ratio_g");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      `2026-10-09,83039.123456789,4216.2998,19.695111,${19.695111 * 31.1034768}`,
    );
  });

  it("uses ISO date-times for hourly series", () => {
    expect(isoTime(Date.UTC(2026, 9, 11, 13), "hour")).toBe("2026-10-11T13:00:00Z");
    expect(toCsv([], "hour")).toBe(`${CSV_HEADER}\n`);
  });

  it("builds safe file names", () => {
    expect(exportFilename("BTC", "1y", "csv", Date.UTC(2026, 9, 11))).toBe(
      "auratio-btc-1y-2026-10-11.csv",
    );
    expect(exportFilename("$$", "max", "png", Date.UTC(2026, 9, 11))).toBe(
      "auratio-coin-max-2026-10-11.png",
    );
  });
});
