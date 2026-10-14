import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/ratio";
import { MINUTE_RETENTION_MS, PriceStore, resolveDbPath, StorageError } from "./price-store";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fileStore() {
  const dir = mkdtempSync(join(tmpdir(), "auratio-store-"));
  tempDirs.push(dir);
  const path = join(dir, "auratio.db");
  return { dir, path, store: new PriceStore(path) };
}

describe("PriceStore durability (file-backed)", () => {
  it("checkpoints recorded data into the main file and keeps it across reopening", () => {
    const { path, store: s } = fileStore();
    for (let i = 0; i < 30; i++) {
      s.recordTick(Date.UTC(2026, 9, 11, 13, i), [{ id: "bitcoin", usd: 80_000 + i }], {
        usdPerOz: 4000,
        source: "xaus",
      });
    }
    s.checkpoint();
    expect(statSync(`${path}-wal`).size).toBe(0);
    expect(statSync(path).size).toBeGreaterThan(4096);
    s.close();
    // Even with the log gone, the main file alone has everything.
    rmSync(`${path}-wal`, { force: true });
    const reopened = new PriceStore(path);
    expect(reopened.coinSeries("bitcoin", 0, "minute")).toHaveLength(30);
    reopened.close();
  });

  it("writes one backup a day and keeps the newest seven, touching nothing else", () => {
    const { dir, store: s } = fileStore();
    s.recordTick(Date.UTC(2026, 9, 11, 13, 0), [{ id: "bitcoin", usd: 1 }], null);
    const first = s.dailyBackup(Date.UTC(2026, 9, 1, 12));
    expect(first).toBe(join(dir, "backups", "auratio-2026-10-01.db"));
    expect(s.dailyBackup(Date.UTC(2026, 9, 1, 18))).toBeNull(); // same day
    const copy = new PriceStore(first!);
    expect(copy.coinSeries("bitcoin", 0, "minute")).toHaveLength(1);
    copy.close();

    writeFileSync(join(dir, "backups", "notes.txt"), "keep me");
    for (let d = 2; d <= 10; d++) s.dailyBackup(Date.UTC(2026, 9, 1, 12) + (d - 1) * DAY_MS);
    const left = readdirSync(join(dir, "backups")).sort();
    expect(left.filter((f) => f.endsWith(".db"))).toEqual(
      [4, 5, 6, 7, 8, 9, 10].map((d) => `auratio-2026-10-${String(d).padStart(2, "0")}.db`),
    );
    expect(left).toContain("notes.txt");
    s.close();
  });

  it("does nothing for in-memory stores", () => {
    const s = new PriceStore(":memory:");
    expect(s.dailyBackup()).toBeNull();
    s.checkpoint();
    s.close();
    expect(existsSync(join(process.cwd(), "backups"))).toBe(false);
  });
});

const T0 = Date.UTC(2026, 9, 11, 13, 0, 0);

let store: PriceStore;
beforeEach(() => {
  store = new PriceStore(":memory:");
});
afterEach(() => store.close());

