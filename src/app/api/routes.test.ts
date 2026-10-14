import { afterEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/ratio";
import type { GoldSource, HistoryResponse, SearchResponse, SpotResponse } from "@/lib/types";
import {
  installFakeUpstream,
  NOW,
  TEST_API_KEY,
  TEST_FCA_KEY,
  uninstallFakeUpstream,
} from "@/server/__fixtures__/setup";
import { getStore, setStoreForTests } from "@/server/store/price-store";
import { GET as fxGET } from "./fx/route";
import { GET as historyGET } from "./history/route";
import { GET as searchGET } from "./search/route";
import { GET as spotGET } from "./spot/route";

const DAY = 86_400_000;

/** Simulates the recorder: one tick every `stepMs` from `from` to `to`. */
function seedRecording(
  id: string,
  from: number,
  to: number,
  stepMs: number,
  gold: GoldSource = "xaus",
) {
  const store = getStore();
  for (let t = from; t <= to; t += stepMs) {
    store.recordTick(t, [{ id, usd: 80_000 * (1 + 0.01 * Math.sin(t / HOUR_MS)) }], {
      usdPerOz: 4000,
      source: gold,
    });
  }
}

async function call(handler: (r: Request) => Promise<Response>, path: string) {
  const res = await handler(new Request(`http://localhost${path}`));
  const text = await res.text();
  // Contract: no response ever contains the API key or upstream error bodies.
  expect(text).not.toContain(TEST_API_KEY);
  expect(text).not.toContain(TEST_FCA_KEY);
  expect(text).not.toContain("upstream secret detail");
  return { res, body: JSON.parse(text) };
}

afterEach(() => uninstallFakeUpstream());

describe("GET /api/spot", () => {
  it("combines gold spot and batched coin prices", async () => {
    const fake = installFakeUpstream();
    const { res, body } = await call(spotGET, "/api/spot?ids=bitcoin,ethereum,sui,not-a-coin");
    const spot = body as SpotResponse;
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60, stale-while-revalidate=60",
    );
    expect(spot.gold).toMatchObject({ usdPerOz: 4195.6, source: "xaus", stale: false });
    expect(spot.coins.map((c) => c.id)).toEqual(["bitcoin", "ethereum", "sui"]);
    expect(spot.missing).toEqual(["not-a-coin"]);
    // Live price from FreeCryptoAPI; identity and 24h change from CoinGecko.
    expect(spot.coins.every((c) => c.priceSource === "freecryptoapi")).toBe(true);
    expect(spot.coins[0].usd).toBeCloseTo(83016 * 1.002, 6);
    expect(spot.coins[0].ratioOz).toBeCloseTo((83016 * 1.002) / 4195.6, 10);
    expect(spot.coins[0].symbol).toBe("BTC");
    // Sunday: gold is flat over 24 h, so the ratio change equals the coin's own change.
    expect(spot.gold.change24h).toBe(0);
    expect(spot.coins[0].ratioChange24h).toBeCloseTo(0.28244, 10);
    expect(spot.coinsStale).toBe(false);
    // One CoinGecko markets call and one FreeCryptoAPI call for the whole list; key sent as a Bearer token.
    expect(fake.calls.filter((c) => c.url.includes("/coins/markets"))).toHaveLength(1);
    const live = fake.calls.filter((c) => c.url.includes("freecryptoapi"));
    expect(live).toHaveLength(1);
    expect(live[0].url).toContain("getData?symbol=BTC+ETH+SUI");
    expect(live[0].headers.authorization).toBe(`Bearer ${TEST_FCA_KEY}`);
  });

  it.each([
    "",
    "?ids=",
    "?ids=Bitcoin!",
    `?ids=${Array.from({ length: 21 }, (_, i) => `c${i}`).join(",")}`,
  ])("rejects bad input %s with 400", async (qs) => {
    installFakeUpstream();
    const { res, body } = await call(spotGET, `/api/spot${qs}`);
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid_request", source: "request" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the PAXG fallback when XAUS is down", async () => {
    installFakeUpstream({ fail: { xaus: 503 } });
    const { res, body } = await call(spotGET, "/api/spot?ids=bitcoin");
    expect(res.status).toBe(200);
    expect((body as SpotResponse).gold.source).toBe("paxg");
  });

  it("returns 502 with the error envelope when every source fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFakeUpstream({ fail: { xaus: 503, coingecko: 503, binance: 503 } });
    const { res, body } = await call(spotGET, "/api/spot?ids=bitcoin");
    expect(res.status).toBe(502);
    expect(Object.keys(body).sort()).toEqual(["error", "source"]);
    expect(body.error).toBe("upstream_unavailable");
  });

  it("serves cached prices flagged rate-limited on a CoinGecko 429 when live prices are down too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let limited = false;
    installFakeUpstream({
      override: (url) =>
        limited && url.hostname.includes("coingecko")
          ? new Response("{}", { status: 429, headers: { "retry-after": "60" } })
          : url.hostname.includes("freecryptoapi")
            ? new Response("{}", { status: 503 }) // down throughout, so prices depend on CoinGecko
            : undefined,
    });
    await call(spotGET, "/api/spot?ids=bitcoin,ethereum");
    limited = true;
    vi.setSystemTime(NOW + 6 * 60_000);
    const { res, body } = await call(spotGET, "/api/spot?ids=bitcoin,ethereum");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ coinsStale: true, rateLimited: true });
    expect((body as SpotResponse).coins).toHaveLength(2);
    expect(res.headers.get("cache-control")).toContain("max-age=15");
  });

  it("registers coins with a verified live price for recording", async () => {
    installFakeUpstream();
    await call(spotGET, "/api/spot?ids=bitcoin,young-coin,ethereum");
    // YNG isn't listed on FreeCryptoAPI, so it can't be recorded.
    expect(
      getStore()
        .trackedCoins(0, 50)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["bitcoin", "ethereum"]);
  });
});

