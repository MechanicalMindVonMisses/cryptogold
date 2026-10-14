"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { AvailabilityMap } from "@/lib/availability";
import { exportFilename, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { CHART_THEME, type ResolvedTheme } from "@/lib/palette";
import { RANGES } from "@/lib/ranges";
import type { HistoryResponse, RangeKey, Unit } from "@/lib/types";
import { MAX_COMPARE } from "@/lib/url-state";
import type { CompareLineView } from "./chart/CompareChart";
import type { TimeSeriesChartHandle } from "./chart/TimeSeriesChart";
import { ChangeText } from "./Change";
import { composeChartPng, downloadBlob } from "./download";
import { RangeSelector } from "./RangeSelector";
import { SUMMARY_ID } from "./SummaryCard";
import { DownloadIcon, FitIcon, LayersIcon } from "./ui/icons";
import { Card, cx, InlineError, Skeleton } from "./ui/primitives";

// The chart library loads after the headline numbers (keeps the initial bundle small).
const chartLoading = () => <Skeleton className="h-full w-full" />;
const RatioChart = dynamic(() => import("./chart/RatioChart"), {
  ssr: false,
  loading: chartLoading,
});
const CompareChart = dynamic(() => import("./chart/CompareChart"), {
  ssr: false,
  loading: chartLoading,
});

const toolButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
const pressed = (on: boolean) =>
  on ? "border-fg bg-fg text-bg" : "bg-surface text-muted hover:text-fg";

export interface CompareCandidate {
  id: string;
  symbol: string;
}

interface ChartPanelProps {
  range: RangeKey;
  availability: AvailabilityMap;
  onRangeChange: (r: RangeKey) => void;
  unit: Unit;
  logScale: boolean;
  onLogScale: (on: boolean) => void;
  theme: ResolvedTheme;
  symbol: string;
  history: HistoryResponse | undefined;
  historyLoading: boolean;
  /** Explains why there is no chart yet (recording just started, coin not recordable). */
  emptyMessage: string;
  historyFetching: boolean;
  historyError: boolean;
  onRetry: () => void;
  compareOn: boolean;
  onToggleCompare: () => void;
  compareCandidates: CompareCandidate[];
  compareIds: string[];
  onToggleCompareId: (id: string) => void;
  compareLines: CompareLineView[];
  compareLoading: boolean;
  compareError: boolean;
  onCompareRetry: () => void;
}

export function ChartPanel(p: ChartPanelProps) {
  const chartRef = useRef<TimeSeriesChartHandle>(null);
  const [hint, setHint] = useState<string | null>(null);
  const colors = CHART_THEME[p.theme];
  const label = RANGES[p.range].label;
  const points = p.history?.points ?? [];

  function exportCsv() {
    if (!p.history) return;
    const blob = new Blob([toCsv(p.history.points, p.history.granularity)], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(blob, exportFilename(p.symbol, p.range, "csv"));
  }

  async function exportPng() {
    const shot = chartRef.current?.screenshot();
    if (!shot) return;
    const title = p.compareOn
      ? `${p.compareLines.map((l) => l.symbol).join(", ")} vs gold, indexed to 100 · ${label}`
      : `1 ${p.symbol} in gold (${p.unit}) · ${label}`;
    const subtitle = `AuRatio · ${formatDate(Date.now())} · Sources: XAUS, CoinGecko, Binance · Indicative, not advice`;
    const blob = await composeChartPng(shot, title, subtitle, {
      bg: colors.surface,
      fg: colors.text,
      muted: colors.muted,
    });
    const name = p.compareOn ? "compare" : p.symbol;
    if (blob) downloadBlob(blob, exportFilename(name, p.range, "png"));
  }

  const chartShown = p.compareOn
    ? p.compareIds.length >= 2 && p.compareLines.length >= 2
    : !!p.history && points.length >= 2;
  let chart;
  if (p.compareOn) {
    if (p.compareIds.length < 2) {
      chart = (
        <p className="flex h-full items-center justify-center text-sm text-muted">
          Pick at least two coins to compare.
        </p>
      );
    } else if (p.compareLines.length >= 2) {
      chart = (
        <CompareChart
          chartRef={chartRef}
          lines={p.compareLines}
          granularity={RANGES[p.range].granularity}
          logScale={p.logScale}
          theme={p.theme}
          resetKey={`${p.compareLines.map((l) => l.id).join(",")}:${p.range}`}
        />
      );
    } else if (p.compareError && !p.compareLoading) {
      chart = (
        <InlineError
          className="h-full justify-center"
          message="Comparison data could not be loaded."
          onRetry={p.onCompareRetry}
        />
      );
    } else {
      chart = <Skeleton className="h-full w-full" />;
    }
  } else if (p.history && points.length >= 2) {
    chart = (
      <RatioChart
        chartRef={chartRef}
        history={p.history}
        unit={p.unit}
        logScale={p.logScale}
        theme={p.theme}
        symbol={p.symbol}
      />
    );
  } else if (p.history && !p.historyLoading) {
    chart = (
      <p className="flex h-full items-center justify-center text-sm text-muted">{p.emptyMessage}</p>
    );
  } else if (p.historyError && !p.historyLoading) {
    chart = (
      <InlineError
        className="h-full justify-center"
        message="Price history could not be loaded."
        onRetry={p.onRetry}
      />
    );
  } else {
    chart = <Skeleton className="h-full w-full" />;
  }

  const chartLabel = p.compareOn
    ? `Chart comparing ${p.compareLines.map((l) => l.symbol).join(", ")} against gold, indexed to 100, ${label}`
    : `Chart of 1 ${p.symbol} priced in gold ${p.unit === "oz" ? "troy ounces" : "grams"}, ${label}`;

  return (
    <Card className="p-3 md:p-4" aria-label="Ratio chart">
      <div className="flex flex-wrap items-center gap-2">
        <RangeSelector
          value={p.range}
          availability={p.availability}
          onChange={p.onRangeChange}
          onHint={setHint}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={p.compareOn}
            onClick={p.onToggleCompare}
            className={cx(toolButton, pressed(p.compareOn))}
          >
            <LayersIcon size={14} /> Compare
          </button>
          <button
            type="button"
            aria-pressed={p.logScale}
            onClick={() => p.onLogScale(!p.logScale)}
            title="Logarithmic scale"
            className={cx(toolButton, pressed(p.logScale))}
          >
            log
          </button>
          <button
            type="button"
            onClick={() => chartRef.current?.fit()}
            aria-label="Reset zoom"
            title="Reset zoom (or double-click the chart)"
            className={cx(toolButton, pressed(false))}
          >
            <FitIcon size={14} />
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!p.history || p.compareOn}
            title={
              p.compareOn ? "CSV export is for a single coin" : "Download the ratio series as CSV"
            }
            className={cx(toolButton, pressed(false))}
          >
            <DownloadIcon size={14} /> CSV
          </button>
          <button
            type="button"
            onClick={exportPng}
            title="Download the chart as PNG"
            className={cx(toolButton, pressed(false))}
          >
            <DownloadIcon size={14} /> PNG
          </button>
        </div>
      </div>

      <p className="mt-1 min-h-4 text-xs text-muted" aria-live="polite">
        {hint ?? ""}
      </p>

      {p.compareOn && (
        <div
          className="mb-2 flex flex-wrap items-center gap-2"
          role="group"
          aria-label={`Coins to compare, up to ${MAX_COMPARE}`}
        >
          {p.compareCandidates.map((c) => {
            const idx = p.compareIds.indexOf(c.id);
            const selected = idx >= 0;
            const full = p.compareIds.length >= MAX_COMPARE;
            const color = p.compareLines.find((l) => l.id === c.id)?.color;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={selected}
                disabled={!selected && full}
                onClick={() => p.onToggleCompareId(c.id)}
                title={!selected && full ? `Up to ${MAX_COMPARE} coins` : undefined}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm disabled:opacity-50",
                  selected ? "border-fg font-semibold" : "border-border text-muted hover:text-fg",
                )}
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 rounded-full border border-border"
                  style={selected && color ? { background: color, borderColor: color } : undefined}
                />
                {c.symbol}
              </button>
            );
          })}
          <span className="text-xs text-muted">
            {p.compareIds.length}/{MAX_COMPARE} selected
          </span>
        </div>
      )}

      {/* While a chart is drawn, the container is an image described by the summary; otherwise
          its contents (errors, retry buttons) stay accessible. */}
      <div
        role={chartShown ? "img" : undefined}
        aria-label={chartShown ? chartLabel : undefined}
        aria-describedby={chartShown ? SUMMARY_ID : undefined}
        className={cx(
          "relative h-[280px] md:h-[360px] lg:h-[clamp(320px,48vh,520px)]",
          p.historyFetching && !p.compareOn && "opacity-80 transition-opacity",
        )}
        data-testid="chart-area"
      >
        {chart}
      </div>

      {p.compareOn && p.compareLines.length >= 2 && (
        <ul
          className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm"
          aria-label="Compared coins"
          data-testid="compare-legend"
        >
          {p.compareLines.map((l) => {
            const last = l.points[l.points.length - 1]?.value ?? 100;
            return (
              <li key={l.id} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-4 rounded"
                  style={{ background: l.color, height: 3 }}
                />
                <span className="font-semibold">{l.symbol}</span>
                <span>{last.toFixed(1)}</span>
                <ChangeText pct={last - 100} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
