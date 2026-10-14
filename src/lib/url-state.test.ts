import { describe, expect, it } from "vitest";
import { isCoinId, parseUrlState, serializeUrlState } from "./url-state";

describe("parseUrlState", () => {
  it("restores a shared view", () => {
    expect(parseUrlState("?coin=ethereum&range=1y&unit=g")).toEqual({
      coin: "ethereum",
      range: "1y",
      unit: "g",
    });
  });

  it("ignores invalid values", () => {
    expect(parseUrlState("?coin=ETH<script>&range=2y&unit=kg")).toEqual({});
    expect(parseUrlState("")).toEqual({});
  });

  it("parses compare lists: valid, unique, at most four, at least two", () => {
    expect(parseUrlState("?compare=bitcoin,ethereum,bitcoin,sui,solana,cardano").compare).toEqual([
      "bitcoin",
      "ethereum",
      "sui",
      "solana",
    ]);
    expect(parseUrlState("?compare=bitcoin,BAD!").compare).toBeUndefined();
  });

  it("validates coin ids", () => {
    expect(isCoinId("pax-gold")).toBe(true);
    expect(isCoinId("-x")).toBe(false);
    expect(isCoinId("a".repeat(101))).toBe(false);
    expect(isCoinId(42)).toBe(false);
  });
});

describe("serializeUrlState", () => {
  it("round-trips", () => {
    const qs = serializeUrlState({
      coin: "bitcoin",
      range: "3m",
      unit: "oz",
      compare: ["bitcoin", "ethereum"],
    });
    expect(qs).toBe("?coin=bitcoin&range=3m&unit=oz&compare=bitcoin,ethereum");
    expect(parseUrlState(qs)).toEqual({
      coin: "bitcoin",
      range: "3m",
      unit: "oz",
      compare: ["bitcoin", "ethereum"],
    });
    expect(serializeUrlState({ coin: "sui", range: "7d", unit: "g", compare: null })).toBe(
      "?coin=sui&range=7d&unit=g",
    );
  });
});
