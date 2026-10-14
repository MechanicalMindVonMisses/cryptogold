import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATCHLIST,
  initialState,
  MAX_WATCHLIST,
  reducer,
  sanitizeMeta,
  sanitizeSettings,
  sanitizeWatchlist,
  type Action,
  type DashboardState,
} from "./dashboard-state";

const run = (actions: Action[], state: DashboardState = initialState) =>
  actions.reduce(reducer, state);
const hydrated = (overrides: Partial<Extract<Action, { type: "hydrate" }>> = {}) =>
  reducer(initialState, {
    type: "hydrate",
    settings: undefined,
    watchlist: undefined,
    meta: undefined,
    url: {},
    ...overrides,
  });

describe("hydration", () => {
  it("falls back to defaults for missing or corrupt storage", () => {
    for (const bad of [
      undefined,
      null,
      "oops",
      42,
      { ids: "bitcoin" },
      { ids: [] },
      { ids: ["BAD ID!"] },
    ]) {
      expect(sanitizeWatchlist(bad)).toEqual([...DEFAULT_WATCHLIST]);
    }
    expect(sanitizeSettings("garbage")).toEqual({
      unit: "oz",
      theme: "system",
      displayCurrency: "USD",
    });
    const s = hydrated({ watchlist: { ids: 7 } });
    expect(s).toMatchObject({
      hydrated: true,
      watchlist: ["bitcoin", "ethereum", "sui"],
      coin: "bitcoin",
      range: "1y",
    });
  });

  it("restores stored settings and watchlist, deduplicated and capped", () => {
    const ids = [...Array.from({ length: 25 }, (_, i) => `coin-${i}`), "coin-1"];
    const s = hydrated({
      settings: { unit: "g", theme: "dark", displayCurrency: "TRY" },
      watchlist: { ids },
    });
    expect(s.settings).toEqual({ unit: "g", theme: "dark", displayCurrency: "TRY" });
    expect(s.watchlist).toHaveLength(MAX_WATCHLIST);
    expect(new Set(s.watchlist).size).toBe(MAX_WATCHLIST);
    expect(s.coin).toBe("coin-0");
  });

  it("lets a shared URL override coin, range, unit and compare", () => {
    const s = hydrated({
      settings: { unit: "oz" },
      url: { coin: "ethereum", range: "5y", unit: "g", compare: ["bitcoin", "ethereum"] },
    });
    expect(s).toMatchObject({
      coin: "ethereum",
      range: "5y",
      settings: { unit: "g" },
      compare: { on: true, ids: ["bitcoin", "ethereum"] },
    });
  });

  it("keeps only well-formed coin metadata with https images", () => {
    const meta = sanitizeMeta({
      solana: { symbol: "SOL", name: "Solana", image: "https://x/sol.png" },
      evil: { symbol: "EVL", name: "Evil", image: "javascript:alert(1)" },
      "BAD ID": { symbol: "X", name: "X", image: null },
      broken: { symbol: 1 },
    });
    expect(meta.solana.image).toBe("https://x/sol.png");
    expect(meta.evil.image).toBeNull();
    expect(meta["BAD ID"]).toBeUndefined();
    expect(meta.broken).toBeUndefined();
    expect(meta.bitcoin.symbol).toBe("BTC");
  });
});

describe("watchlist", () => {
  const base = hydrated();

  it("adds coins once, up to 20", () => {
    let s = run(
      [
        { type: "addToWatchlist", id: "solana" },
        { type: "addToWatchlist", id: "solana" },
      ],
      base,
    );
    expect(s.watchlist).toEqual(["bitcoin", "ethereum", "sui", "solana"]);
    for (let i = 0; i < 30; i++) s = reducer(s, { type: "addToWatchlist", id: `c-${i}` });
    expect(s.watchlist).toHaveLength(MAX_WATCHLIST);
    expect(reducer(s, { type: "addToWatchlist", id: "BAD!" })).toBe(s);
  });

  it("removes coins and drops them from the compare set", () => {
    const s = run(
      [{ type: "toggleCompare" }, { type: "removeFromWatchlist", id: "ethereum" }],
      base,
    );
    expect(s.watchlist).toEqual(["bitcoin", "sui"]);
    expect(s.compare.ids).toEqual(["bitcoin", "sui"]);
  });

  it("reorders by index and by one step", () => {
    expect(reducer(base, { type: "reorderWatchlist", from: 0, to: 2 }).watchlist).toEqual([
      "ethereum",
      "sui",
      "bitcoin",
    ]);
    expect(reducer(base, { type: "moveWatchlist", id: "sui", delta: -1 }).watchlist).toEqual([
      "bitcoin",
      "sui",
      "ethereum",
    ]);
    expect(reducer(base, { type: "moveWatchlist", id: "bitcoin", delta: -1 })).toBe(base);
    expect(reducer(base, { type: "reorderWatchlist", from: 5, to: 0 })).toBe(base);
  });
});

describe("view and compare", () => {
  const base = hydrated();

  it("selects coins, ranges and units", () => {
    const s = run(
      [
        { type: "selectCoin", id: "solana", meta: { symbol: "SOL", name: "Solana", image: null } },
        { type: "setRange", range: "7d" },
        { type: "setUnit", unit: "g" },
        { type: "setCurrency", currency: "TRY" },
        { type: "setLogScale", on: true },
      ],
      base,
    );
    expect(s).toMatchObject({
      coin: "solana",
      range: "7d",
      settings: { unit: "g", displayCurrency: "TRY" },
      logScale: true,
    });
    expect(s.meta.solana.symbol).toBe("SOL");
    expect(reducer(s, { type: "selectCoin", id: "../x" })).toBe(s);
  });

  it("starts compare with the first three coins and caps it at four", () => {
    let s = reducer(base, { type: "toggleCompare" });
    expect(s.compare).toEqual({ on: true, ids: ["bitcoin", "ethereum", "sui"] });
    s = run(
      [
        { type: "toggleCompareId", id: "solana" },
        { type: "toggleCompareId", id: "cardano" },
      ],
      s,
    );
    expect(s.compare.ids).toEqual(["bitcoin", "ethereum", "sui", "solana"]);
    s = reducer(s, { type: "toggleCompareId", id: "ethereum" });
    expect(s.compare.ids).toEqual(["bitcoin", "sui", "solana"]);
    // Leaving and re-entering compare keeps the selection.
    s = run([{ type: "toggleCompare" }, { type: "toggleCompare" }], s);
    expect(s.compare).toEqual({ on: true, ids: ["bitcoin", "sui", "solana"] });
  });

  it("only updates metadata when something changed", () => {
    const same = reducer(base, {
      type: "rememberMeta",
      entries: { bitcoin: { symbol: "BTC", name: "Bitcoin", image: null } },
    });
    expect(same).toBe(base);
    const changed = reducer(base, {
      type: "rememberMeta",
      entries: { bitcoin: { symbol: "BTC", name: "Bitcoin", image: "https://i/b.png" } },
    });
    expect(changed.meta.bitcoin.image).toBe("https://i/b.png");
  });
});
