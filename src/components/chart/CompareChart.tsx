"use client";

import type { UTCTimestamp } from "lightweight-charts";
import { useCallback, useMemo, type Ref } from "react";
import { CHART_THEME, type ResolvedTheme } from "@/lib/palette";
import { bucketSize, markGaps, type TimedValue } from "@/lib/ratio";
import type { Granularity } from "@/lib/types";
import { ChartTooltip } from "./ChartTooltip";
import { useChartHover } from "./useChartHover";
import {
  TimeSeriesChart,
  type ChartSeriesSpec,
  type PriceLineSpec,
  type TimeSeriesChartHandle,
} from "./TimeSeriesChart";
import { compareTooltip } from "./tooltip";

export interface CompareLineView {
  id: string;
  symbol: string;
  color: string;
  points: TimedValue[];
}

export interface CompareChartProps {
  lines: CompareLineView[];
  granularity: Granularity;
  logScale: boolean;
  theme: ResolvedTheme;
  resetKey: string;
  chartRef?: Ref<TimeSeriesChartHandle>;
}

/** Several coins' gold ratios, each indexed to 100 at the common start (FR-9). */
export default function CompareChart({
  lines,
  granularity,
  logScale,
  theme,
  resetKey,
  chartRef,
}: CompareChartProps) {
  const { wrapRef, hover, onCrosshair } = useChartHover();

  const series = useMemo<ChartSeriesSpec[]>(
    () =>
      lines.map((l) => ({
        id: l.id,
        kind: "line",
        color: l.color,
        data: markGaps(l.points, bucketSize(granularity)).map((p) => ({
          time: (p.t / 1000) as UTCTimestamp,
          value: p.value,
        })),
      })),
    [lines, granularity],
  );

  const priceLines = useMemo<PriceLineSpec[]>(
    () => [{ id: "base", price: 100, title: "Start", color: CHART_THEME[theme].muted }],
    [theme],
  );

  const lookups = useMemo(
    () => lines.map((l) => new Map(l.points.map((p) => [p.t, p.value]))),
    [lines],
  );
  const formatValue = useCallback((v: number) => v.toFixed(1), []);

  const content = hover
    ? compareTooltip(
        hover.time,
        granularity,
        lines.map((l, i) => ({
          symbol: l.symbol,
          color: l.color,
          value: lookups[i].get(hover.time),
        })),
      )
    : null;

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
        resetKey={resetKey}
      />
      <span className="pointer-events-none absolute top-1 left-2 z-10 text-xs text-muted">
        Index, start = 100
      </span>
      {content && hover && <ChartTooltip content={content} x={hover.x} width={hover.width} />}
    </div>
  );
}
