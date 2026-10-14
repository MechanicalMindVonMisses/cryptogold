"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createQueryClient,
  isNetworkError,
  useFx,
  useHistories,
  useHistory,
  useSpot,
} from "@/hooks/queries";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { effectiveRange, rangeAvailability } from "@/lib/availability";
import { COMPARE_PALETTE } from "@/lib/palette";
import { RANGES } from "@/lib/ranges";
import { buildComparison, changeSince, computeStats, DAY_MS } from "@/lib/ratio";
import { buildCompareSummary, buildSummary } from "@/lib/summary";
import { formatClock, formatDate } from "@/lib/format";
import type { GoldSource, SearchResult } from "@/lib/types";
import { DashboardProvider, useDashboard, useResolvedTheme, useUrlSync } from "@/state/dashboard";
import { MAX_WATCHLIST, type CoinMeta } from "@/state/dashboard-state";
import type { CompareLineView } from "./chart/CompareChart";
import type { PriceDisplay } from "./chart/tooltip";
import { ChartPanel } from "./ChartPanel";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { KpiStrip, type KpiChanges } from "./KpiStrip";
import { Footer, InfoDialog, OfflineBanner, type ProvenanceInfo } from "./Provenance";
import { deriveBadges } from "./status";
import { SummaryCard } from "./SummaryCard";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { MobileWatchlist, WatchlistPanel, type WatchItem } from "./Watchlist";

const MAX_SPOT_IDS = 20;

export function Dashboard() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <DashboardProvider>
        <ErrorBoundary label="dashboard" className="p-6">
          <DashboardView />
        </ErrorBoundary>
      </DashboardProvider>
    </QueryClientProvider>
  );
}

function metaFromResult(r: SearchResult): CoinMeta {
  return { symbol: r.symbol, name: r.name, image: r.thumb };
}

