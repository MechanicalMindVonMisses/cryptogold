import { afterEach, describe, expect, it, vi } from "vitest";
import fcaData from "../__fixtures__/fca-getdata.json";
import cgMarkets from "../__fixtures__/cg-markets.json";
import cgSearch from "../__fixtures__/cg-search-sui.json";
import xausChart1y from "../__fixtures__/xaus-chart-1y-1d.json";
import xausChart3mo from "../__fixtures__/xaus-chart-3mo-1h.json";
import xausSpot from "../__fixtures__/xaus-spot.json";
import xausSpotTry from "../__fixtures__/xaus-spot-try.json";
import {
  installFakeUpstream,
  NOW,
  TEST_API_KEY,
  uninstallFakeUpstream,
} from "../__fixtures__/setup";
import { UpstreamError } from "../http";
import { ABSENT_TTL_MS, budgetUsedToday, getLivePricesCached, parseData } from "./freecryptoapi";
import { parseMarkets, parseSearch, searchCoins } from "./coingecko";
import { getGoldSpot, goldChangeOver24h } from "./gold";
import { parseXausChart, parseXausFx, parseXausSpot } from "./xaus";

afterEach(() => uninstallFakeUpstream());

describe("XAUS parsers", () => {
  it("parses spot in USD per troy ounce", () => {
    expect(parseXausSpot(xausSpot)).toEqual({
      usdPerOz: 4195.6,
      asOf: "2026-10-11T13:34:03.589Z",
      stale: false,
    });
    // A TRY response still yields the USD price.
    expect(parseXausSpot(xausSpotTry).usdPerOz).toBeCloseTo(4195.6, 3);
    expect(parseXausFx(xausSpotTry)).toMatchObject({
      rate: 49.333088,
      source: "open.er-api.com",
      stale: false,
    });
  });

  it("judges staleness by age, not by the upstream cache flag", () => {
    const cached = {
      ...xausSpot,
      stale: true,
      data_state: { status: "stale", source: "cache", age_seconds: 4 },
    };
    expect(parseXausSpot(cached).stale).toBe(false);
    expect(parseXausSpot({ ...cached, data_state: { age_seconds: 3600 } }).stale).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(() => parseXausSpot({ xau: { price: "high" } })).toThrow(UpstreamError);
    expect(() => parseXausChart({ points: "nope" })).toThrow(UpstreamError);
    expect(() => parseXausFx(xausSpot.xau)).toThrow(UpstreamError);
  });

  it("keeps daily bars on their trading date", () => {
    const points = parseXausChart(xausChart1y);
    expect(points).toHaveLength(xausChart1y.points.length);
    const last = points.at(-1)!;
    expect(new Date(last.t).toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(last.usd).toBe(4216.2998);
  });

  it("stamps hourly bars at their close and the session snapshot at its own time", () => {
    const points = parseXausChart(xausChart3mo);
    expect(points[0].t).toBe((xausChart3mo.points[0].t + 3600) * 1000);
    // The 20:59:59 Friday snapshot lands on 21:00 UTC.
    expect(new Date(points.at(-1)!.t).toISOString()).toBe("2026-10-09T21:00:00.000Z");
  });
});

describe("CoinGecko parsers", () => {
  it("maps search results with upper-case symbols and ranks", () => {
    const [first] = parseSearch(cgSearch);
    expect(first).toEqual({
      id: "sui",
      symbol: "SUI",
      name: "Sui",
      thumb: "https://coin-images.coingecko.com/coins/images/26375/thumb/sui-ocean-square.png",
      rank: 29,
    });
  });

  it("maps batched markets", () => {
    const markets = parseMarkets(cgMarkets);
    expect(markets.map((m) => m.id)).toEqual(["bitcoin", "ethereum", "sui"]);
    expect(markets[0]).toMatchObject({ symbol: "BTC", usd: 83016, change24h: 0.28244, rank: 1 });
    expect(parseMarkets([{ ...cgMarkets[0], current_price: null }])).toEqual([]);
    expect(parseMarkets([{ ...cgMarkets[0], image: "javascript:alert(1)" }])[0].image).toBeNull();
  });

  it("sends the Demo key header on every request and never returns it", async () => {
    const fake = installFakeUpstream();
    const results = await searchCoins("sui");
    expect(fake.calls[0].headers["x-cg-demo-api-key"]).toBe(TEST_API_KEY);
    expect(JSON.stringify(results)).not.toContain(TEST_API_KEY);
  });

  it("falls back to the keyless API when the key is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let first = true;
    const fake = installFakeUpstream({
      override: (url) => {
        if (url.hostname.includes("coingecko") && first) {
          first = false;
          return new Response("{}", { status: 401 });
        }
        return undefined;
      },
    });
    await expect(searchCoins("sui")).resolves.toHaveLength(4);
    expect(fake.calls[1].headers["x-cg-demo-api-key"]).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("FreeCryptoAPI parser", () => {
  it("maps symbols to USD prices stamped with our receive time", () => {
    const at = new Date(NOW);
    const prices = parseData(fcaData, at);
    expect([...prices.keys()]).toEqual(["BTC", "ETH", "SUI"]);
    expect(prices.get("BTC")).toEqual({ usd: 83126.41, asOf: at.toISOString() });
  });

  it("treats status:false and malformed bodies as upstream errors", () => {
    expect(() =>
      parseData({ status: false, error: "No access. Please upgrade your subscription" }),
    ).toThrow(UpstreamError);
    expect(() => parseData({ status: "success", symbols: "nope" })).toThrow(UpstreamError);
    expect(parseData({ status: "success", symbols: [{ symbol: "X", last: "abc" }] }).size).toBe(0);
  });
});

describe("shared FreeCryptoAPI price cache", () => {
  const fcaCalls = (fake: ReturnType<typeof installFakeUpstream>) =>
    fake.calls.filter((c) => c.url.includes("freecryptoapi"));

  it("reuses a price for up to 90 s, whoever asks", async () => {
    const fake = installFakeUpstream();
    const first = await getLivePricesCached(["BTC", "ETH"]);
    expect(first.get("BTC")).toMatchObject({ usd: 83016 * 1.002, stale: false });
    await getLivePricesCached(["eth", "btc"]);
    expect(fcaCalls(fake)).toHaveLength(1);
    // Only the new symbol is requested.
    await getLivePricesCached(["BTC", "SUI"]);
    expect(fcaCalls(fake)).toHaveLength(2);
    expect(fcaCalls(fake)[1].url).toContain("symbol=SUI");
    vi.setSystemTime(NOW + 61_000);
    await getLivePricesCached(["BTC"]);
    expect(fcaCalls(fake)).toHaveLength(2);
    // A caller can demand a younger price (the recorder does, every tick).
    await getLivePricesCached(["BTC"], 30_000);
    expect(fcaCalls(fake)).toHaveLength(3);
    vi.setSystemTime(NOW + 152_000);
    await getLivePricesCached(["BTC"]);
    expect(fcaCalls(fake)).toHaveLength(4);
  });

  it("stops calling FreeCryptoAPI once the daily budget is spent", async () => {
    const fake = installFakeUpstream();
    vi.stubEnv("FREECRYPTOAPI_DAILY_BUDGET", "2");
    const { resetConfigForTests } = await import("../config");
    resetConfigForTests();
    await getLivePricesCached(["BTC"]);
    await getLivePricesCached(["ETH"]);
    expect(budgetUsedToday()).toBe(2);
    await expect(getLivePricesCached(["SUI"])).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fcaCalls(fake)).toHaveLength(2);
    // A new UTC day brings a fresh budget.
    vi.setSystemTime(NOW + 86_400_000);
    await expect(getLivePricesCached(["SUI"])).resolves.toBeInstanceOf(Map);
  });

  it("remembers symbols FreeCryptoAPI doesn't list for an hour", async () => {
    const fake = installFakeUpstream();
    expect((await getLivePricesCached(["NOPE"])).size).toBe(0);
    vi.setSystemTime(NOW + 10 * 60_000);
    await getLivePricesCached(["NOPE"]);
    expect(fcaCalls(fake)).toHaveLength(1);
    vi.setSystemTime(NOW + ABSENT_TTL_MS + 1);
    await getLivePricesCached(["NOPE"]);
    expect(fcaCalls(fake)).toHaveLength(2);
  });

  it("returns stale copies when FreeCryptoAPI fails, and throws when it has none", async () => {
    let down = false;
    installFakeUpstream({
      override: (url) =>
        down && url.hostname.includes("freecryptoapi")
          ? new Response("{}", { status: 503 })
          : undefined,
    });
    await getLivePricesCached(["BTC"]);
    down = true;
    vi.setSystemTime(NOW + 121_000);
    expect((await getLivePricesCached(["BTC"])).get("BTC")).toMatchObject({ stale: true });
    await expect(getLivePricesCached(["ETH"])).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("GoldProvider facade", () => {
  it("uses XAUS and caches spot for 60 s", async () => {
    const fake = installFakeUpstream();
    const spot = await getGoldSpot();
    expect(spot).toMatchObject({ source: "xaus", stale: false, data: { usdPerOz: 4195.6 } });
    await getGoldSpot();
    expect(fake.calls.filter((c) => c.url.includes("xaus.com"))).toHaveLength(1);
    vi.setSystemTime(NOW + 61_000);
    await getGoldSpot();
    expect(fake.calls.filter((c) => c.url.includes("xaus.com"))).toHaveLength(2);
  });

  it("falls back to PAXG when XAUS fails", async () => {
    installFakeUpstream({ fail: { xaus: 503, freecryptoapi: 503 } });
    await expect(getGoldSpot()).resolves.toMatchObject({
      source: "paxg",
      data: { usdPerOz: 4187.36 },
    });
  });

  it("prices the PAXG fallback from FreeCryptoAPI first", async () => {
    installFakeUpstream({ fail: { xaus: 503 } });
    await expect(getGoldSpot()).resolves.toMatchObject({
      source: "paxg",
      data: { usdPerOz: 4187.36 * 1.002 },
    });
  });

  it("uses Binance PAXGUSDT when XAUS, FreeCryptoAPI and CoinGecko all fail", async () => {
    installFakeUpstream({ fail: { xaus: "network", coingecko: 500, freecryptoapi: 500 } });
    await expect(getGoldSpot()).resolves.toMatchObject({
      source: "paxg",
      data: { usdPerOz: 4187.36 * 1.001 },
    });
  });

  it("measures gold's 24h change with the last close carried forward", () => {
    const h = 3_600_000;
    const friday = Date.UTC(2026, 9, 9, 21);
    const points = [
      { t: friday - 30 * h, usd: 4000 },
      { t: friday - 20 * h, usd: 4100 },
      { t: friday, usd: 4200 },
    ];
    // Sunday: both ends resolve to Friday's close → flat.
    expect(goldChangeOver24h(points, friday + 40 * h)).toBe(0);
    expect(goldChangeOver24h(points, friday + 2 * h)).toBeCloseTo(5, 10);
    expect(goldChangeOver24h(points.slice(0, 1), friday)).toBeNull();
  });
});
