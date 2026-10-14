// Which non-blocking status badges to show (FR-12, §11). Pure so it can be unit-tested.

import { formatClock } from "@/lib/format";
import { isLiveStale } from "@/lib/staleness";
import type { CoinSpotDto, HistoryMeta, SpotResponse } from "@/lib/types";

export interface BadgeSpec {
  id: string;
  text: string;
  title: string;
}

export interface StatusInput {
  spot: SpotResponse | undefined;
  coin: CoinSpotDto | undefined;
  /** The latest spot refresh failed with a rate-limit error (previous data still shown). */
  spotRateLimited: boolean;
  history: HistoryMeta | undefined;
  fxFailed: boolean;
  now: number;
}

export const PAXG_BADGE = "Gold priced via PAXG (tracks 1 oz LBMA gold)";
export const PAUSED_BADGE = "Live updates paused";

export function deriveBadges({
  spot,
  coin,
  spotRateLimited,
  history,
  fxFailed,
  now,
}: StatusInput): BadgeSpec[] {
  const out: BadgeSpec[] = [];
  if (spot?.gold.source === "paxg") {
    out.push({
      id: "paxg",
      text: PAXG_BADGE,
      title: "The primary gold price source is unavailable, so gold is priced from the PAXG token.",
    });
  }
  if (spot?.gold.stale) {
    out.push({
      id: "gold-stale",
      text: "Gold price delayed",
      title: `Last gold price update ${formatClock(spot.gold.asOf)}.`,
    });
  }
  if (spot?.rateLimited || spotRateLimited) {
    out.push({
      id: "paused",
      text: PAUSED_BADGE,
      title:
        "The coin price source is rate-limiting requests. Showing the latest cached prices; updates resume automatically.",
    });
  } else if (spot?.coinsStale || (coin && isLiveStale(coin.asOf, now))) {
    out.push({
      id: "coin-stale",
      text: "Coin price delayed",
      title: coin
        ? `Last coin price update ${formatClock(coin.asOf)}.`
        : "Showing cached coin prices.",
    });
  }
  if (history?.recordingStale && history.lastRecordedAt !== null) {
    out.push({
      id: "recording-paused",
      text: `Recording paused since ${formatClock(history.lastRecordedAt)}`,
      title:
        "No price has been saved for over 15 minutes. History is recorded while the AuRatio server runs and FreeCryptoAPI answers.",
    });
  } else if (history?.goldStale) {
    out.push({
      id: "gold-history-stale",
      text: "Gold not recorded recently",
      title:
        "No gold price has been saved for over 15 minutes, so recent points reuse the last one.",
    });
  }
  if (history?.goldSource === "paxg" && spot?.gold.source !== "paxg") {
    out.push({
      id: "paxg-history",
      text: "Chart gold via PAXG",
      title:
        "Historical gold prices come from the PAXG token because the primary source is unavailable.",
    });
  }
  if (fxFailed) {
    out.push({
      id: "fx",
      text: "TRY rate unavailable, showing USD",
      title: "The USD/TRY exchange rate could not be loaded.",
    });
  }
  return out;
}
