"use client";

import type { AvailabilityMap } from "@/lib/availability";
import { RANGE_KEYS, RANGES } from "@/lib/ranges";
import type { RangeKey } from "@/lib/types";
import { cx } from "./ui/primitives";

/**
 * Range chips (FR-3). Unavailable ranges stay focusable (aria-disabled) so their reason can be read:
 * it is announced via aria-describedby and shown under the toolbar on hover/focus.
 */
export function RangeSelector({
  value,
  availability,
  onChange,
  onHint,
}: {
  value: RangeKey;
  availability: AvailabilityMap;
  onChange: (r: RangeKey) => void;
  onHint: (text: string | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="scroll-row -mx-1 flex gap-1 overflow-x-auto px-1 py-0.5"
    >
      {RANGE_KEYS.map((k) => {
        const a = availability[k];
        const reasonId = `range-reason-${k}`;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={value === k}
            aria-disabled={a.enabled ? undefined : true}
            aria-describedby={a.enabled ? undefined : reasonId}
            title={a.reason}
            onClick={() => (a.enabled ? onChange(k) : onHint(a.reason ?? null))}
            onMouseEnter={() => !a.enabled && onHint(a.reason ?? null)}
            onMouseLeave={() => onHint(null)}
            onFocus={() => !a.enabled && onHint(a.reason ?? null)}
            onBlur={() => onHint(null)}
            className={cx(
              "min-w-11 shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium",
              value === k ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg",
              !a.enabled && "cursor-not-allowed line-through opacity-60 hover:bg-transparent",
            )}
          >
            {RANGES[k].label}
            {!a.enabled && (
              <span id={reasonId} className="sr-only">
                Unavailable: {a.reason}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