describe("GET /api/history (recorded prices)", () => {
  it("returns recording metadata and no points before the first price is saved", async () => {
    installFakeUpstream();
    const { res, body } = await call(historyGET, "/api/history?id=bitcoin&range=7d");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(body).toMatchObject({
      points: [],
      meta: {
        coinSource: "freecryptoapi",
        recordedFrom: null,
        lastRecordedAt: null,
        truncated: true,
        recordingStale: false,
      },
    });
  });

  it("draws a brand-new coin from per-minute recordings", async () => {
    installFakeUpstream();
    seedRecording("bitcoin", NOW - 20 * MINUTE_MS, NOW, MINUTE_MS);
    const h = (await call(historyGET, "/api/history?id=bitcoin&range=7d")).body as HistoryResponse;
    expect(h.granularity).toBe("minute");
    expect(h.points).toHaveLength(21);
    expect(h.points[1].t - h.points[0].t).toBe(MINUTE_MS);
    for (const p of h.points) expect(p.ratioOz).toBeCloseTo(p.coinUsd / 4000, 12);
    expect(h.meta).toMatchObject({
      recordedFrom: Math.floor((NOW - 20 * MINUTE_MS) / MINUTE_MS) * MINUTE_MS,
      truncated: true,
    });
  });

  it("switches to hourly points once a few hours are recorded", async () => {
    installFakeUpstream();
    seedRecording("bitcoin", NOW - 10 * HOUR_MS, NOW, 10 * MINUTE_MS);
    const h = (await call(historyGET, "/api/history?id=bitcoin&range=7d")).body as HistoryResponse;
    expect(h.granularity).toBe("hour");
    expect(h.points.length).toBeGreaterThanOrEqual(10);
    expect(h.points[1].t - h.points[0].t).toBe(HOUR_MS);
    // The hour still in progress sits at its latest price (13:34), not at the top of the hour (13:00).
    expect(h.points.at(-1)!.t).toBe(NOW);
    expect(h.points.at(-2)!.t).toBe(Math.floor(NOW / HOUR_MS) * HOUR_MS - HOUR_MS);
  });

  it("builds daily closes for long ranges and marks ranges longer than the recording", async () => {
    installFakeUpstream();
    seedRecording("bitcoin", NOW - 40 * DAY, NOW, HOUR_MS);
    const year = await call(historyGET, "/api/history?id=bitcoin&range=1y");
    expect(year.res.headers.get("cache-control")).toContain("max-age=300");
    const y = year.body as HistoryResponse;
    expect(y.granularity).toBe("day");
    expect(y.points.length).toBeGreaterThanOrEqual(40);
    expect(y.points.length).toBeLessThanOrEqual(42);
    expect(y.meta.truncated).toBe(true);
    const month = (await call(historyGET, "/api/history?id=bitcoin&range=1m"))
      .body as HistoryResponse;
    expect(month.meta.truncated).toBe(false);
    const max = (await call(historyGET, "/api/history?id=bitcoin&range=max"))
      .body as HistoryResponse;
    expect(max.meta.truncated).toBe(false);
    expect(max.points.length).toBe(y.points.length);
  });

  it("flags a stopped recorder and the PAXG gold fallback", async () => {
    installFakeUpstream();
    seedRecording("bitcoin", NOW - 6 * HOUR_MS, NOW - 2 * HOUR_MS, 30 * MINUTE_MS, "paxg");
    const h = (await call(historyGET, "/api/history?id=bitcoin&range=7d")).body as HistoryResponse;
    expect(h.meta).toMatchObject({
      recordingStale: true,
      goldStale: true,
      goldSource: "paxg",
      lastRecordedAt: NOW - 2 * HOUR_MS,
    });
  });

  it("skips time when nothing was recorded instead of inventing prices", async () => {
    installFakeUpstream();
    seedRecording("bitcoin", NOW - 30 * HOUR_MS, NOW - 25 * HOUR_MS, HOUR_MS);
    seedRecording("bitcoin", NOW - 5 * HOUR_MS, NOW, HOUR_MS);
    const h = (await call(historyGET, "/api/history?id=bitcoin&range=7d")).body as HistoryResponse;
    expect(h.points).toHaveLength(12);
    expect(h.points[6].t - h.points[5].t).toBe(20 * HOUR_MS);
  });

  it.each(["?id=bitcoin&range=2y", "?id=&range=1y", "?range=1y", "?id=../etc&range=1y"])(
    "400 for %s",
    async (qs) => {
      installFakeUpstream();
      const { res } = await call(historyGET, `/api/history${qs}`);
      expect(res.status).toBe(400);
    },
  );

  it("500 with a storage error when the database can't be opened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installFakeUpstream();
    setStoreForTests(null);
    // A directory can't be created inside a file, so opening this path fails.
    vi.stubEnv("AURATIO_DB_PATH", "package.json/auratio.db");
    const { resetConfigForTests } = await import("@/server/config");
    resetConfigForTests();
    const { res, body } = await call(historyGET, "/api/history?id=bitcoin&range=7d");
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "storage_unavailable", source: "storage" });
  });
});

