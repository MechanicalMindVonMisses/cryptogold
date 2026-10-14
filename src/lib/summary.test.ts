import { describe, expect, it } from "vitest";
import { countWords, MINUS, NBSP } from "./format";
import { DAY_MS, HOUR_MS } from "./ratio";
import {
  buildCompareSummary,
  buildOneLiner,
  buildSummary,
  changeSentence,
  currentSentence,
  MAX_SENTENCES,
  describeSpan,
  MAX_WORDS,
  PAXG_NOTE,
  truncatedNote,
  type SummaryInput,
} from "./summary";
import type { RangeKey, RatioPoint, Unit } from "./types";

const START = Date.UTC(2026, 2, 1); // 1 Mar 2026

/** Builds a ratio series from ounce values, one point per step. */
function series(values: number[], step = DAY_MS, start = START): RatioPoint[] {
  return values.map((v, i) => ({
    t: start + i * step,
    coinUsd: v * 4000,
    goldUsdOz: 4000,
    ratioOz: v,
    goldFilled: false,
  }));
}

/** First 18.257, a high of 22.5 on day 2 (3 Mar), a low of 15.1, ending at 19.7912. */
const BTC_VALUES = [18.257, 20, 22.5, 21, 18, 15.1, 16, 17.5, 18.8, 19.7912];

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    symbol: "BTC",
    points: series(BTC_VALUES),
    unit: "oz",
    range: "1m",
    goldSource: "xaus",
    ...overrides,
  };
}

const pct = (s: string) => s.replace(/ %/g, `${NBSP}%`);

describe("S1 current value", () => {
  it.each([
    ["oz", "1 BTC is worth 19.79 oz of gold (615.6 g)."],
    ["g", "1 BTC is worth 615.6 g of gold (19.79 oz)."],
  ] as const)("in %s", (unit, expected) => {
    expect(currentSentence("BTC", 19.7912, unit)).toBe(expected);
  });

  it("uses milligrams for micro-cap gram values", () => {
    expect(currentSentence("SHIB", 0.0021 / 31.1034768, "g")).toBe(
      "1 SHIB is worth 2.1 mg of gold (0.0000675 oz).",
    );
  });
});

describe("S2 change", () => {
  it.each([
    [8.44, "That's up 8.4 % over the last 30 days."],
    [-3.06, "That's down 3.1 % over the last 30 days."],
    [0.99, "That's roughly flat over the last 30 days."],
    [-0.5, "That's roughly flat over the last 30 days."],
    [1, "That's up 1.0 % over the last 30 days."],
    [42.4, "That's up 42 % over the last 30 days."],
  ])("%s %%", (change, expected) => {
    expect(changeSentence(change, "over the last 30 days")).toBe(pct(expected));
  });
});

