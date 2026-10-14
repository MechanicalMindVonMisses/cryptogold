import { describe, expect, it } from "vitest";
import { isLiveStale } from "./staleness";

describe("isLiveStale", () => {
  it("flags live prices older than 15 minutes", () => {
    const now = Date.UTC(2026, 9, 11, 13, 30);
    expect(isLiveStale("2026-10-11T13:20:00Z", now)).toBe(false);
    expect(isLiveStale(Date.UTC(2026, 9, 11, 13, 10), now)).toBe(true);
    expect(isLiveStale("not a date", now)).toBe(true);
  });
});
