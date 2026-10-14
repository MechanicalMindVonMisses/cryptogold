import { afterEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/ratio";
import { installFakeUpstream, NOW, uninstallFakeUpstream } from "./__fixtures__/setup";
import { DEFAULT_TRACKED, recordOnce, startRecorder, TRACK_WINDOW_MS } from "./recorder";
import { getStore } from "./store/price-store";

afterEach(() => uninstallFakeUpstream());

const fcaCalls = (fake: ReturnType<typeof installFakeUpstream>) =>
  fake.calls.filter((c) => c.url.includes("freecryptoapi"));

describe("recordOnce", () => {
  it("saves FreeCryptoAPI prices for tracked coins and the gold spot price", async () => {
    const fake = installFakeUpstream();
    const store = getStore();
    store.trackCoins(DEFAULT_TRACKED, NOW);
    const result = await recordOnce(store, NOW);
    expect(result).toEqual({ at: NOW, coins: 3, gold: true });
    expect(store.coinSeries("bitcoin", 0, "minute")).toEqual([
      { t: Math.floor(NOW / MINUTE_MS) * MINUTE_MS, usd: 83016 * 1.002 },
    ]);
    expect(store.goldSeries(0, "minute")[0]).toMatchObject({ usd: 4195.6, source: "xaus" });
    // One batched request for all coins.
    expect(fcaCalls(fake)).toHaveLength(1);
    expect(fcaCalls(fake)[0].url).toContain("symbol=BTC+ETH+SUI");
  });

  it("shares the minute's prices with the dashboard instead of fetching again", async () => {
    const fake = installFakeUpstream();
    const store = getStore();
    store.trackCoins(DEFAULT_TRACKED, NOW);
    await recordOnce(store, NOW);
    await recordOnce(store, NOW + 10_000);
    expect(fcaCalls(fake)).toHaveLength(1);
  });

  it("fetches a fresh price every tick, never re-recording the previous one", async () => {
    const fake = installFakeUpstream();
    const store = getStore();
    store.trackCoins(DEFAULT_TRACKED, NOW);
    // Ticks 60 s apart; the second lands a moment before the first price's 60 s cache entry expires.
    vi.setSystemTime(NOW + 300);
    await recordOnce(store, NOW + 300);
    vi.setSystemTime(NOW + 60_200);
    await recordOnce(store, NOW + 60_200);
    expect(fcaCalls(fake)).toHaveLength(2);
    expect(store.coinSeries("bitcoin", 0, "minute")).toHaveLength(2);
  });

  it("stops recording coins nobody viewed for 30 days", async () => {
    installFakeUpstream();
    const store = getStore();
    store.trackCoins([{ id: "solana", symbol: "SOL" }], NOW - TRACK_WINDOW_MS - 1);
    await recordOnce(store, NOW);
    expect(store.coinSeries("solana", 0, "minute")).toEqual([]);
    // The defaults are always recorded, viewed or not.
    expect(store.coinSeries("bitcoin", 0, "minute")).toHaveLength(1);
  });

  it("leaves a gap rather than storing stale prices when a source is down", async () => {
    installFakeUpstream({ fail: { freecryptoapi: 503 } });
    const store = getStore();
    store.trackCoins(DEFAULT_TRACKED, NOW);
    expect(await recordOnce(store, NOW)).toEqual({ at: NOW, coins: 0, gold: true });

    installFakeUpstream({ fail: { xaus: 503, freecryptoapi: 503, coingecko: 503, binance: 503 } });
    const store2 = getStore();
    store2.trackCoins(DEFAULT_TRACKED, NOW);
    expect(await recordOnce(store2, NOW)).toEqual({ at: NOW, coins: 0, gold: false });
  });

  it("records nothing for coins FreeCryptoAPI doesn't list", async () => {
    installFakeUpstream();
    const store = getStore();
    store.trackCoins([{ id: "young-coin", symbol: "YNG" }], NOW);
    expect((await recordOnce(store, NOW)).coins).toBe(DEFAULT_TRACKED.length);
    expect(store.coinSeries("young-coin", 0, "minute")).toEqual([]);
  });
});

describe("startRecorder", () => {
  it("seeds the default coins, records at once and then every interval", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    installFakeUpstream();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    startRecorder();
    startRecorder(); // idempotent
    await vi.waitFor(() => expect(getStore().coinSeries("bitcoin", 0, "minute")).toHaveLength(1));
    expect(
      getStore()
        .trackedCoins(0, 50)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["bitcoin", "ethereum", "sui"]);
    vi.setSystemTime(NOW + HOUR_MS);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(getStore().coinSeries("bitcoin", 0, "minute")).toHaveLength(2));
  });
});
