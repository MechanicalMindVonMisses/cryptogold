// Background price recorder: every interval it saves FreeCryptoAPI prices for the tracked coins and the
// gold spot price, building AuRatio's own price history. Runs inside the Next.js server process, so it
// shares the price cache with the dashboard (one FreeCryptoAPI request a minute serves both).

import { DAY_MS, HOUR_MS } from "@/lib/ratio";
import { getConfig } from "./config";
import { getLivePricesCached } from "./providers/freecryptoapi";
import { getGoldSpot } from "./providers/gold";
import { getStore, MINUTE_RETENTION_MS, resolveDbPath, type PriceStore } from "./store/price-store";

/** Always recorded, from the very first start. */
export const DEFAULT_TRACKED = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "sui", symbol: "SUI" },
] as const;

/** Coins nobody has viewed for this long stop being recorded (their history is kept). */
export const TRACK_WINDOW_MS = 30 * DAY_MS;
/** One FreeCryptoAPI request covers up to 50 symbols. */
export const MAX_TRACKED = 50;
/** Each tick needs a price fetched since the previous tick (ticks are at least 60 s apart). */
export const MAX_PRICE_AGE_MS = 30_000;
/** Recorded data is folded into the main database file this often (see PriceStore.checkpoint). */
export const CHECKPOINT_EVERY_MS = 10 * 60_000;

export interface TickResult {
  at: number;
  coins: number;
  gold: boolean;
}

let lastPrune = 0;
let lastCheckpoint = 0;

/** Records one observation. Only fresh prices are stored; a failed source simply leaves a gap. */
export async function recordOnce(
  store: PriceStore = getStore(),
  now = Date.now(),
): Promise<TickResult> {
  // The defaults are always recorded, so visitors browsing other coins can't push them out.
  store.trackCoins(DEFAULT_TRACKED, now);
  const tracked = store.trackedCoins(now - TRACK_WINDOW_MS, MAX_TRACKED);
  const [prices, gold] = await Promise.allSettled([
    tracked.length > 0
      ? getLivePricesCached(
          tracked.map((c) => c.symbol),
          MAX_PRICE_AGE_MS,
        )
      : Promise.resolve(new Map()),
    getGoldSpot(),
  ]);

  const coins =
    prices.status === "fulfilled"
      ? tracked.flatMap((c) => {
          const p = prices.value.get(c.symbol.toUpperCase());
          return p && !p.stale ? [{ id: c.id, usd: p.usd }] : [];
        })
      : [];
  const goldTick =
    gold.status === "fulfilled" && !gold.value.stale
      ? { usdPerOz: gold.value.data.usdPerOz, source: gold.value.source }
      : null;

  store.recordTick(now, coins, goldTick);
  if (now - lastCheckpoint >= CHECKPOINT_EVERY_MS) {
    store.checkpoint();
    lastCheckpoint = now;
    // Once a day (first checkpoint of a UTC day), a consistent copy goes to data/backups.
    const backup = store.dailyBackup(now);
    if (backup) console.log(`[auratio] saved daily backup ${backup}`);
  }
  if (now - lastPrune >= HOUR_MS) {
    store.pruneMinutes(now - MINUTE_RETENTION_MS);
    lastPrune = now;
  }
  return { at: now, coins: coins.length, gold: goldTick !== null };
}

interface RecorderState {
  timer: ReturnType<typeof setInterval>;
  failing: boolean;
}

const g = globalThis as typeof globalThis & { __auratioRecorder?: RecorderState };

/** Starts the recorder once per server process (idempotent across `next dev` reloads). */
export function startRecorder(): void {
  if (g.__auratioRecorder) return;
  const { recordIntervalMs, dbPath } = getConfig();
  const store = getStore();

  const state: RecorderState = {
    timer: setInterval(() => void tick(), recordIntervalMs),
    failing: false,
  };
  g.__auratioRecorder = state;

  async function tick() {
    try {
      const result = await recordOnce(store);
      const failing = result.coins === 0 && !result.gold;
      if (failing && !state.failing)
        console.warn("[auratio] recorder: no prices could be fetched; retrying every interval");
      if (!failing && state.failing) console.log("[auratio] recorder: recording again");
      state.failing = failing;
    } catch (err) {
      if (!state.failing)
        console.error("[auratio] recorder tick failed:", err instanceof Error ? err.message : err);
      state.failing = true;
    }
  }

  void tick();
  console.log(
    `[auratio] recording prices every ${recordIntervalMs / 1000} s to ${resolveDbPath(dbPath)}`,
  );
}

export function stopRecorderForTests(): void {
  if (g.__auratioRecorder) clearInterval(g.__auratioRecorder.timer);
  g.__auratioRecorder = undefined;
  lastPrune = 0;
  lastCheckpoint = 0;
}
