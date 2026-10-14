"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ResolvedTheme } from "@/lib/palette";
import type { DisplayCurrency, RangeKey, ThemePref, Unit } from "@/lib/types";
import { parseUrlState, serializeUrlState } from "@/lib/url-state";
import { initialState, reducer, type CoinMeta, type DashboardState } from "./dashboard-state";
import { readStorage, STORAGE_KEYS, writeStorage } from "./storage";

export interface DashboardActions {
  setUnit(unit: Unit): void;
  setTheme(theme: ThemePref): void;
  setCurrency(currency: DisplayCurrency): void;
  selectCoin(id: string, meta?: CoinMeta): void;
  setRange(range: RangeKey): void;
  addToWatchlist(id: string, meta?: CoinMeta): void;
  removeFromWatchlist(id: string): void;
  moveWatchlist(id: string, delta: -1 | 1): void;
  reorderWatchlist(from: number, to: number): void;
  toggleCompare(): void;
  toggleCompareId(id: string): void;
  setLogScale(on: boolean): void;
  rememberMeta(entries: Record<string, CoinMeta>): void;
}

interface DashboardContextValue {
  state: DashboardState;
  actions: DashboardActions;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

/** URL query used for the shareable view; written with replaceState so history isn't spammed. */
export function useUrlSync(state: DashboardState, effectiveRange: RangeKey) {
  useEffect(() => {
    if (!state.hydrated) return;
    const qs = serializeUrlState({
      coin: state.coin,
      range: effectiveRange,
      unit: state.settings.unit,
      compare: state.compare.on ? state.compare.ids : null,
    });
    if (window.location.search !== qs) window.history.replaceState(window.history.state, "", qs);
  }, [state.hydrated, state.coin, effectiveRange, state.settings.unit, state.compare]);
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({
      type: "hydrate",
      settings: readStorage(STORAGE_KEYS.settings),
      watchlist: readStorage(STORAGE_KEYS.watchlist),
      meta: readStorage(STORAGE_KEYS.meta),
      url: parseUrlState(window.location.search),
    });
  }, []);

  useEffect(() => {
    if (state.hydrated) writeStorage(STORAGE_KEYS.settings, state.settings);
  }, [state.hydrated, state.settings]);

  useEffect(() => {
    if (state.hydrated) writeStorage(STORAGE_KEYS.watchlist, { ids: state.watchlist });
  }, [state.hydrated, state.watchlist]);

  useEffect(() => {
    if (!state.hydrated) return;
    // Only keep metadata for coins the user still tracks.
    const keep = Object.fromEntries(
      Object.entries(state.meta).filter(([id]) => state.watchlist.includes(id)),
    );
    writeStorage(STORAGE_KEYS.meta, keep);
  }, [state.hydrated, state.meta, state.watchlist]);

  const actions = useMemo<DashboardActions>(
    () => ({
      setUnit: (unit) => dispatch({ type: "setUnit", unit }),
      setTheme: (theme) => dispatch({ type: "setTheme", theme }),
      setCurrency: (currency) => dispatch({ type: "setCurrency", currency }),
      selectCoin: (id, meta) => dispatch({ type: "selectCoin", id, meta }),
      setRange: (range) => dispatch({ type: "setRange", range }),
      addToWatchlist: (id, meta) => dispatch({ type: "addToWatchlist", id, meta }),
      removeFromWatchlist: (id) => dispatch({ type: "removeFromWatchlist", id }),
      moveWatchlist: (id, delta) => dispatch({ type: "moveWatchlist", id, delta }),
      reorderWatchlist: (from, to) => dispatch({ type: "reorderWatchlist", from, to }),
      toggleCompare: () => dispatch({ type: "toggleCompare" }),
      toggleCompareId: (id) => dispatch({ type: "toggleCompareId", id }),
      setLogScale: (on) => dispatch({ type: "setLogScale", on }),
      rememberMeta: (entries) => dispatch({ type: "rememberMeta", entries }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside <DashboardProvider>");
  return ctx;
}

// ---------- Theme ----------

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribeSystemTheme(onChange: () => void) {
  const mq = darkQuery();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** The theme actually shown: the manual choice, or the system preference. */
export function useResolvedTheme(): ResolvedTheme {
  const { state } = useDashboard();
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => darkQuery().matches,
    () => false,
  );
  const pref = state.settings.theme;
  const resolved: ResolvedTheme = pref === "system" ? (systemDark ? "dark" : "light") : pref;

  useEffect(() => {
    if (state.hydrated) document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved, state.hydrated]);

  return resolved;
}
