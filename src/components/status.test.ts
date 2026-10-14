import { describe, expect, it } from "vitest";
import type { HistoryMeta, SpotResponse } from "@/lib/types";
import { lastCloseTimes, compareTooltip, ratioTooltip } from "./chart/tooltip";
import { deriveBadges, PAUSED_BADGE, PAXG_BADGE } from "./status";

const NOW = Date.UTC(2026, 9, 11, 13, 30);
const iso = (t: number) => new Date(t).toISOString();

function spot(overrides: Partial<SpotResponse> = {}): SpotResponse {
  return {
    gold: { usdPerOz: 4195.6, asOf: iso(NOW), source: "xaus", stale: false, change24h: 0 },
    coins: [],
    missing: [],
    coinsStale: false,
    rateLimited: false,
    ...overrides,
  };
}

const coin = (asOf = NOW) => ({
  id: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  image: null,
  rank: 1,
  usd: 83_039,
  change24h: 0.3,
  ratioOz: 19.79,
  ratioChange24h: 0.3,
  asOf: iso(asOf),
  priceSource: "freecryptoapi" as const,
});

const base = {
  spot: spot(),
  coin: coin(),
  spotRateLimited: false,
  history: undefined,
  fxFailed: false,
  now: NOW,
};
const ids = (input: Parameters<typeof deriveBadges>[0]) => deriveBadges(input).map((b) => b.id);

describe("deriveBadges", () => {
  it("shows nothing when everything is fresh", () => {
    expect(deriveBadges(base)).toEqual([]);
  });

  it("flags the PAXG fallback with the PRD wording", () => {
    const [badge] = deriveBadges({
      ...base,
      spot: spot({ gold: { ...spot().gold, source: "paxg" } }),
    });
    expect(badge.text).toBe(PAXG_BADGE);
  });

  it("flags stale gold and coin prices", () => {
    expect(ids({ ...base, spot: spot({ gold: { ...spot().gold, stale: true } }) })).toEqual([
      "gold-stale",
    ]);
    expect(ids({ ...base, coin: coin(NOW - 20 * 60_000) })).toEqual(["coin-stale"]);
    expect(ids({ ...base, spot: spot({ coinsStale: true }) })).toEqual(["coin-stale"]);
  });

  it("says live updates are paused on rate limiting (from the response or a failed refresh)", () => {
    expect(
      deriveBadges({ ...base, spot: spot({ rateLimited: true, coinsStale: true }) })[0].text,
    ).toBe(PAUSED_BADGE);
    expect(ids({ ...base, spotRateLimited: true })).toEqual(["paused"]);
  });

  it("says when recording has paused, instead of a gold warning", () => {
    const history: HistoryMeta = {
      coinSource: "freecryptoapi",
      goldSource: "xaus",
      availableFrom: NOW,
      truncated: false,
      recordedFrom: NOW - 86_400_000,
      lastRecordedAt: Date.UTC(2026, 9, 11, 12, 0),
      recordingStale: true,
      goldStale: true,
      goldLastT: Date.UTC(2026, 9, 11, 12, 0),
    };
    const badges = deriveBadges({ ...base, history });
    expect(badges.map((b) => b.id)).toEqual(["recording-paused"]);
    expect(badges[0].text).toMatch(/^Recording paused since \d{2}:\d{2}$/);
  });

  it("covers history and FX problems", () => {
    const history: HistoryMeta = {
      coinSource: "freecryptoapi",
      goldSource: "paxg",
      availableFrom: NOW,
      truncated: false,
      recordedFrom: NOW - 86_400_000,
      lastRecordedAt: NOW,
      recordingStale: false,
      goldStale: true,
      goldLastT: NOW - 3_600_000,
    };
    expect(ids({ ...base, history, fxFailed: true })).toEqual([
      "gold-history-stale",
      "paxg-history",
      "fx",
    ]);
  });
});

describe("tooltips", () => {
  const friday = Date.UTC(2026, 9, 9);
  const points = [0, 1, 2].map((i) => ({
    t: friday + i * 86_400_000,
    coinUsd: 83_000 + i,
    goldUsdOz: 4216.3,
    ratioOz: 19.7,
    goldFilled: i > 0,
  }));

  it("notes forward-filled gold with the weekday of the last close", () => {
    const closes = lastCloseTimes(points);
    expect(closes).toEqual([friday, friday, friday]);
    const t = ratioTooltip(points[2], closes[2], { unit: "g", symbol: "BTC", granularity: "day" });
    expect(t.title).toBe("11 Oct 2026");
    expect(t.rows).toEqual([
      { label: "1 BTC", value: "612.7 g" },
      { label: "BTC price", value: "$83,002" },
      { label: "Gold", value: "$4,216.30/oz" },
    ]);
    expect(t.note).toBe("gold: last close Fri");
    expect(
      ratioTooltip(points[0], closes[0], { unit: "oz", symbol: "BTC", granularity: "day" }).note,
    ).toBeUndefined();
  });

  it("lists every compared coin at the hovered date", () => {
    const t = compareTooltip(friday, "day", [
      { symbol: "BTC", color: "#000", value: 108.44 },
      { symbol: "ETH", color: "#111", value: 95 },
      { symbol: "SUI", color: "#222", value: undefined },
    ]);
    expect(t.rows.map((r) => `${r.label} ${r.value}`)).toEqual([
      "BTC 108.4 (+8.4 %)",
      "ETH 95.0 (−5.0 %)",
      "SUI —",
    ]);
  });
});
