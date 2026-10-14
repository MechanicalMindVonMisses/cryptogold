import { describe, expect, it } from "vitest";
import {
  axisFormatter,
  countWords,
  displayScale,
  formatAmount,
  formatChange,
  formatClock,
  formatDate,
  formatMoney,
  formatMonthYear,
  formatPctMagnitude,
  formatPointTime,
  formatRatio,
  formatRatioLong,
  formatSignificant,
  formatWeekday,
  MINUS,
  NBSP,
} from "./format";
import { GRAMS_PER_TROY_OUNCE } from "./ratio";

describe("formatAmount (PRD §7.2 magnitude bands)", () => {
  it.each([
    [615.5745, "615.6"],
    [12_345.67, "12,345.7"],
    [100, "100.0"],
    [19.7912, "19.79"],
    [1, "1.00"],
    [0.59661, "0.5966"],
    [0.0123456, "0.01235"],
    [0.01, "0.01"],
    [0.5, "0.5"],
    [0.00091234, "0.000912"],
    [4.3e-9, "4.3e-9"],
    [0, "0"],
    [Number.NaN, "—"],
    [Number.POSITIVE_INFINITY, "—"],
  ])("%s → %s", (value, expected) => {
    expect(formatAmount(value)).toBe(expected);
  });

  it("keeps significant digits without exponent for normal magnitudes", () => {
    expect(formatSignificant(0.000123456, 3)).toBe("0.000123");
    expect(formatSignificant(2.1, 3)).toBe("2.1");
    expect(formatSignificant(-0.5, 2)).toBe("-0.5");
  });
});

describe("formatRatio", () => {
  it("formats the BTC example in ounces and grams", () => {
    expect(formatRatio(19.7912, "oz").text).toBe("19.79 oz");
    expect(formatRatio(19.7912, "g").text).toBe("615.6 g");
  });

  it("switches tiny gram values to milligrams", () => {
    const ratioOz = 0.0021 / GRAMS_PER_TROY_OUNCE;
    expect(formatRatio(ratioOz, "g")).toEqual({ value: "2.1", unit: "mg", text: "2.1 mg" });
    expect(formatRatioLong(ratioOz, "g")).toBe("0.0021 g = 2.1 mg");
    expect(formatRatioLong(1, "oz")).toBe("1.00 oz");
  });

  it("uses compact notation for micro-cap ounce values", () => {
    expect(formatRatio(0.0000291, "oz").text).toBe("0.0000291 oz");
    expect(formatRatio(4.3e-9, "oz").text).toBe("4.3e-9 oz");
  });
});

describe("axisFormatter", () => {
  it("adds decimals only when the series barely moves", () => {
    expect(axisFormatter(12, 28)(19.8135)).toBe("19.81");
    expect(axisFormatter(19.8131, 19.8152)(19.8135)).toBe("19.8135");
    expect(axisFormatter(600, 620)(615.53)).toBe("615.5");
    expect(axisFormatter(0.000261, 0.000264)(0.0002625)).toBe("0.0002625");
    expect(axisFormatter(5, 5)(5)).toBe("5.00");
  });
});

describe("displayScale", () => {
  it("draws micro-caps in milligrams and everything else in the chosen unit", () => {
    expect(displayScale(19.79, "oz")).toEqual({ unit: "oz", factor: 1 });
    expect(displayScale(19.79, "g")).toEqual({ unit: "g", factor: GRAMS_PER_TROY_OUNCE });
    expect(displayScale(0.000292, "g")).toEqual({
      unit: "mg",
      factor: GRAMS_PER_TROY_OUNCE * 1000,
    });
    expect(displayScale(0.000292, "oz").unit).toBe("oz");
  });
});

describe("percent formatting", () => {
  it.each([
    [8.44, "up", "▲", `+8.4${NBSP}%`],
    [-3.06, "down", "▼", `${MINUS}3.1${NBSP}%`],
    [0.04, "flat", "■", `0.0${NBSP}%`],
  ])("%s → %s %s", (pct, direction, arrow, text) => {
    expect(formatChange(pct)).toMatchObject({ direction, arrow, text });
  });

  it("describes changes for screen readers and handles missing values", () => {
    expect(formatChange(2.1).label).toBe("up 2.1 percent");
    expect(formatChange(null)).toMatchObject({ text: "—", label: "not available" });
    expect(formatChange(Number.NaN).text).toBe("—");
  });

  it("uses one decimal below 10 % and whole numbers above", () => {
    expect(formatPctMagnitude(8.44)).toBe("8.4");
    expect(formatPctMagnitude(12.4)).toBe("12");
    expect(formatPctMagnitude(-12.6)).toBe("13");
  });
});

describe("formatMoney", () => {
  it.each([
    [83_039, "USD", "$83,039"],
    [4195.6, "USD", "$4,195.60"],
    [134.8917, "USD", "$134.89"],
    [0.123456, "USD", "$0.1235"],
    [206_981.91, "TRY", "₺206,982"],
    [-5, "USD", `${MINUS}$5.00`],
  ] as const)("%s %s → %s", (value, currency, expected) => {
    expect(formatMoney(value, currency)).toBe(expected);
  });

  it("returns a dash for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
  });
});

describe("dates", () => {
  const friday = Date.UTC(2026, 9, 9, 4);
  it("formats UTC dates, months and weekdays", () => {
    expect(formatDate(Date.UTC(2026, 2, 3))).toBe("3 Mar 2026");
    expect(formatMonthYear(Date.UTC(2017, 7, 17))).toBe("Aug 2017");
    expect(formatWeekday(friday)).toBe("Fri");
  });

  it("formats hourly points with time in the given zone", () => {
    expect(formatPointTime(Date.UTC(2026, 9, 11, 13), "hour", "UTC")).toBe("11 Oct 2026, 13:00");
    expect(formatPointTime(Date.UTC(2026, 9, 11), "day")).toBe("11 Oct 2026");
    expect(formatClock("2026-10-11T13:23:00Z", "Europe/Istanbul")).toBe("16:23");
  });

  it("counts words", () => {
    expect(countWords(" one  two\nthree ")).toBe(3);
  });
});