describe("buildSummary", () => {
  it("writes the BTC 30-day example (snapshot)", () => {
    expect(buildSummary(input()).text).toBe(
      pct(
        "1 BTC is worth 19.79 oz of gold (615.6 g). That's up 8.4 % over the last 30 days. " +
          "It sits 12 % below its 30-day high of 22.50 oz (3 Mar 2026).",
      ),
    );
  });

  it("is unit-aware for every number", () => {
    const text = buildSummary(input({ unit: "g" })).text;
    expect(text).toContain("1 BTC is worth 615.6 g of gold (19.79 oz).");
    expect(text).toContain("high of 699.8 g (3 Mar 2026)");
    expect(text).not.toContain("22.50 oz");
  });

  it("refers to the period low when the current value is in the bottom half", () => {
    const text = buildSummary(input({ points: series([20, 22.5, 15.1, 16.5]) })).text;
    expect(text).toContain(pct("It sits 9.3 % above its 30-day low of 15.10 oz (3 Mar 2026)."));
  });

  it.each([
    [[15, 18, 20, 19.95], "It is at a new 30-day high."],
    [[22, 18, 20, 21.5, 23], "It is at a new 30-day high."],
    [[20, 18, 16, 16.05], "It is at a new 30-day low."],
  ])("detects a new period high/low within 0.5 %% (%j)", (values, expected) => {
    expect(buildSummary(input({ points: series(values) })).sentences).toContain(expected);
  });

  describe("S4 trend (ranges ≥ 3M)", () => {
    const yearly = (values: number[]) => series(values, 3 * DAY_MS);
    const rising = Array.from({ length: 122 }, (_, i) => 10 + i * 0.05);
    const falling = Array.from({ length: 122 }, (_, i) => 20 - i * 0.05);

    it("says the coin outperformed gold when the ratio rose more than 1 %", () => {
      const s = buildSummary(input({ range: "1y", points: yearly(rising) }));
      expect(s.sentences[3]).toBe(
        "Over the past year, BTC has outperformed gold; the 30-day average is above the 90-day average.",
      );
    });

    it("says the coin underperformed gold when the ratio fell more than 1 %", () => {
      const s = buildSummary(input({ range: "6m", points: yearly(falling) }));
      expect(s.sentences.at(-1)).toBe(
        "Over the last 6 months, BTC has underperformed gold; the 30-day average is below the 90-day average.",
      );
    });

    it("says the coin kept pace with gold within ±1 %", () => {
      const flat = series([10, 10.2, 9.9, 10.05], 30 * DAY_MS);
      const s = buildSummary(input({ range: "3m", points: flat }));
      expect(s.sentences.at(-1)).toMatch(/^Over the last 3 months, BTC has kept pace with gold/);
    });

    it.each(["7d", "1m"] as RangeKey[])("is omitted for %s", (range) => {
      const s = buildSummary(input({ range, points: series(rising, HOUR_MS) }));
      expect(s.text).not.toMatch(/outperformed|underperformed|kept pace/);
    });

    it("phrases the max range from its start month", () => {
      const s = buildSummary(
        input({ range: "max", points: series(rising, 30 * DAY_MS, Date.UTC(2017, 7, 17)) }),
      );
      expect(s.sentences[1]).toMatch(new RegExp(`^That's up \\d+${NBSP}% since Aug 2017\\.$`));
      expect(s.text).toContain("Since Aug 2017, BTC has outperformed gold");
      expect(s.text).toContain("all-time");
    });
  });

  describe("edge cases", () => {
    it("reports insufficient history", () => {
      expect(
        buildSummary(input({ symbol: "SUI", points: series([0.0009]), currentOz: null })).text,
      ).toBe("1 SUI is worth 0.0009 oz of gold (0.02799 g). Not enough history yet for SUI.");
      expect(buildSummary(input({ symbol: "SUI", points: [] })).text).toBe(
        "Not enough history yet for SUI.",
      );
    });

    it("states the span when history is shorter than the range", () => {
      const s = buildSummary(
        input({ range: "1y", points: series(BTC_VALUES), truncatedSpanMs: 214 * DAY_MS }),
      );
      expect(s.sentences).toContain("Showing the 214 days recorded so far.");
      expect(s.sentences[1]).toBe(pct("That's up 8.4 % since 1 Mar 2026."));
      expect(s.text).toContain("214-day high");
    });

    it("notes the PAXG gold proxy", () => {
      expect(buildSummary(input({ goldSource: "paxg" })).sentences.at(-1)).toBe(PAXG_NOTE);
    });

    it("uses the live value for the headline and position", () => {
      const s = buildSummary(input({ currentOz: 22.45 }));
      expect(s.sentences[0]).toBe("1 BTC is worth 22.45 oz of gold (698.3 g).");
      expect(s.sentences[2]).toBe("It is at a new 30-day high.");
    });
  });

  describe("limits", () => {
    const ranges: RangeKey[] = ["7d", "1m", "3m", "6m", "1y", "5y", "max"];
    const units: Unit[] = ["oz", "g"];
    const longSeries = series(
      Array.from({ length: 200 }, (_, i) => 5 + Math.sin(i / 9) + i * 0.01),
      2 * DAY_MS,
    );

    for (const range of ranges)
      for (const unit of units)
        for (const extras of [
          {},
          { truncatedSpanMs: 214 * DAY_MS },
          { goldSource: "paxg" as const, truncatedSpanMs: 99 * DAY_MS },
          { truncatedSpanMs: 11 * 60_000 },
        ]) {
          it(`${range}/${unit}/${JSON.stringify(extras)} stays within ${MAX_SENTENCES} sentences and ${MAX_WORDS} words`, () => {
            const s = buildSummary(
              input({ range, unit, points: longSeries, symbol: "WBTC", ...extras }),
            );
            expect(s.sentences.length).toBeGreaterThanOrEqual(2);
            expect(s.sentences.length).toBeLessThanOrEqual(MAX_SENTENCES);
            expect(countWords(s.text)).toBeLessThanOrEqual(MAX_WORDS);
            expect(s.sentences[0]).toMatch(/^1 WBTC is worth /);
          });
        }

    it("keeps the fallback and truncation notes ahead of the optional sentences", () => {
      const s = buildSummary(
        input({
          range: "1y",
          goldSource: "paxg",
          truncatedSpanMs: 120 * DAY_MS,
          points: longSeries,
        }),
      );
      expect(s.sentences).toContain(PAXG_NOTE);
      expect(s.sentences).toContain("Showing the 120 days recorded so far.");
      expect(s.sentences).toHaveLength(4);
    });
  });
});

