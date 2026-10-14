// Price history from AuRatio's own recordings (FreeCryptoAPI coin prices + XAUS gold, saved every
// minute by the recorder). Nothing here calls an upstream: history only exists from the moment a coin
// started being recorded.

import { RANGES } from "@/lib/ranges";
import { bucketStart, buildRatioSeries, DAY_MS, HOUR_MS } from "@/lib/ratio";
import { LIVE_STALE_MS } from "@/lib/staleness";
import type { Granularity, HistoryResponse, RangeKey } from "@/lib/types";
import { getStore, type PriceStore, type Resolution } from "../store/price-store";

/** Below this many hourly points, 7D/1M are drawn from per-minute recordings so a new coin shows up quickly. */
export const MIN_HOURLY_POINTS = 3;

export function getHistory(
  id: string,
  range: RangeKey,
  now = Date.now(),
  store: PriceStore = getStore(),
): HistoryResponse {
  const spec = RANGES[range];
  const windowStart = spec.days === null ? 0 : now - spec.days * DAY_MS;

  let granularity: Granularity = spec.granularity;
  let resolution: Resolution = "hour";
  let coin = store.coinSeries(id, windowStart, "hour");
  if (spec.granularity === "hour" && coin.length < MIN_HOURLY_POINTS) {
    const minutes = store.coinSeries(id, windowStart, "minute");
    if (minutes.length > coin.length) {
      coin = minutes;
      granularity = "minute";
      resolution = "minute";
    }
  }
  // Start gold an hour early so the first coin point always has a gold price to pair with.
  const gold = store.goldSeries(windowStart - HOUR_MS, resolution);
  const points = buildRatioSeries(coin, gold, granularity);

  const { first, last } = store.coinRange(id);
  // The newest hour is still filling up. Place it at the time of its latest price, so the chart moves
  // forward every minute instead of sitting at the top of the hour ("stuck at 20:00" until 21:00).
  const newest = points[points.length - 1];
  if (granularity === "hour" && newest && last !== null && bucketStart(last, "hour") === newest.t) {
    points[points.length - 1] = { ...newest, t: bucketStart(last, "minute") };
  }
  const goldLastT = store.goldLast();
  const tolerance = granularity === "day" ? DAY_MS : HOUR_MS;

  return {
    id,
    range,
    granularity,
    points,
    meta: {
      coinSource: "freecryptoapi",
      goldSource: gold.some((g) => g.source === "paxg" && g.t >= windowStart) ? "paxg" : "xaus",
      availableFrom: points.length > 0 ? points[0].t : null,
      truncated: spec.days !== null && (first === null || first > windowStart + tolerance),
      recordedFrom: first,
      lastRecordedAt: last,
      recordingStale: last !== null && now - last > LIVE_STALE_MS,
      goldStale: last !== null && (goldLastT === null || now - goldLastT > LIVE_STALE_MS),
      goldLastT,
    },
  };
}
