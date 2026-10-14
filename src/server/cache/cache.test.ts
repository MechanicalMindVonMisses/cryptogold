import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedFetch, clearCacheForTests, peekCache, primeCache, TtlLruCache } from "./cache";

beforeEach(() => {
  clearCacheForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 11, 12));
});
afterEach(() => vi.useRealTimers());

describe("cachedFetch", () => {
  it("serves a fresh value until the TTL expires", async () => {
    const fn = vi.fn(async () => Math.random());
    const a = await cachedFetch("k", 60_000, fn);
    vi.advanceTimersByTime(59_000);
    const b = await cachedFetch("k", 60_000, fn);
    expect(b.value).toBe(a.value);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await cachedFetch("k", 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical requests into one upstream call", async () => {
    let release!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>((r) => (release = r)));
    const p1 = cachedFetch("same", 1000, fn);
    const p2 = cachedFetch("same", 1000, fn);
    release(42);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1.value).toBe(42);
    expect(r2.value).toBe(42);
  });

  it("returns the last value flagged stale when a refresh fails", async () => {
    await cachedFetch("s", 1000, async () => "old");
    vi.advanceTimersByTime(5000);
    const boom = new Error("upstream down");
    const r = await cachedFetch("s", 1000, async () => {
      throw boom;
    });
    expect(r).toMatchObject({ value: "old", stale: true, error: boom });
  });

  it("propagates the error when nothing is cached", async () => {
    await expect(
      cachedFetch("none", 1000, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });

  it("primes and peeks entries", async () => {
    primeCache("p", { a: 1 }, 1000);
    expect(peekCache("p")).toMatchObject({ value: { a: 1 }, stale: false });
    vi.advanceTimersByTime(2000);
    expect(peekCache("p")).toMatchObject({ stale: true });
    expect(peekCache("missing")).toBeUndefined();
  });
});

describe("TtlLruCache", () => {
  it("evicts the least recently used entry beyond its bound", () => {
    const cache = new TtlLruCache(2);
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.get("a"); // a becomes most recent
    cache.set("c", 3, 1000);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.size).toBe(2);
  });

  it("forgets entries that have been expired longer than the stale window", () => {
    const cache = new TtlLruCache(10, 5000);
    const now = Date.now();
    cache.set("x", 1, 1000, now);
    expect(cache.get("x", now + 5999)?.value).toBe(1);
    expect(cache.get("x", now + 6001)).toBeUndefined();
  });
});
