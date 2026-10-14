// Pure dashboard state: settings, watchlist and the current view. No React, so it is unit-testable.

import { isRangeKey } from "@/lib/ranges";
import type { DisplayCurrency, RangeKey, ThemePref, Unit } from "@/lib/types";
import { isCoinId, isUnit, MAX_COMPARE, type UrlState } from "@/lib/url-state";

export const MAX_WATCHLIST = 20;
export const DEFAULT_WATCHLIST = ["bitcoin", "ethereum", "sui"] as const;
export const DEFAULT_RANGE: RangeKey = "1y";

export interface Settings {
  unit: Unit;
  theme: ThemePref;
  displayCurrency: DisplayCurrency;
}

export interface CoinMeta {
  symbol: string;
  name: string;
  image: string | null;
}

export interface DashboardState {
  hydrated: boolean;
  settings: Settings;
  watchlist: string[];
  meta: Record<string, CoinMeta>;
  coin: string;
  range: RangeKey;
  compare: { on: boolean; ids: string[] };
  logScale: boolean;
}

export const DEFAULT_SETTINGS: Settings = { unit: "oz", theme: "system", displayCurrency: "USD" };

export const KNOWN_META: Record<string, CoinMeta> = {
  bitcoin: { symbol: "BTC", name: "Bitcoin", image: null },
  ethereum: { symbol: "ETH", name: "Ethereum", image: null },
  sui: { symbol: "SUI", name: "Sui", image: null },
};

export const initialState: DashboardState = {
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  watchlist: [...DEFAULT_WATCHLIST],
  meta: KNOWN_META,
  coin: DEFAULT_WATCHLIST[0],
  range: DEFAULT_RANGE,
  compare: { on: false, ids: [] },
  logScale: false,
};

export function sanitizeSettings(value: unknown): Settings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    unit: isUnit(v.unit) ? v.unit : DEFAULT_SETTINGS.unit,
    theme:
      v.theme === "light" || v.theme === "dark" || v.theme === "system"
        ? v.theme
        : DEFAULT_SETTINGS.theme,
    displayCurrency:
      v.displayCurrency === "TRY" || v.displayCurrency === "USD" ? v.displayCurrency : "USD",
  };
}

