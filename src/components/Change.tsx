import { formatChange } from "@/lib/format";
import { cx } from "./ui/primitives";

const tone = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

/** Signed change with an arrow; colour is never the only signal (FR-6). */
export function ChangeText({
  pct,
  className,
}: {
  pct: number | null | undefined;
  className?: string;
}) {
  const c = formatChange(pct);
  return (
    <span className={cx("whitespace-nowrap font-medium", tone[c.direction], className)}>
      {c.arrow && <span aria-hidden="true">{c.arrow} </span>}
      <span aria-hidden="true">{c.text}</span>
      <span className="sr-only">{c.label}</span>
    </span>
  );
}

export function ChangeChip({ pct, period }: { pct: number | null | undefined; period: string }) {
  const c = formatChange(pct);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-sm",
        tone[c.direction],
      )}
    >
      <span aria-hidden="true">{c.arrow}</span>
      <span aria-hidden="true" className="font-semibold">
        {c.text}
      </span>
      <span aria-hidden="true" className="text-muted">
        {period}
      </span>
      <span className="sr-only">
        {c.label} over {period}
      </span>
    </span>
  );
}