describe("GET /api/search and /api/fx", () => {
  it("searches coins with a 24 h cache header", async () => {
    installFakeUpstream();
    const { res, body } = await call(searchGET, "/api/search?q=sui");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect((body as SearchResponse).results[0]).toMatchObject({
      id: "sui",
      symbol: "SUI",
      rank: 29,
    });
  });

  it.each(["?q=s", `?q=${"x".repeat(51)}`, ""])("400 for %s", async (qs) => {
    installFakeUpstream();
    expect((await call(searchGET, `/api/search${qs}`)).res.status).toBe(400);
  });

  it("returns the TRY rate", async () => {
    installFakeUpstream();
    const { body } = await call(fxGET, "/api/fx?currency=TRY");
    expect(body).toMatchObject({ currency: "TRY", rate: 49.333088 });
    expect((await call(fxGET, "/api/fx?currency=EUR")).res.status).toBe(400);
  });

  it("returns 500 with a readable server log when the key is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installFakeUpstream();
    vi.stubEnv("FREECRYPTOAPI_KEY", "");
    const { resetConfigForTests } = await import("@/server/config");
    resetConfigForTests();
    const { res, body } = await call(searchGET, "/api/search?q=sui");
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "server_misconfigured", source: "config" });
    expect(error.mock.calls[0][0]).toContain("FREECRYPTOAPI_KEY");
    expect(error.mock.calls[0][0]).toContain(".env.local");
  });
});