describe("short recordings", () => {
  it("describes spans in minutes, hours or days", () => {
    expect(describeSpan(11 * 60_000)).toEqual({ n: 11, unit: "minute" });
    expect(describeSpan(5 * HOUR_MS + 1000)).toEqual({ n: 5, unit: "hour" });
    expect(describeSpan(214 * DAY_MS)).toEqual({ n: 214, unit: "day" });
    expect(describeSpan(0)).toEqual({ n: 1, unit: "minute" });
  });

  it("words a few minutes of history naturally", () => {
    const s = buildSummary(
      input({
        range: "7d",
        points: series([19.81, 19.812, 19.815], 5 * 60_000),
        truncatedSpanMs: 10 * 60_000,
      }),
    );
    expect(s.sentences[1]).toBe("That's roughly flat over the last 10 minutes.");
    expect(s.sentences[2]).toBe("It is at a new 10-minute high.");
    expect(s.sentences).toContain("Showing the 10 minutes recorded so far.");
    expect(truncatedNote({ n: 1, unit: "day" })).toBe("Showing the 1 day recorded so far.");
  });
});

describe("buildCompareSummary", () => {
  it("names the best and worst performer", () => {
    const s = buildCompareSummary({
      lines: [
        { symbol: "BTC", changePct: 5.21 },
        { symbol: "ETH", changePct: -3.06 },
        { symbol: "SUI", changePct: 12.4 },
      ],
      start: Date.UTC(2025, 9, 11),
      truncated: false,
      goldSource: "xaus",
    });
    expect(s.text).toBe(
      pct(
        `SUI did best against gold (+12 %), ETH did worst (${MINUS}3.1 %). All lines start at 100 on 11 Oct 2025.`,
      ),
    );
  });

  it("explains truncation, the gold proxy and too few coins", () => {
    const s = buildCompareSummary({
      lines: [
        { symbol: "BTC", changePct: 1 },
        { symbol: "SUI", changePct: 0 },
      ],
      start: Date.UTC(2025, 9, 11),
      truncated: true,
      goldSource: "paxg",
    });
    expect(s.text).toContain("the first date every coin has data");
    expect(s.sentences.at(-1)).toBe(PAXG_NOTE);
    expect(s.text).toContain(pct("SUI did worst (0.0 %)"));
    expect(
      buildCompareSummary({ lines: [], start: null, truncated: false, goldSource: "xaus" }).text,
    ).toBe("Pick at least two coins to compare against gold.");
  });
});

describe("buildOneLiner", () => {
  it("combines the ratio and the 24h change", () => {
    expect(buildOneLiner(19.7912, "oz", 2.1)).toBe(`19.79 oz · ▲${NBSP}+2.1${NBSP}% 24h`);
    expect(buildOneLiner(19.7912, "g", -0.4)).toBe(`615.6 g · ▼${NBSP}${MINUS}0.4${NBSP}% 24h`);
    expect(buildOneLiner(19.7912, "oz", null)).toBe("19.79 oz");
  });
});
