"use client";

import { useState } from "react";
import { useHistory } from "@/hooks/queries";
import { useInView } from "@/hooks/useInView";
import { formatChange, formatRatio } from "@/lib/format";
import { MAX_WATCHLIST } from "@/state/dashboard-state";
import type { CoinSpotDto, Unit } from "@/lib/types";
import { ChangeText } from "./Change";
import { CoinIcon } from "./CoinIcon";
import { Modal } from "./Modal";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  GripIcon,
  ListIcon,
  PlusIcon,
} from "./ui/icons";
import { Card, cx, Skeleton } from "./ui/primitives";

export interface WatchItem {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  spot: CoinSpotDto | undefined;
  /** The coin source no longer knows this id. */
  unavailable: boolean;
}

interface WatchlistProps {
  items: WatchItem[];
  selectedId: string;
  unit: Unit;
  loading: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onAddClick: () => void;
}

/** Inline SVG of the last 7 days of the ratio, fetched only once the row is visible. */
export function Sparkline({ id, symbol }: { id: string; symbol: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const query = useHistory(id, "7d", inView);
  const values = query.data?.id === id ? query.data.points.map((p) => p.ratioOz) : [];

  let content = query.isError ? (
    <span className="text-xs text-muted">—</span>
  ) : (
    <Skeleton className="h-6 w-16" />
  );
  let tone = "";
  if (values.length >= 2) {
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    const d = values
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * 64).toFixed(1)},${(22 - ((v - min) / span) * 20).toFixed(1)}`,
      )
      .join("");
    const change = formatChange((values[values.length - 1] / values[0] - 1) * 100);
    tone = change.direction === "down" ? "text-down" : "text-up";
    content = (
      <svg
        viewBox="0 0 64 24"
        width="64"
        height="24"
        role="img"
        aria-label={`${symbol} 7-day trend: ${change.label}`}
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <span ref={ref} className={cx("inline-flex h-6 w-16 shrink-0 items-center", tone)}>
      {content}
    </span>
  );
}

function RowControls({
  item,
  index,
  count,
  onMove,
  onRemove,
}: { item: WatchItem; index: number; count: number } & Pick<
  WatchlistProps,
  "onMove" | "onRemove"
>) {
  const btn = "rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30";
  return (
    // On desktop the controls overlay the sparkline on hover/focus (still focusable); elsewhere they show inline.
    // Unavailable rows always show their controls so the remove button is obvious (§11).
    <div
      className={cx(
        "flex shrink-0 items-center gap-0.5 lg:absolute lg:top-1/2 lg:right-1 lg:-translate-y-1/2 lg:rounded-md lg:bg-surface lg:px-1 lg:shadow",
        !item.unavailable &&
          "lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
      )}
    >
      <div className="flex flex-col">
        <button
          type="button"
          className={btn}
          disabled={index === 0}
          onClick={() => onMove(item.id, -1)}
          aria-label={`Move ${item.symbol} up`}
        >
          <ChevronUpIcon size={14} />
        </button>
        <button
          type="button"
          className={btn}
          disabled={index === count - 1}
          onClick={() => onMove(item.id, 1)}
          aria-label={`Move ${item.symbol} down`}
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>
      <button
        type="button"
        className={cx(btn, "p-1")}
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.symbol} from watchlist`}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function WatchlistList(props: WatchlistProps) {
  const { items, selectedId, unit, loading, onSelect, onReorder } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <ol className="flex flex-col gap-0.5" aria-label="Watchlist coins">
      {items.map((item, i) => {
        const selected = item.id === selectedId;
        const ratio = item.spot ? formatRatio(item.spot.ratioOz, unit).text : null;
        return (
          <li
            key={item.id}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) onReorder(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            data-testid={`watch-row-${item.id}`}
            className={cx(
              "group relative flex items-center gap-1.5 rounded-lg px-1.5 py-1.5",
              selected ? "bg-accent-soft" : "hover:bg-surface-2",
              dragOver === i && dragFrom !== i && "outline-2 outline-dashed outline-border",
            )}
          >
            <span
              className="hidden cursor-grab text-muted lg:inline"
              aria-hidden="true"
              title="Drag to reorder"
            >
              <GripIcon size={14} />
            </span>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={selected ? "true" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
            >
              <CoinIcon src={item.image} symbol={item.symbol} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-sm font-semibold">{item.symbol}</span>
                  {item.unavailable ? (
                    <span className="text-xs text-muted">Unavailable</span>
                  ) : ratio ? (
                    <span className="truncate text-sm">{ratio}</span>
                  ) : loading ? (
                    <Skeleton className="h-4 w-14" />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </span>
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-muted">{item.name}</span>
                  {item.spot && <ChangeText pct={item.spot.ratioChange24h} className="text-xs" />}
                </span>
              </span>
            </button>
            {!item.unavailable && <Sparkline id={item.id} symbol={item.symbol} />}
            <RowControls
              item={item}
              index={i}
              count={items.length}
              onMove={props.onMove}
              onRemove={props.onRemove}
            />
          </li>
        );
      })}
    </ol>
  );
}

export function WatchlistPanel(props: WatchlistProps) {
  return (
    <Card className="p-3" aria-labelledby="watchlist-heading">
      <div className="mb-2 flex items-baseline justify-between px-1.5">
        <h2
          id="watchlist-heading"
          className="text-xs font-semibold tracking-wide text-muted uppercase"
        >
          Watchlist
        </h2>
        <span className="text-xs text-muted">
          {props.items.length}/{MAX_WATCHLIST}
        </span>
      </div>
      <WatchlistList {...props} />
      <button
        type="button"
        onClick={props.onAddClick}
        disabled={props.items.length >= MAX_WATCHLIST}
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
      >
        <PlusIcon size={14} /> Add coin
      </button>
      <p className="mt-1 px-1.5 text-xs text-muted">24h change is versus gold.</p>
    </Card>
  );
}

/** Phone layout: a scrollable chip row plus a bottom sheet with the full list. */
export function MobileWatchlist(props: WatchlistProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav
        aria-label="Watchlist"
        className="scroll-row -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden"
      >
        {props.items.map((item) => {
          const selected = item.id === props.selectedId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onSelect(item.id)}
              aria-current={selected ? "true" : undefined}
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                selected
                  ? "border-accent bg-accent-soft font-semibold"
                  : "border-border bg-surface",
              )}
            >
              <CoinIcon src={item.image} symbol={item.symbol} size={16} />
              {item.symbol}
              {item.spot && (
                <span className="text-muted">
                  {formatRatio(item.spot.ratioOz, props.unit).text}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-muted"
        >
          <ListIcon size={14} /> All
        </button>
      </nav>
      <Modal open={open} onClose={() => setOpen(false)} title="Watchlist" variant="sheet">
        <WatchlistList
          {...props}
          onSelect={(id) => {
            props.onSelect(id);
            setOpen(false);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            props.onAddClick();
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm"
        >
          <PlusIcon size={14} /> Add coin
        </button>
      </Modal>
    </>
  );
}
