import { describe, expect, it } from "vitest";
import { daysAvailable, effectiveRange, rangeAvailability } from "./availability";
import { DAY_MS } from "./ratio";
import type { HistoryMeta } from "./types";

const NOW = Date.UTC(2026, 9, 11);
const meta = (overrides: Partial<HistoryMeta>): HistoryMeta => ({
  coinSource: "freecryptoapi",
  goldSource: "xaus",
  availableFrom: NOW - 365 * DAY_MS,
  truncated: false,
  recordedFrom: NOW - 400 * DAY_MS,
  lastRecordedAt: NOW,
  recordingStale: false,
  goldStale: false,
  goldLastT: NOW,
  ...overrides,
});

const enabled = (map: ReturnType<typeof rangeAvailability>) =>
  Object.entries(map)
    .filter(([, v]) => v.enabled)
    .map(([k]) => k);

describe("rangeAvailability", () => {
  it("enables everything while loading or once a year is recorded", () => {
    expect(enabled(rangeAvailability(undefined, NOW))).toHaveLength(7);
    expect(enabled(rangeAvailability(meta({}), NOW))).toHaveLength(7);
  });

  it("keeps the first range that shows everything recorded and disables longer ones", () => {
    const map = rangeAvailability(meta({ truncated: true, recordedFrom: NOW - 214 * DAY_MS }), NOW);
    expect(enabled(map)).toEqual(["7d", "1m", "3m", "6m", "1y"]);
    expect(map["5y"]).toEqual({
      enabled: false,
      reason: "Only 214 days of history recorded so far",
    });

    const young = rangeAvailability(
      meta({ truncated: true, recordedFrom: NOW - 20 * DAY_MS }),
      NOW,
    );
    expect(enabled(young)).toEqual(["7d", "1m"]);
    const today = rangeAvailability(meta({ truncated: true, recordedFrom: NOW - DAY_MS / 3 }), NOW);
    expect(enabled(today)).toEqual(["7d"]);
    expect(today.max.reason).toBe("Only 1 day of history recorded so far");
    expect(daysAvailable(NOW - DAY_MS / 3, NOW)).toBe(1);
  });

  it("allows only 7D before anything is recorded", () => {
    const map = rangeAvailability(
      meta({ truncated: true, recordedFrom: null, availableFrom: null }),
      NOW,
    );
    expect(enabled(map)).toEqual(["7d"]);
    expect(map["1m"].reason).toBe("No history recorded for this coin yet");
  });
});

describe("effectiveRange", () => {
  it("falls back to the largest enabled range below the request", () => {
    const map = rangeAvailability(meta({ truncated: true, recordedFrom: NOW - 20 * DAY_MS }), NOW);
    expect(effectiveRange("1y", map)).toBe("1m");
    expect(effectiveRange("7d", map)).toBe("7d");
    expect(effectiveRange("max", rangeAvailability(meta({}), NOW))).toBe("max");
  });
});