describe("PriceStore", () => {
  it("tracks coins and refreshes their last-requested time", () => {
    expect(store.hasTrackedCoins()).toBe(false);
    store.trackCoins([{ id: "bitcoin", symbol: "btc" }], T0);
    store.trackCoins([{ id: "sui", symbol: "SUI" }], T0 + 1000);
    store.trackCoins([{ id: "bitcoin", symbol: "BTC" }], T0 + 2000);
    expect(store.trackedCoins(0, 10)).toEqual([
      { id: "bitcoin", symbol: "BTC", lastRequested: T0 + 2000 },
      { id: "sui", symbol: "SUI", lastRequested: T0 + 1000 },
    ]);
    expect(store.trackedCoins(T0 + 1500, 10).map((c) => c.id)).toEqual(["bitcoin"]);
    expect(store.trackedCoins(0, 1)).toHaveLength(1);
  });

  it("stores minute rows and keeps each hour's latest price", () => {
    store.recordTick(T0 + 5 * MINUTE_MS + 3000, [{ id: "bitcoin", usd: 100 }], {
      usdPerOz: 4000,
      source: "xaus",
    });
    store.recordTick(T0 + 40 * MINUTE_MS, [{ id: "bitcoin", usd: 110 }], {
      usdPerOz: 4010,
      source: "xaus",
    });
    store.recordTick(T0 + HOUR_MS + MINUTE_MS, [{ id: "bitcoin", usd: 120 }], {
      usdPerOz: 4020,
      source: "paxg",
    });

    expect(store.coinSeries("bitcoin", 0, "minute")).toEqual([
      { t: T0 + 5 * MINUTE_MS, usd: 100 },
      { t: T0 + 40 * MINUTE_MS, usd: 110 },
      { t: T0 + 61 * MINUTE_MS, usd: 120 },
    ]);
    expect(store.coinSeries("bitcoin", 0, "hour")).toEqual([
      { t: T0, usd: 110 },
      { t: T0 + HOUR_MS, usd: 120 },
    ]);
    expect(store.goldSeries(0, "hour")).toEqual([
      { t: T0, usd: 4010, source: "xaus" },
      { t: T0 + HOUR_MS, usd: 4020, source: "paxg" },
    ]);
    expect(store.coinSeries("bitcoin", T0 + HOUR_MS, "hour")).toHaveLength(1);
    expect(store.coinSeries("ethereum", 0, "hour")).toEqual([]);
  });

  it("never lets an older observation overwrite a newer hourly close", () => {
    store.recordTick(T0 + 50 * MINUTE_MS, [{ id: "bitcoin", usd: 200 }], null);
    store.recordTick(T0 + 10 * MINUTE_MS, [{ id: "bitcoin", usd: 150 }], null);
    expect(store.coinSeries("bitcoin", 0, "hour")).toEqual([{ t: T0, usd: 200 }]);
  });

  it("skips invalid prices and missing gold", () => {
    store.recordTick(
      T0,
      [
        { id: "bitcoin", usd: 0 },
        { id: "eth", usd: Number.NaN },
      ],
      null,
    );
    expect(store.coinSeries("bitcoin", 0, "minute")).toEqual([]);
    expect(store.goldLast()).toBeNull();
  });

  it("reports when recording started and the latest saved price", () => {
    expect(store.coinRange("bitcoin")).toEqual({ first: null, last: null });
    store.recordTick(T0 + 37 * MINUTE_MS, [{ id: "bitcoin", usd: 1 }], {
      usdPerOz: 1,
      source: "xaus",
    });
    store.recordTick(T0 + 3 * HOUR_MS, [{ id: "bitcoin", usd: 2 }], {
      usdPerOz: 1,
      source: "xaus",
    });
    expect(store.coinRange("bitcoin")).toEqual({
      first: T0 + 37 * MINUTE_MS,
      last: T0 + 3 * HOUR_MS,
    });
    expect(store.goldLast()).toBe(T0 + 3 * HOUR_MS);
  });

  it("prunes old minute rows but keeps hourly closes forever", () => {
    const old = T0 - MINUTE_RETENTION_MS - HOUR_MS;
    store.recordTick(old, [{ id: "bitcoin", usd: 1 }], { usdPerOz: 1, source: "xaus" });
    store.recordTick(T0, [{ id: "bitcoin", usd: 2 }], { usdPerOz: 1, source: "xaus" });
    store.pruneMinutes(T0 - MINUTE_RETENTION_MS);
    expect(store.coinSeries("bitcoin", 0, "minute")).toEqual([{ t: T0, usd: 2 }]);
    expect(store.coinSeries("bitcoin", 0, "hour")).toHaveLength(2);
    expect(store.goldSeries(0, "minute")).toHaveLength(1);
    // After pruning, the first hourly bucket marks the start of recording.
    expect(store.coinRange("bitcoin").first).toBe(Math.floor(old / HOUR_MS) * HOUR_MS);
  });

  it("reports an unusable database path as a StorageError", () => {
    expect(() => new PriceStore("\0bad/path.db")).toThrow(StorageError);
    expect(resolveDbPath(":memory:")).toBe(":memory:");
    expect(resolveDbPath("data/x.db")).toMatch(/data[\\/]x\.db$/);
  });
});
