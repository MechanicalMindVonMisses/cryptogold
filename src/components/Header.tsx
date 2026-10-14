"use client";

import { useRef, type Ref } from "react";
import type { ResolvedTheme } from "@/lib/palette";
import type { SearchResult, Unit } from "@/lib/types";
import { SearchBox } from "./SearchBox";
import { CloseIcon, InfoIcon, MoonIcon, SearchIcon, SunIcon } from "./ui/icons";
import { cx } from "./ui/primitives";

export function UnitToggle({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) {
  const options: Array<{ value: Unit; label: string; long: string }> = [
    { value: "oz", label: "oz", long: "troy ounces" },
    { value: "g", label: "g", long: "grams" },
  ];
  return (
    <div
      role="group"
      aria-label="Gold unit"
      className="inline-flex rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={unit === o.value}
          onClick={() => onChange(o.value)}
          title={`Show gold in ${o.long}`}
          className={cx(
            "min-w-9 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            unit === o.value ? "bg-fg text-bg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          <span className="sr-only"> ({o.long})</span>
        </button>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-fg"
    >
      {children}
    </button>
  );
}

interface HeaderProps {
  unit: Unit;
  onUnitChange: (u: Unit) => void;
  theme: ResolvedTheme;
  onThemeToggle: () => void;
  onOpenInfo: () => void;
  watchlist: readonly string[];
  watchlistFull: boolean;
  onSelectCoin: (r: SearchResult) => void;
  onAddCoin: (r: SearchResult) => void;
  searchInputRef: Ref<HTMLInputElement>;
  mobileSearch: boolean;
  onMobileSearchChange: (open: boolean) => void;
}

export function Header(props: HeaderProps) {
  const { mobileSearch, onMobileSearchChange: setMobileSearch } = props;
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchProps = {
    watchlist: props.watchlist,
    watchlistFull: props.watchlistFull,
    onSelect: props.onSelectCoin,
    onAdd: props.onAddCoin,
  };
  const closeMobileSearch = () => {
    setMobileSearch(false);
    searchButton.current?.focus();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--text)" />
            <circle
              cx="32"
              cy="32"
              r="20"
              fill="none"
              stroke="var(--accent-strong)"
              strokeWidth="5"
            />
            <path
              d="M22 40 32 22l10 18"
              fill="none"
              stroke="var(--accent-strong)"
              strokeWidth="5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-lg font-semibold tracking-tight">AuRatio</span>
          <span className="hidden text-sm text-muted xl:inline">crypto priced in gold</span>
        </div>

        <div className="ml-4 hidden max-w-md flex-1 md:block">
          <SearchBox {...searchProps} inputRef={props.searchInputRef} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="md:hidden">
            <IconButton
              ref={searchButton}
              label={mobileSearch ? "Close search" : "Search coins"}
              onClick={() => (mobileSearch ? closeMobileSearch() : setMobileSearch(true))}
            >
              {mobileSearch ? <CloseIcon /> : <SearchIcon />}
            </IconButton>
          </span>
          <UnitToggle unit={props.unit} onChange={props.onUnitChange} />
          <IconButton
            label={props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={props.onThemeToggle}
          >
            {props.theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <IconButton label="About the data and methodology" onClick={props.onOpenInfo}>
            <InfoIcon />
          </IconButton>
        </div>
      </div>
      {mobileSearch && (
        <div className="px-4 pb-3 md:hidden">
          <SearchBox {...searchProps} autoFocus onDone={closeMobileSearch} />
        </div>
      )}
    </header>
  );
}
