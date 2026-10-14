"use client";

import type { UTCTimestamp } from "lightweight-charts";
import { useMemo, type Ref } from "react";
import { axisFormatter, displayScale } from "@/lib/format";
import { CHART_THEME, type ResolvedTheme } from "@/lib/palette";
import { bucketSize, computeStats, markGaps } from "@/lib/ratio";
import type { HistoryResponse, Unit } from "@/lib/types";
import { ChartTooltip } from "./ChartTooltip";
import { useChartHover } from "./useChartHover";
import {
  TimeSeriesChart,
  type ChartSeriesSpec,
  type PriceLineSpec,
  type TimeSeriesChartHandle,
} from "./TimeSeriesChart";
import { lastCloseTimes, ratioTooltip } from "./tooltip";

export interface RatioChartProps {
  history: HistoryResponse;
  unit: Unit;
  logScale: boolean;
  theme: ResolvedTheme;
  symbol: string;
  chartRef?: Ref<TimeSeriesChartHandle>;
}

/** Historical coin/gold ratio in the current unit, with period high/low/average reference lines. */
export default function RatioChart({
  history,
  unit,
  logScale,
  theme,
  symbol,
  chartRef,
}: RatioChartProps) {
  const { points, granularity } = history;
  const colors = CHART_THEME[theme];
  const { wrapRef, hover, onCrosshair } = useChartHover();

  const stats = useMemo(() => computeStats(points), [points]);
  // Unit conversion happens here, on the client: switching oz ↔ g never refetches.
  const scale = useMemo(() => displayScale(stats?.high.value ?? 0, unit), [stats, unit]);

  const series = useMemo<ChartSeriesSpec[]>(
    () => [
      {
        id: "ratio",
        kind: "area",
        color: colors.accent,
        fill: colors.accentFill,
        data: markGaps(
          points.map((p) => ({ t: p.t, value: p.ratioOz * scale.factor })),
          bucketSize(granularity),
        ).map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.value })),
      },
    ],
    [points, scale, colors, granularity],
  );

  const priceLines = useMemo<PriceLineSpec[]>(
    () =>
      stats
        ? [
            { id: "high", price: stats.high.value * scale.factor, title: "High", color: colors.up },
            { id: "low", price: stats.low.value * scale.factor, title: "Low", color: colors.down },
            { id: "avg", price: stats.avg * scale.factor, title: "Avg", color: colors.muted },
          ]
        : [],
    [stats, scale, colors],
  );

  const indexByTime = useMemo(() => new Map(points.map((p, i) => [p.t, i])), [points]);
  const closes = useMemo(() => lastCloseTimes(points), [points]);
  const formatValue = useMemo(
    () =>
      stats
        ? axisFormatter(stats.low.value * scale.factor, stats.high.value * scale.factor)
        : axisFormatter(0, 0),
    [stats, scale],
  );

  const hoverIndex = hover ? indexByTime.get(hover.time) : undefined;
  const content =
    hoverIndex === undefined
      ? null
      : ratioTooltip(points[hoverIndex], closes[hoverIndex], { unit, symbol, granularity });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <TimeSeriesChart
        ref={chartRef}
        className="h-full w-full"
        series={series}
        priceLines={priceLines}
        granularity={granularity}
        logScale={logScale}
        theme={theme}
        formatValue={formatValue}
        onCrosshair={onCrosshair}
        resetKey={`${history.id}:${history.range}`}
      />
      <span
        className="pointer-events-none absolute top-1 left-2 z-10 text-xs text-muted"
        data-testid="chart-unit"
      >
        {scale.unit} of gold per {symbol}
      </span>
      {content && hover && <ChartTooltip content={content} x={hover.x} width={hover.width} />}
    </div>
  );
}