describe("public-site protection", () => {
  it("limits each visitor to 120 requests in a burst, then answers 429 with Retry-After", async () => {
    installFakeUpstream();
    const req = (ip: string) =>
      new Request("http://localhost/api/search?q=sui", { headers: { "cf-connecting-ip": ip } });
    for (let i = 0; i < 120; i++) expect((await searchGET(req("203.0.113.7"))).status).toBe(200);
    const limited = await searchGET(req("203.0.113.7"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(await limited.json()).toEqual({ error: "rate_limited", source: "auratio" });
    // Other visitors are unaffected, and the bucket refills.
    expect((await searchGET(req("198.51.100.2"))).status).toBe(200);
    vi.setSystemTime(NOW + 1_000);
    expect((await searchGET(req("203.0.113.7"))).status).toBe(200);
  });

  it("falls back to CoinGecko prices when the FreeCryptoAPI budget is spent", async () => {
    installFakeUpstream();
    vi.stubEnv("FREECRYPTOAPI_DAILY_BUDGET", "1");
    const { resetConfigForTests } = await import("@/server/config");
    resetConfigForTests();
    await call(spotGET, "/api/spot?ids=bitcoin");
    const { body } = await call(spotGET, "/api/spot?ids=ethereum");
    expect((body as SpotResponse).coins[0]).toMatchObject({
      id: "ethereum",
      priceSource: "coingecko",
    });
  });
});

describe("FreeCryptoAPI live prices", () => {
  it("keeps prices live when only CoinGecko is rate-limited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let limited = false;
    installFakeUpstream({
      override: (url) =>
        limited && url.hostname.includes("coingecko")
          ? new Response("{}", { status: 429, headers: { "retry-after": "60" } })
          : undefined,
    });
    await call(spotGET, "/api/spot?ids=bitcoin");
    limited = true;
    vi.setSystemTime(NOW + 6 * 60_000);
    const { body } = await call(spotGET, "/api/spot?ids=bitcoin");
    expect(body).toMatchObject({
      rateLimited: false,
      coins: [{ id: "bitcoin", priceSource: "freecryptoapi" }],
    });
  });

  it.each([
    ["is down", () => new Response("{}", { status: 503 })],
    [
      "refuses the request",
      () => Response.json({ status: false, error: "No access. Please upgrade your subscription" }),
    ],
  ])("falls back to CoinGecko prices when FreeCryptoAPI %s", async (_label, respond) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFakeUpstream({
      override: (url) => (url.hostname.includes("freecryptoapi") ? respond() : undefined),
    });
    const { res, body } = await call(spotGET, "/api/spot?ids=bitcoin,ethereum");
    expect(res.status).toBe(200);
    const spot = body as SpotResponse;
    expect(spot.coins.map((c) => c.priceSource)).toEqual(["coingecko", "coingecko"]);
    expect(spot.coins[0].usd).toBe(83016);
    expect(JSON.stringify(body)).not.toContain("upgrade");
  });

  it("ignores a live price whose symbol belongs to a different coin", async () => {
    installFakeUpstream({
      override: (url) =>
        url.hostname.includes("freecryptoapi")
          ? Response.json({
              status: "success",
              symbols: [
                { symbol: "BTC", last: "0.0042" },
                { symbol: "ETH", last: "2510" },
              ],
            })
          : undefined,
    });
    const { body } = await call(spotGET, "/api/spot?ids=bitcoin,ethereum");
    const spot = body as SpotResponse;
    expect(spot.coins[0]).toMatchObject({ id: "bitcoin", priceSource: "coingecko", usd: 83016 });
    expect(spot.coins[1]).toMatchObject({
      id: "ethereum",
      priceSource: "freecryptoapi",
      usd: 2510,
    });
  });

  it("refreshes CoinGecko identity every 5 minutes and live prices after 90 s", async () => {
    const fake = installFakeUpstream();
    await call(spotGET, "/api/spot?ids=bitcoin");
    vi.setSystemTime(NOW + 91_000);
    await call(spotGET, "/api/spot?ids=bitcoin");
    expect(fake.calls.filter((c) => c.url.includes("freecryptoapi"))).toHaveLength(2);
    expect(fake.calls.filter((c) => c.url.includes("/coins/markets"))).toHaveLength(1);
  });

  it("works without a CoinGecko key (keyless public API)", async () => {
    const fake = installFakeUpstream();
    vi.stubEnv("COINGECKO_DEMO_API_KEY", "");
    const { resetConfigForTests } = await import("@/server/config");
    resetConfigForTests();
    const { res } = await call(searchGET, "/api/search?q=sui");
    expect(res.status).toBe(200);
    expect(fake.calls.at(-1)!.headers["x-cg-demo-api-key"]).toBeUndefined();
  });
});