function DashboardView() {
  const { state, actions } = useDashboard();
  const { hydrated, coin, watchlist, compare, settings } = state;
  const { unit } = settings;
  const theme = useResolvedTheme();
  const online = useOnlineStatus();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // ---------- Live prices: one batched request for everything on screen ----------
  const spotIds = useMemo(
    () =>
      [...new Set([coin, ...(compare.on ? compare.ids : []), ...watchlist])].slice(0, MAX_SPOT_IDS),
    [coin, compare.on, compare.ids, watchlist],
  );
  const spot = useSpot(spotIds, hydrated);
  const coinSpot = spot.data?.coins.find((c) => c.id === coin);
  const unavailable = !coinSpot && !!spot.data?.missing.includes(coin);

  useEffect(() => {
    if (!spot.data) return;
    actions.rememberMeta(
      Object.fromEntries(
        spot.data.coins.map((c) => [c.id, { symbol: c.symbol, name: c.name, image: c.image }]),
      ),
    );
  }, [spot.data, actions]);

  const metaOf = (id: string): CoinMeta => {
    const s = spot.data?.coins.find((c) => c.id === id);
    if (s) return { symbol: s.symbol, name: s.name, image: s.image };
    return state.meta[id] ?? { symbol: id.toUpperCase().slice(0, 10), name: id, image: null };
  };
  const meta = metaOf(coin);

  // ---------- History: 1Y drives KPIs and range availability; the selected range drives chart + summary ----------
  const year = useHistory(coin, "1y", hydrated);
  const yearData = year.data?.id === coin ? year.data : undefined;
  const availability = useMemo(
    () => rangeAvailability(yearData?.meta, year.dataUpdatedAt),
    [yearData, year.dataUpdatedAt],
  );
  const range = effectiveRange(state.range, availability);
  useUrlSync(state, range);

  const history = useHistory(coin, range, hydrated);
  // While a new range loads, keep showing this coin's previous chart (dimmed) instead of a blank box.
  const chartHistory = history.data?.id === coin ? history.data : undefined;
  const historyData = chartHistory?.range === range ? chartHistory : undefined;
  const stats = useMemo(
    () => (historyData ? computeStats(historyData.points) : null),
    [historyData],
  );

  const fx = useFx(settings.displayCurrency);
  const price: PriceDisplay =
    settings.displayCurrency === "TRY" && fx.data
      ? { currency: "TRY", rate: fx.data.rate }
      : { currency: "USD", rate: 1 };
  const fxFailed = settings.displayCurrency === "TRY" && fx.isError && !fx.data;

  const goldSource: GoldSource =
    historyData?.meta.goldSource === "paxg" || spot.data?.gold.source === "paxg" ? "paxg" : "xaus";

  // ---------- Compare mode ----------
  const compareIds = useMemo(() => (compare.on ? compare.ids : []), [compare.on, compare.ids]);
  const compareData = useHistories(compareIds, range, hydrated && compare.on);
  const comparison = useMemo(
    () =>
      buildComparison(
        compareIds.map((id, i) => {
          const d = compareData.data[i];
          return { id, points: d && d.range === range ? d.points : [] };
        }),
      ),
    [compareIds, compareData.data, range],
  );
  const palette = COMPARE_PALETTE[theme];
  const metaById = state.meta;
  const spotCoins = spot.data?.coins;
  const compareLines = useMemo<CompareLineView[]>(
    () =>
      comparison.lines.map((l) => ({
        id: l.id,
        symbol:
          spotCoins?.find((c) => c.id === l.id)?.symbol ??
          metaById[l.id]?.symbol ??
          l.id.toUpperCase(),
        color: palette[compareIds.indexOf(l.id) % palette.length],
        points: l.points,
      })),
    [comparison, palette, compareIds, spotCoins, metaById],
  );

  // ---------- Words ----------
  const summaryText = useMemo(() => {
    if (compare.on) {
      if (compareIds.length >= 2 && compareLines.length < 2) return null;
      return buildCompareSummary({
        lines: comparison.lines.map((l, i) => ({
          symbol: compareLines[i]?.symbol ?? l.id,
          changePct: l.changePct,
        })),
        start: comparison.start,
        truncated: comparison.truncated,
        goldSource,
      }).text;
    }
    if (!historyData) return null;
    const { meta: m, points } = historyData;
    const truncatedSpanMs =
      m.truncated && points.length > 0 ? points[points.length - 1].t - points[0].t : null;
    return buildSummary({
      symbol: meta.symbol,
      points,
      stats,
      unit,
      range,
      goldSource,
      truncatedSpanMs,
      currentOz: coinSpot?.ratioOz,
    }).text;
  }, [
    compare.on,
    compareIds.length,
    compareLines,
    comparison,
    goldSource,
    historyData,
    meta.symbol,
    stats,
    unit,
    range,
    coinSpot?.ratioOz,
  ]);

  const changes = useMemo<KpiChanges>(
    () => ({
      "24h": coinSpot?.ratioChange24h ?? null,
      "7D": yearData ? changeSince(yearData.points, 7 * DAY_MS, DAY_MS) : null,
      "30D": yearData ? changeSince(yearData.points, 30 * DAY_MS, 2 * DAY_MS) : null,
      "1Y":
        yearData && !yearData.meta.truncated
          ? changeSince(yearData.points, 365 * DAY_MS, 4 * DAY_MS)
          : null,
    }),
    [coinSpot?.ratioChange24h, yearData],
  );

  const badges = deriveBadges({
    spot: spot.data,
    coin: coinSpot,
    spotRateLimited: spot.error instanceof ApiError && spot.error.rateLimited,
    history: historyData?.meta,
    fxFailed,
    now: spot.dataUpdatedAt,
  });

  const offline = !online || (spot.isError && isNetworkError(spot.error));

  // Shown in place of the chart until enough prices have been recorded.
  const recordedFrom = chartHistory?.meta.recordedFrom ?? null;
  const recordingNote =
    coinSpot && coinSpot.priceSource !== "freecryptoapi"
      ? `FreeCryptoAPI doesn’t list ${meta.symbol}, so AuRatio can’t record its price history.`
      : recordedFrom !== null
        ? `Recording ${meta.symbol} every minute since ${formatClock(recordedFrom)}, ${formatDate(recordedFrom)}. The chart appears once a few prices are saved.`
        : `AuRatio starts recording ${meta.symbol} within a minute. The chart appears once a few prices are saved.`;

  const watchItems: WatchItem[] = watchlist.map((id) => {
    const s = spot.data?.coins.find((c) => c.id === id);
    return { id, ...metaOf(id), spot: s, unavailable: !s && !!spot.data?.missing.includes(id) };
  });
  const watchlistFull = watchlist.length >= MAX_WATCHLIST;

  const [mobileSearch, setMobileSearch] = useState(false);
  const focusSearch = () => {
    const input = searchInputRef.current;
    if (input && input.offsetParent !== null) input.focus();
    else setMobileSearch(true);
  };

  const provenance: ProvenanceInfo = {
    goldSource: spot.data?.gold.source,
    goldAsOf: spot.data?.gold.asOf,
    coinsAsOf: spot.data?.coins
      .map((c) => c.asOf)
      .sort()
      .at(-1),
    coinPriceSource: coinSpot?.priceSource,
    historyGoldSource: historyData?.meta.goldSource,
    recordedFrom: chartHistory?.meta.recordedFrom,
    lastRecordedAt: chartHistory?.meta.lastRecordedAt,
    fx: fx.data ? { rate: fx.data.rate, asOf: fx.data.asOf, source: fx.data.source } : undefined,
  };

  const watchlistProps = {
    items: watchItems,
    selectedId: coin,
    unit,
    loading: !hydrated || spot.isPending,
    onSelect: (id: string) => actions.selectCoin(id),
    onRemove: actions.removeFromWatchlist,
    onMove: actions.moveWatchlist,
    onReorder: actions.reorderWatchlist,
    onAddClick: focusSearch,
  };

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to dashboard
      </a>
      <Header
        unit={unit}
        onUnitChange={actions.setUnit}
        theme={theme}
        onThemeToggle={() => actions.setTheme(theme === "dark" ? "light" : "dark")}
        onOpenInfo={() => setInfoOpen(true)}
        watchlist={watchlist}
        watchlistFull={watchlistFull}
        onSelectCoin={(r) => actions.selectCoin(r.id, metaFromResult(r))}
        onAddCoin={(r) => {
          actions.addToWatchlist(r.id, metaFromResult(r));
          actions.selectCoin(r.id, metaFromResult(r));
        }}
        searchInputRef={searchInputRef}
        mobileSearch={mobileSearch}
        onMobileSearchChange={setMobileSearch}
      />
      <OfflineBanner offline={offline} lastUpdated={spot.dataUpdatedAt || undefined} />

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 pt-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-[72px]">
            <ErrorBoundary label="watchlist">
              <WatchlistPanel {...watchlistProps} />
            </ErrorBoundary>
          </div>
        </aside>

        <main id="main" className="flex min-w-0 flex-col gap-4">
          <div className="lg:hidden">
            <ErrorBoundary label="watchlist">
              <MobileWatchlist {...watchlistProps} />
            </ErrorBoundary>
          </div>

          <ErrorBoundary label="headline">
            <Hero
              symbol={meta.symbol}
              name={meta.name}
              image={meta.image}
              coin={coinSpot}
              gold={spot.data?.gold}
              unit={unit}
              price={price}
              currencySetting={settings.displayCurrency}
              onCurrencyChange={actions.setCurrency}
              badges={badges}
              loading={!hydrated || spot.isFetching}
              error={spot.isError}
              onRetry={() => void spot.refetch()}
              unavailable={unavailable}
              inWatchlist={watchlist.includes(coin)}
              watchlistFull={watchlistFull}
              onAdd={() => actions.addToWatchlist(coin, meta)}
            />
          </ErrorBoundary>

          <ErrorBoundary label="chart">
            <ChartPanel
              range={range}
              availability={availability}
              onRangeChange={actions.setRange}
              unit={unit}
              logScale={state.logScale}
              onLogScale={actions.setLogScale}
              theme={theme}
              symbol={meta.symbol}
              history={chartHistory}
              historyLoading={!hydrated || history.isFetching}
              historyFetching={history.isFetching}
              historyError={history.isError}
              emptyMessage={recordingNote}
              onRetry={() => void history.refetch()}
              compareOn={compare.on}
              onToggleCompare={actions.toggleCompare}
              compareCandidates={[...new Set([coin, ...watchlist, ...compare.ids])].map((id) => ({
                id,
                symbol: metaOf(id).symbol,
              }))}
              compareIds={compare.ids}
              onToggleCompareId={actions.toggleCompareId}
              compareLines={compareLines}
              compareLoading={compareData.loading}
              compareError={compareData.error}
              onCompareRetry={compareData.refetch}
            />
          </ErrorBoundary>

          <ErrorBoundary label="key figures">
            <KpiStrip
              unit={unit}
              currentOz={coinSpot?.ratioOz}
              changes={changes}
              stats={stats}
              rangeLabel={RANGES[range].label}
              granularity={historyData?.granularity ?? RANGES[range].granularity}
              loading={!hydrated || year.isFetching || history.isFetching || spot.isPending}
            />
          </ErrorBoundary>

          <ErrorBoundary label="summary">
            <SummaryCard
              text={summaryText}
              loading={!hydrated || history.isFetching || compareData.loading}
              error={compare.on ? compareData.error : history.isError}
              onRetry={() => (compare.on ? compareData.refetch() : void history.refetch())}
            />
          </ErrorBoundary>
        </main>
      </div>

      <Footer info={provenance} />
      <InfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        info={provenance}
        themePref={settings.theme}
        onUseSystemTheme={() => actions.setTheme("system")}
      />
    </>
  );
}
