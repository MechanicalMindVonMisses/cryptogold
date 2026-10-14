import type { ReactNode } from "react";
import { formatPointTime, formatRatio } from "@/lib/format";
import type { Granularity, RatioStats, Unit } from "@/lib/types";
import { ChangeText } from "./Change";
import { Card, Skeleton } from "./ui/primitives";

export interface KpiChanges {
  "24h": number | null;
  "7D": number | null;
  "30D": number | null;
  "1Y": number | null;
}

interface Props {
  unit: Unit;
  currentOz: number | undefined;
  changes: KpiChanges;
  stats: RatioStats | null;
  rangeLabel: string;
  /** Intraday series show the time of the high/low, daily series the date. */
  granularity: Granularity;
  loading: boolean;
}

function Kpi({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex min-h-[112px] flex-col p-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="mt-2 flex flex-1 flex-col justify-center">{children}</div>
    </Card>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <div className="text-xl font-semibold md:text-2xl">{children}</div>;
}

/** Current value, changes versus gold and the selected period's extremes (FR-6). */
export function KpiStrip({
  unit,
  currentOz,
  changes,
  stats,
  rangeLabel,
  granularity,
  loading,
}: Props) {
  const other: Unit = unit === "oz" ? "g" : "oz";
  const placeholder = loading ? <Skeleton className="h-7 w-24" /> : <Big>—</Big>;
  const extreme = (point: { value: number; t: number }) => (
    <>
      <Big>{formatRatio(point.value, unit).text}</Big>
      <div className="text-sm text-muted">{formatPointTime(point.t, granularity)}</div>
    </>
  );
  return (
    <section aria-labelledby="kpi-heading">
      <h2 id="kpi-heading" className="sr-only">
        Key figures
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-strip">
        <Kpi title="Current">
          {currentOz !== undefined ? (
            <>
              <Big>{formatRatio(currentOz, unit).text}</Big>
              <div className="text-sm text-muted">{formatRatio(currentOz, other).text}</div>
            </>
          ) : (
            placeholder
          )}
        </Kpi>
        <Kpi title="Change vs gold">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {(Object.keys(changes) as Array<keyof KpiChanges>).map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right">
                  {changes[k] === null && loading ? (
                    <Skeleton className="ml-auto h-4 w-14" />
                  ) : (
                    <ChangeText pct={changes[k]} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Kpi>
        <Kpi title={`${rangeLabel} high`}>{stats ? extreme(stats.high) : placeholder}</Kpi>
        <Kpi title={`${rangeLabel} low`}>{stats ? extreme(stats.low) : placeholder}</Kpi>
      </div>
    </section>
  );
}
