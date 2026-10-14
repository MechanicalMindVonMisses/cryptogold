import type { TooltipContent } from "./tooltip";

/** Floating crosshair tooltip. Visual only: the summary paragraph is the chart's text alternative. */
export function ChartTooltip({
  content,
  x,
  width,
}: {
  content: TooltipContent;
  x: number;
  width: number;
}) {
  const flip = x > width * 0.6;
  return (
    <div
      aria-hidden="true"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
      style={
        flip
          ? { right: Math.max(8, width - x + 14) }
          : { left: Math.min(x + 14, Math.max(8, width - 190)) }
      }
    >
      <div className="mb-1 font-medium text-fg">{content.title}</div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        {content.rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="flex items-center gap-1.5 text-muted">
              {row.color && (
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: row.color }}
                />
              )}
              {row.label}
            </dt>
            <dd className="text-right font-medium text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
      {content.note && <div className="mt-1 text-muted italic">{content.note}</div>}
    </div>
  );
}
