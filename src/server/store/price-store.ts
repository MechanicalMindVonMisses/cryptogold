// SQLite store for prices recorded by this app: FreeCryptoAPI coin prices and XAUS gold prices,
// one observation per recorder tick. Per-minute rows are kept for 8 days; the latest price of every
// hour is kept forever, which is what longer charts read.

import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/ratio";
import type { GoldSource, PricePoint } from "@/lib/types";
import { getConfig } from "../config";

export type Resolution = "minute" | "hour";

/** Only files named like this are ever deleted from the backups folder. */
const BACKUP_NAME = /^auratio-\d{4}-\d{2}-\d{2}\.db$/;

/** Per-minute rows older than this are pruned; hourly closes are kept forever. */
export const MINUTE_RETENTION_MS = 8 * DAY_MS;

export interface GoldPoint extends PricePoint {
  source: GoldSource;
}

export interface TrackedCoin {
  id: string;
  symbol: string;
  lastRequested: number;
}

export interface CoinTick {
  id: string;
  usd: number;
}

export interface GoldTick {
  usdPerOz: number;
  source: GoldSource;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracked_coins (
  coin_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  last_requested INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coin_minute (
  coin_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  usd REAL NOT NULL,
  PRIMARY KEY (coin_id, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS coin_hourly (
  coin_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  usd REAL NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (coin_id, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS gold_minute (
  t INTEGER PRIMARY KEY,
  usd_per_oz REAL NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gold_hourly (
  t INTEGER PRIMARY KEY,
  usd_per_oz REAL NOT NULL,
  source TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coin_minute_t ON coin_minute (t);
`;

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export class PriceStore {
  private readonly db: DatabaseSync;

  constructor(private readonly path: string) {
    try {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
      // Loaded at runtime so bundlers never try to resolve the builtin.
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
      this.db = new DatabaseSync(path);
      // WAL lets `next dev` and `next start` share one file without blocking readers.
      this.db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
      );
      this.db.exec(SCHEMA);
      // Fold any log left by an earlier process into the main file straight away.
      this.checkpoint();
    } catch (err) {
      throw new StorageError(
        `Cannot open price database at ${path}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ---------- Which coins to record ----------

  /** Adds coins or refreshes when they were last requested (their symbol is re-verified each time). */
  trackCoins(coins: ReadonlyArray<{ id: string; symbol: string }>, now = Date.now()): void {
    const stmt = this.db.prepare(
      `INSERT INTO tracked_coins (coin_id, symbol, added_at, last_requested) VALUES (?, ?, ?, ?)
       ON CONFLICT (coin_id) DO UPDATE SET symbol = excluded.symbol, last_requested = excluded.last_requested`,
    );
    this.transaction(() => {
      for (const c of coins) stmt.run(c.id, c.symbol.toUpperCase(), now, now);
    });
  }

  /** Coins requested since `since`, most recently requested first. */
  trackedCoins(since: number, limit: number): TrackedCoin[] {
    return this.db
      .prepare(
        `SELECT coin_id, symbol, last_requested FROM tracked_coins
         WHERE last_requested >= ? ORDER BY last_requested DESC LIMIT ?`,
      )
      .all(since, limit)
      .map((r: Row) => ({
        id: String(r.coin_id),
        symbol: String(r.symbol),
        lastRequested: Number(r.last_requested),
      }));
  }

  hasTrackedCoins(): boolean {
    return this.db.prepare("SELECT 1 FROM tracked_coins LIMIT 1").get() !== undefined;
  }

  // ---------- Writing ----------

  /** Stores one recorder observation; the hourly row always keeps the hour's latest price. */
  recordTick(at: number, coins: readonly CoinTick[], gold: GoldTick | null): void {
    const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
    const coinMinute = this.db.prepare(
      "INSERT OR REPLACE INTO coin_minute (coin_id, t, usd) VALUES (?, ?, ?)",
    );
    const coinHour = this.db.prepare(
      `INSERT INTO coin_hourly (coin_id, t, usd, observed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (coin_id, t) DO UPDATE SET usd = excluded.usd, observed_at = excluded.observed_at
       WHERE excluded.observed_at >= coin_hourly.observed_at`,
    );
    this.transaction(() => {
      for (const c of coins) {
        if (!Number.isFinite(c.usd) || c.usd <= 0) continue;
        coinMinute.run(c.id, minute, c.usd);
        coinHour.run(c.id, hour, c.usd, at);
      }
      if (gold && Number.isFinite(gold.usdPerOz) && gold.usdPerOz > 0) {
        this.db
          .prepare("INSERT OR REPLACE INTO gold_minute (t, usd_per_oz, source) VALUES (?, ?, ?)")
          .run(minute, gold.usdPerOz, gold.source);
        this.db
          .prepare(
            `INSERT INTO gold_hourly (t, usd_per_oz, source, observed_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (t) DO UPDATE SET usd_per_oz = excluded.usd_per_oz, source = excluded.source,
               observed_at = excluded.observed_at
             WHERE excluded.observed_at >= gold_hourly.observed_at`,
          )
          .run(hour, gold.usdPerOz, gold.source, at);
      }
    });
  }

  /** Drops per-minute rows older than `before`. */
  pruneMinutes(before: number): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM coin_minute WHERE t < ?").run(before);
      this.db.prepare("DELETE FROM gold_minute WHERE t < ?").run(before);
    });
  }

  // ---------- Reading ----------

  /** Recorded prices for a coin from `from` (ms), keyed by minute or hour bucket start. */
  coinSeries(id: string, from: number, resolution: Resolution): PricePoint[] {
    const table = resolution === "minute" ? "coin_minute" : "coin_hourly";
    return this.db
      .prepare(`SELECT t, usd FROM ${table} WHERE coin_id = ? AND t >= ? ORDER BY t`)
      .all(id, from)
      .map((r: Row) => ({ t: Number(r.t), usd: Number(r.usd) }));
  }

  goldSeries(from: number, resolution: Resolution): GoldPoint[] {
    const table = resolution === "minute" ? "gold_minute" : "gold_hourly";
    return this.db
      .prepare(`SELECT t, usd_per_oz, source FROM ${table} WHERE t >= ? ORDER BY t`)
      .all(from)
      .map((r: Row) => ({
        t: Number(r.t),
        usd: Number(r.usd_per_oz),
        source: r.source === "paxg" ? "paxg" : "xaus",
      }));
  }

  /** When recording of a coin started and its latest recorded price (ms), or nulls. */
  coinRange(id: string): { first: number | null; last: number | null } {
    // Minute rows give the exact start while they exist; after pruning the first hourly bucket does.
    const minute = this.db
      .prepare("SELECT MIN(t) AS first FROM coin_minute WHERE coin_id = ?")
      .get(id);
    const hourly = this.db
      .prepare(
        "SELECT MIN(t) AS first, MAX(observed_at) AS last FROM coin_hourly WHERE coin_id = ?",
      )
      .get(id);
    const firstHour = num(hourly?.first);
    const firstMinute = num(minute?.first);
    const first =
      firstMinute !== null && (firstHour === null || firstMinute - firstHour < HOUR_MS)
        ? firstMinute
        : firstHour;
    return { first, last: num(hourly?.last) };
  }

  goldLast(): number | null {
    return num(this.db.prepare("SELECT MAX(observed_at) AS last FROM gold_hourly").get()?.last);
  }

  // ---------- Durability ----------

  /**
   * Moves everything from the write-ahead log into the main file and empties the log. At one small
   * write a minute SQLite would otherwise keep all data in `auratio.db-wal` for a long time, and
   * anything that loses or skips that one file would lose the history with it.
   */
  checkpoint(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /**
   * Writes today's consistent copy to `<db folder>/backups/auratio-YYYY-MM-DD.db` (once a day) and
   * keeps the newest `keep` copies. Returns the backup path, or null for in-memory stores and when
   * today's copy already exists.
   */
  dailyBackup(now = Date.now(), keep = 7): string | null {
    if (this.path === ":memory:") return null;
    const dir = join(dirname(this.path), "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `auratio-${new Date(now).toISOString().slice(0, 10)}.db`);
    if (existsSync(file)) return null;
    this.db.prepare("VACUUM INTO ?").run(file);
    const backups = readdirSync(dir)
      .filter((f) => BACKUP_NAME.test(f))
      .sort()
      .reverse();
    for (const old of backups.slice(keep)) unlinkSync(join(dir, old));
    return file;
  }

  close(): void {
    this.db.close();
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function resolveDbPath(path: string): string {
  if (path === ":memory:" || isAbsolute(path)) return path;
  // The database is runtime data, not code: keep it out of output file tracing.
  return resolve(/*turbopackIgnore: true*/ process.cwd(), path);
}

const g = globalThis as typeof globalThis & { __auratioStore?: PriceStore };

/** The process-wide store (survives module reloads in `next dev`). */
export function getStore(): PriceStore {
  if (!g.__auratioStore) g.__auratioStore = new PriceStore(resolveDbPath(getConfig().dbPath));
  return g.__auratioStore;
}

/** Replaces the process-wide store in tests, closing the previous one (never opens a file). */
export function setStoreForTests(store: PriceStore | null): void {
  g.__auratioStore?.close();
  g.__auratioStore = store ?? undefined;
}
