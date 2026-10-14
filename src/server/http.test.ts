import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  fetchJson,
  isRateLimited,
  parseRetryAfter,
  resetBreakersForTests,
  UpstreamError,
} from "./http";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("secret upstream body with api_key=abc", { status: code, headers });

function sequence(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return fn as unknown as typeof fetch & typeof fn;
}

describe("fetchJson", () => {
  let sleeps: number[];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  beforeEach(() => {
    sleeps = [];
    resetBreakersForTests();
  });

  it("returns parsed JSON and sends accept + custom headers", async () => {
    const fetchImpl = sequence(ok({ a: 1 }));
    await expect(
      fetchJson("https://x.test", { source: "x", fetchImpl, headers: { k: "v" } }),
    ).resolves.toEqual({ a: 1 });
    const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].headers).toMatchObject({ accept: "application/json", k: "v" });
  });

  it("retries 5xx with exponential backoff (1 s, 2 s)", async () => {
    const fetchImpl = sequence(status(503), status(502), ok({ done: true }));
    await expect(fetchJson("https://x.test", { source: "x", fetchImpl, sleep })).resolves.toEqual({
      done: true,
    });
    expect(sleeps).toEqual([1000, 2000]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured retries with a retryable UpstreamError", async () => {
    const fetchImpl = sequence(status(503), status(503), status(503));
    const err = (await fetchJson("https://x.test", { source: "xaus", fetchImpl, sleep }).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ source: "xaus", status: 503, retryable: true, kind: "http" });
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("api_key");
  });

  it("retries network errors", async () => {
    const fetchImpl = sequence(new TypeError("fetch failed"), ok([1]));
    await expect(fetchJson("https://x.test", { source: "x", fetchImpl, sleep })).resolves.toEqual([
      1,
    ]);
    expect(sleeps).toEqual([1000]);
  });

  it("honours a short Retry-After on 429", async () => {
    const fetchImpl = sequence(status(429, { "retry-after": "2" }), ok({ ok: 1 }));
    await expect(fetchJson("https://x.test", { source: "cg", fetchImpl, sleep })).resolves.toEqual({
      ok: 1,
    });
    expect(sleeps).toEqual([2000]);
    expect(isRateLimited("cg")).toBe(false);
  });

  it("opens the breaker on a long Retry-After and fails fast afterwards", async () => {
    const fetchImpl = sequence(status(429, { "retry-after": "60" }));
    const err = await fetchJson("https://x.test", { source: "cg", fetchImpl, sleep }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ status: 429, kind: "rate_limited", rateLimited: true });
    expect(isRateLimited("cg")).toBe(true);
    const second = await fetchJson("https://x.test", { source: "cg", fetchImpl, sleep }).catch(
      (e) => e,
    );
    expect(second).toMatchObject({ kind: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isRateLimited("other")).toBe(false);
  });

  it("does not retry other 4xx responses", async () => {
    const fetchImpl = sequence(status(404));
    await expect(
      fetchJson("https://x.test", { source: "x", fetchImpl, sleep }),
    ).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON without retrying", async () => {
    const fetchImpl = sequence(new Response("<html>", { status: 200 }));
    await expect(
      fetchJson("https://x.test", { source: "x", fetchImpl, sleep }),
    ).rejects.toMatchObject({ kind: "parse" });
  });

  describe("timeouts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("aborts a hanging request after timeoutMs", async () => {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ) as unknown as typeof fetch;
      const pending = fetchJson("https://x.test", {
        source: "x",
        fetchImpl,
        retries: 0,
        timeoutMs: 8000,
      }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toMatchObject({ kind: "timeout", retryable: true });
    });
  });
});

describe("backoff helpers", () => {
  it("doubles up to 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("parses Retry-After seconds and dates", () => {
    const now = Date.UTC(2026, 9, 11, 12);
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