/** Accepts `{ ids: string[] }`; anything else (corrupt, wrong shape, empty) falls back to the defaults. */
export function sanitizeWatchlist(value: unknown): string[] {
  const ids = (value as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return [...DEFAULT_WATCHLIST];
  const clean = [...new Set(ids.filter(isCoinId))].slice(0, MAX_WATCHLIST);
  return clean.length > 0 ? clean : [...DEFAULT_WATCHLIST];
}

export function sanitizeMeta(value: unknown): Record<string, CoinMeta> {
  const out: Record<string, CoinMeta> = { ...KNOWN_META };
  if (typeof value !== "object" || value === null) return out;
  for (const [id, m] of Object.entries(value as Record<string, unknown>)) {
    const meta = m as Partial<CoinMeta> | null;
    if (!isCoinId(id) || !meta || typeof meta.symbol !== "string" || typeof meta.name !== "string")
      continue;
    out[id] = {
      symbol: meta.symbol.slice(0, 20),
      name: meta.name.slice(0, 80),
      image:
        typeof meta.image === "string" && meta.image.startsWith("https://") ? meta.image : null,
    };
  }
  return out;
}

export type Action =
  | { type: "hydrate"; settings: unknown; watchlist: unknown; meta: unknown; url: UrlState }
  | { type: "setUnit"; unit: Unit }
  | { type: "setTheme"; theme: ThemePref }
  | { type: "setCurrency"; currency: DisplayCurrency }
  | { type: "selectCoin"; id: string; meta?: CoinMeta }
  | { type: "setRange"; range: RangeKey }
  | { type: "addToWatchlist"; id: string; meta?: CoinMeta }
  | { type: "removeFromWatchlist"; id: string }
  | { type: "moveWatchlist"; id: string; delta: -1 | 1 }
  | { type: "reorderWatchlist"; from: number; to: number }
  | { type: "toggleCompare" }
  | { type: "toggleCompareId"; id: string }
  | { type: "setLogScale"; on: boolean }
  | { type: "rememberMeta"; entries: Record<string, CoinMeta> };

function withMeta(state: DashboardState, id: string, meta?: CoinMeta): Record<string, CoinMeta> {
  return meta ? { ...state.meta, [id]: meta } : state.meta;
}

function defaultCompareIds(state: DashboardState): string[] {
  return [...new Set([state.coin, ...state.watchlist])].slice(0, 3);
}

export function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "hydrate": {
      const settings = sanitizeSettings(action.settings);
      const watchlist = sanitizeWatchlist(action.watchlist);
      const { url } = action;
      return {
        ...state,
        hydrated: true,
        settings: url.unit ? { ...settings, unit: url.unit } : settings,
        watchlist,
        meta: sanitizeMeta(action.meta),
        coin: url.coin ?? watchlist[0],
        range: url.range ?? state.range,
        compare: url.compare ? { on: true, ids: url.compare } : state.compare,
      };
    }
    case "setUnit":
      return { ...state, settings: { ...state.settings, unit: action.unit } };
    case "setTheme":
      return { ...state, settings: { ...state.settings, theme: action.theme } };
    case "setCurrency":
      return { ...state, settings: { ...state.settings, displayCurrency: action.currency } };
    case "selectCoin":
      if (!isCoinId(action.id)) return state;
      return { ...state, coin: action.id, meta: withMeta(state, action.id, action.meta) };
    case "setRange":
      return isRangeKey(action.range) ? { ...state, range: action.range } : state;
    case "addToWatchlist": {
      if (!isCoinId(action.id) || state.watchlist.length >= MAX_WATCHLIST) return state;
      const meta = withMeta(state, action.id, action.meta);
      if (state.watchlist.includes(action.id)) return { ...state, meta };
      return { ...state, watchlist: [...state.watchlist, action.id], meta };
    }
    case "removeFromWatchlist": {
      const watchlist = state.watchlist.filter((id) => id !== action.id);
      return {
        ...state,
        watchlist,
        compare: { ...state.compare, ids: state.compare.ids.filter((id) => id !== action.id) },
      };
    }
    case "moveWatchlist": {
      const from = state.watchlist.indexOf(action.id);
      return from < 0
        ? state
        : reducer(state, { type: "reorderWatchlist", from, to: from + action.delta });
    }
    case "reorderWatchlist": {
      const { from, to } = action;
      const list = state.watchlist;
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
        return state;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...state, watchlist: next };
    }
    case "toggleCompare": {
      if (state.compare.on) return { ...state, compare: { ...state.compare, on: false } };
      const ids = state.compare.ids.length >= 2 ? state.compare.ids : defaultCompareIds(state);
      return { ...state, compare: { on: true, ids } };
    }
    case "toggleCompareId": {
      const ids = state.compare.ids;
      if (ids.includes(action.id))
        return { ...state, compare: { ...state.compare, ids: ids.filter((i) => i !== action.id) } };
      if (ids.length >= MAX_COMPARE || !isCoinId(action.id)) return state;
      return { ...state, compare: { ...state.compare, ids: [...ids, action.id] } };
    }
    case "setLogScale":
      return { ...state, logScale: action.on };
    case "rememberMeta": {
      let changed = false;
      const meta = { ...state.meta };
      for (const [id, m] of Object.entries(action.entries)) {
        const prev = meta[id];
        if (!prev || prev.symbol !== m.symbol || prev.name !== m.name || prev.image !== m.image) {
          meta[id] = m;
          changed = true;
        }
      }
      return changed ? { ...state, meta } : state;
    }
  }
}
