/** Live prices older than this are flagged stale (FR-12). */
export const LIVE_STALE_MS = 15 * 60_000;
export function isLiveStale(asOf: string | number, now = Date.now()): boolean {
  const t = typeof asOf === "number" ? asOf : Date.parse(asOf);
  return !Number.isFinite(t) || now - t > LIVE_STALE_MS;
}
