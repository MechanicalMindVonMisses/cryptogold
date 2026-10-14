"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { formatPointTime } from "@/lib/format";
import { CHART_THEME, type ResolvedTheme } from "@/lib/palette";
import type { Granularity } from "@/lib/types";

export interface ChartPoint {
  time: UTCTimestamp;
  /** Omitted for a break in the line (a recording gap). */
  value?: number;
}

export interface ChartSeriesSpec {
  id: string;
  kind: "area" | "line";
  color: string;
  /** Area fill colour (area series only). */
  fill?: string;
  data: ChartPoint[];
}

export interface PriceLineSpec {
  id: string;
  price: number;
  title: string;
  color: string;
}

export interface CrosshairState {
  /** Hovered bucket in epoch ms. */
  time: number;
  x: number;
  y: number;
}

export interface TimeSeriesChartHandle {
  screenshot(): HTMLCanvasElement | null;
  fit(): void;
}

interface Props {
  series: ChartSeriesSpec[];
  priceLines?: PriceLineSpec[];
  granularity: Granularity;
  logScale: boolean;
  theme: ResolvedTheme;
  formatValue: (value: number) => string;
  onCrosshair?: (state: CrosshairState | null) => void;
  /** Changing this refits the time axis (new coin or range); unit changes keep the user's zoom. */
  resetKey: string;
  className?: string;
  ref?: Ref<TimeSeriesChartHandle>;
}

const FONT = "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";

function tickFormatter(granularity: Granularity) {
  // Daily buckets are UTC dates; hourly points are shown in the viewer's local time.
  const timeZone = granularity === "day" ? "UTC" : undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...opts, timeZone });
  const year = fmt({ year: "numeric" });
  const month = fmt({ month: "short" });
  const day = fmt({ day: "numeric", month: "short" });
  const clock = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  return (time: Time, type: TickMarkType) => {
    const ms = (time as number) * 1000;
    switch (type) {
      case TickMarkType.Year:
        return year.format(ms);
      case TickMarkType.Month:
        return month.format(ms);
      case TickMarkType.DayOfMonth:
        return day.format(ms);
      default:
        return clock.format(ms);
    }
  };
}

function themeOptions(theme: ResolvedTheme) {
  const t = CHART_THEME[theme];
  return {
    layout: {
      background: { type: ColorType.Solid, color: t.surface },
      textColor: t.muted,
      fontFamily: FONT,
      attributionLogo: false,
    },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border },
    crosshair: {
      vertLine: { color: t.muted, labelBackgroundColor: t.text },
      horzLine: { color: t.muted, labelBackgroundColor: t.text },
    },
  };
}

export function TimeSeriesChart({
  series,
  priceLines = [],
  granularity,
  logScale,
  theme,
  formatValue,
  onCrosshair,
  resetKey,
  className,
  ref,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const linesRef = useRef<Array<{ series: ISeriesApi<SeriesType>; line: IPriceLine }>>([]);
  const lastResetKey = useRef<string | null>(null);
  const crosshairCb = useRef(onCrosshair);
  useEffect(() => {
    crosshairCb.current = onCrosshair;
  }, [onCrosshair]);

  useImperativeHandle(ref, () => ({
    screenshot: () => chartRef.current?.takeScreenshot() ?? null,
    fit: () => chartRef.current?.timeScale().fitContent(),
  }));

  // Create once; tear down on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const base = themeOptions("light");
    const chart = createChart(el, {
      ...base,
      autoSize: true,
      handleScroll: true,
      handleScale: true,
      crosshair: { ...base.crosshair, mode: CrosshairMode.Magnet },
      rightPriceScale: { ...base.rightPriceScale, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { ...base.timeScale, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
    });
    chartRef.current = chart;
    const seriesMap = seriesRef.current;
    const handler = (param: MouseEventParams) => {
      if (!param.point || param.time === undefined) {
        crosshairCb.current?.(null);
        return;
      }
      crosshairCb.current?.({
        time: (param.time as number) * 1000,
        x: param.point.x,
        y: param.point.y,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => {
      chart.unsubscribeCrosshairMove(handler);
      chart.remove();
      chartRef.current = null;
      seriesMap.clear();
      linesRef.current = [];
      lastResetKey.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions(themeOptions(theme));
  }, [theme]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: {
        timeVisible: granularity !== "day",
        secondsVisible: false,
        tickMarkFormatter: tickFormatter(granularity),
      },
      localization: {
        timeFormatter: (t: Time) => formatPointTime((t as number) * 1000, granularity),
      },
    });
  }, [granularity]);

  useEffect(() => {
    chartRef.current
      ?.priceScale("right")
      .applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [logScale]);

  // Series data. Measures setData time for the performance budget (NFR-1).
  useEffect(() => {
    const chart = chartRef.current;
    const el = containerRef.current;
    if (!chart || !el) return;
    const map = seriesRef.current;
    for (const [id, s] of map) {
      if (!series.some((spec) => spec.id === id)) {
        chart.removeSeries(s);
        map.delete(id);
      }
    }
    const started = performance.now();
    for (const spec of series) {
      const priceFormat = { type: "custom" as const, formatter: formatValue, minMove: 1e-12 };
      let s = map.get(spec.id);
      if (!s) {
        s =
          spec.kind === "area"
            ? chart.addSeries(AreaSeries, {
                lineColor: spec.color,
                topColor: spec.fill ?? "transparent",
                bottomColor: "transparent",
                lineWidth: 2,
                priceFormat,
                priceLineVisible: false,
              })
            : chart.addSeries(LineSeries, {
                color: spec.color,
                lineWidth: 2,
                priceFormat,
                priceLineVisible: false,
              });
        map.set(spec.id, s);
      } else if (spec.kind === "area") {
        s.applyOptions({
          lineColor: spec.color,
          topColor: spec.fill ?? "transparent",
          priceFormat,
        });
      } else {
        s.applyOptions({ color: spec.color, priceFormat });
      }
      s.setData(spec.data);
    }
    el.dataset.renderMs = (performance.now() - started).toFixed(1);
    el.dataset.points = String(
      series.reduce((n, s) => n + s.data.filter((d) => d.value !== undefined).length, 0),
    );
    if (lastResetKey.current !== resetKey) {
      chart.timeScale().fitContent();
      lastResetKey.current = resetKey;
    }
  }, [series, formatValue, resetKey]);

  // Horizontal reference lines (period high/low/average, or the 100 baseline).
  useEffect(() => {
    for (const { series: s, line } of linesRef.current) s.removePriceLine(line);
    linesRef.current = [];
    const primary = series[0] && seriesRef.current.get(series[0].id);
    if (!primary) return;
    for (const spec of priceLines) {
      const line = primary.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: spec.title,
      });
      linesRef.current.push({ series: primary, line });
    }
  }, [priceLines, series]);

  return (
    <div
      ref={containerRef}
      className={className}
      onDoubleClick={() => chartRef.current?.timeScale().fitContent()}
      data-testid="chart-canvas"
    />
  );
}
