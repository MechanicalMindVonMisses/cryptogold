"use client";

import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSearch } from "@/hooks/queries";
import type { SearchResult } from "@/lib/types";
import { CoinIcon } from "./CoinIcon";
import { CheckIcon, PlusIcon, SearchIcon } from "./ui/icons";
import { cx } from "./ui/primitives";

export const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  watchlist: readonly string[];
  watchlistFull: boolean;
  onSelect: (result: SearchResult) => void;
  onAdd: (result: SearchResult) => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  /** Called after a choice or Escape on an empty box (closes the mobile search). */
  onDone?: () => void;
}

/** ARIA 1.2 combobox: type to search, ↑/↓ to move, Enter to view, Shift+Enter to add, Esc to close. */
export function SearchBox({
  watchlist,
  watchlistFull,
  onSelect,
  onAdd,
  inputRef,
  autoFocus,
  onDone,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const search = useSearch(debounced);
  const listId = useId();
  const hintId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const term = debounced.trim();
  const ready = term.length >= 2 && query.trim().length >= 2;
  const results = ready ? (search.data?.results ?? []) : [];
  const showList = open && query.trim().length >= 2;
  const optionId = (i: number) => `${listId}-option-${i}`;

  function reset() {
    setQuery("");
    setActive(-1);
    setOpen(false);
  }

  function choose(result: SearchResult, mode: "select" | "add") {
    if (mode === "add") onAdd(result);
    else onSelect(result);
    reset();
    onDone?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        setActive((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (showList && active >= 0 && results[active]) {
          e.preventDefault();
          choose(results[active], e.shiftKey ? "add" : "select");
        }
        break;
      case "Escape":
        if (showList) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else {
          reset();
          onDone?.();
        }
        break;
    }
  }

  return (
    <div className="relative w-full">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search any coin
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input
        id={`${listId}-input`}
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder="Search any coin…"
        maxLength={50}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-muted focus:border-focus focus:outline-none"
      />
      <p id={hintId} className="sr-only">
        Type at least two letters. Use the arrow keys to browse results, Enter to view a coin, Shift
        and Enter to add it to your watchlist.
      </p>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching coins"
          onMouseDown={(e) => {
            // Keep focus in the input while clicking results.
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
          className="absolute top-full right-0 left-0 z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-xl"
        >
          {results.map((r, i) => {
            const tracked = watchlist.includes(r.id);
            return (
              <li
                key={r.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onClick={() => choose(r, "select")}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                  i === active && "bg-surface-2",
                )}
              >
                <CoinIcon src={r.thumb} symbol={r.symbol} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-fg">{r.name}</span>{" "}
                  <span className="text-muted">{r.symbol}</span>
                </span>
                {r.rank !== null && <span className="text-xs text-muted">#{r.rank}</span>}
                {/* Options can't contain controls (ARIA 1.2), so "+" is a pointer shortcut; keyboard users press Shift+Enter. */}
                <span
                  aria-hidden="true"
                  data-testid={`add-${r.id}`}
                  title={
                    tracked
                      ? "In watchlist"
                      : watchlistFull
                        ? "Watchlist is full (20 coins)"
                        : "Add to watchlist"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!tracked && !watchlistFull) choose(r, "add");
                  }}
                  className={cx(
                    "rounded-md border border-border p-1",
                    tracked || watchlistFull ? "text-muted opacity-60" : "text-muted hover:text-fg",
                  )}
                >
                  {tracked ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
                </span>
                {tracked && <span className="sr-only">(in watchlist)</span>}
              </li>
            );
          })}
          {ready && search.isFetching && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted">
              Searching…
            </li>
          )}
          {!ready && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted">
              Searching…
            </li>
          )}
          {ready && !search.isFetching && search.isSuccess && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-muted">
              No coins match “{term}”.
            </li>
          )}
          {ready && search.isError && results.length === 0 && (
            <li
              role="presentation"
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted"
            >
              Search is unavailable right now.
              <button type="button" className="underline" onClick={() => search.refetch()}>
                Retry
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
