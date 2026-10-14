// localStorage access that never throws (private mode, blocked storage, quota) and never trusts
// stored values: callers validate what they read.

export function readStorage(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; the app works without it.
  }
}

export const STORAGE_KEYS = {
  settings: "auratio:settings",
  watchlist: "auratio:watchlist",
  meta: "auratio:coin-meta",
} as const;
