"use client";

import { useCallback, useRef, useState } from "react";
import type { CrosshairState } from "./TimeSeriesChart";

export interface HoverState extends CrosshairState {
  /** Chart width when the crosshair moved, used to keep the tooltip inside the chart. */
  width: number;
}

export function useChartHover() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const onCrosshair = useCallback((s: CrosshairState | null) => {
    setHover(s ? { ...s, width: wrapRef.current?.clientWidth ?? 600 } : null);
  }, []);
  return { wrapRef, hover, onCrosshair };
}
