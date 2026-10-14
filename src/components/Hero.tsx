"use client";

import { formatClock, formatMoney, formatRatio, formatRatioLong } from "@/lib/format";
import { GRAMS_PER_TROY_OUNCE } from "@/lib/ratio";
import type { CoinSpotDto, DisplayCurrency, GoldSpotDto, Unit } from "@/lib/types";
import type { PriceDisplay } from "./chart/tooltip";
import { ChangeChip } from "./Change";
import { CoinIcon } from "./CoinIcon";
import type { BadgeSpec } from "./status";
import { PlusIcon } from "./ui/icons";
import { Badge, Card, cx, InlineError, Skeleton } from "./ui/primitives";

export function CurrencyToggle({
  value,
  onChange,
}: {
  value: DisplayCurrency;
  onChange: (c: DisplayCurrency) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Price currency"
      className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs"
    >
      {(["USD", "TRY"] as const).map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cx(
            "rounded-md px-2 py-0.5 font-medium",
            value === c ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export interface HeroProps {
  symbol: string;
  name: string;
  image: string | null;
  coin: CoinSpotDto | undefined;
  gold: GoldSpotDto | undefined;
  unit: Unit;
  /** Display currency for prices; ratios never depend on it. */
  price: PriceDisplay;
  currencySetting: DisplayCurrency;
  onCurrencyChange: (c: DisplayCurrency) => void;
  badges: BadgeSpec[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  unavailable: boolean;
  inWatchlist: boolean;
  watchlistFull: boolean;
  onAdd: () => void;
}

/** The headline answer, "1 BTC = 19.79 oz of gold", with live prices and status (FR-1, FR-10, FR-12). */
export function Hero(p: HeroProps) {
  const other: Unit = p.unit === "oz" ? "g" : "oz";

  let body;
  if (p.coin && p.gold) {
    const primary = formatRatio(p.coin.ratioOz, p.unit);
    const money = (usd: number) => formatMoney(usd * p.price.rate, p.price.currency);
    body = (
      <>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1
            className="flex flex-wrap items-baseline gap-x-2 text-[32px] leading-tight font-semibold tracking-tight md:text-[44px]"
            data-testid="hero-ratio"
          >
            <span>1 {p.symbol} =</span>{" "}
            <span
              className="text-accent"
              title={primary.unit === "mg" ? formatRatioLong(p.coin.ratioOz, p.unit) : undefined}
            >
              {primary.text}
            </span>{" "}
            <span className="text-xl font-normal text-muted md:text-2xl">of gold</span>
          </h1>
          <ChangeChip pct={p.coin.ratioChange24h} period="24h" />
        </div>
        <p
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted"
          data-testid="hero-details"
        >
          <span className="font-medium text-fg">{formatRatio(p.coin.ratioOz, other).text}</span>
          <span aria-hidden="true">·</span>
          <span>
            as of <time dateTime={p.coin.asOf}>{formatClock(p.coin.asOf)}</time>
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="price-coin">
            {p.symbol} {money(p.coin.usd)}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="price-gold-oz">Gold {money(p.gold.usdPerOz)}/oz</span>
          <span aria-hidden="true">·</span>
          <span data-testid="price-gold-g">{money(p.gold.usdPerOz / GRAMS_PER_TROY_OUNCE)}/g</span>
        </p>
      </>
    );
  } else if (p.unavailable) {
    body = (
      <div>
        <h1 className="text-2xl font-semibold">{p.symbol} is unavailable</h1>
        <p className="mt-1 text-sm text-muted">
          The price source no longer lists this coin. Pick another coin or remove it from your
          watchlist.
        </p>
      </div>
    );
  } else if (p.error && !p.loading) {
    body = <InlineError message="Live prices could not be loaded." onRetry={p.onRetry} />;
  } else {
    // Mirrors the loaded layout (heading, 24h chip that wraps on phones, two-line price row) so the
    // chart below doesn't jump when prices arrive.
    body = (
      <div aria-busy="true" aria-label="Loading live ratio">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <Skeleton className="h-10 w-[min(420px,80%)] md:h-[54px]" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-5 w-[min(560px,95%)]" />
        <Skeleton className="mt-1 h-5 w-3/5 md:hidden" />
      </div>
    );
  }

  return (
    <Card className="p-4 md:p-6" aria-label={`${p.name} priced in gold`} data-testid="hero">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <CoinIcon src={p.image} symbol={p.symbol} size={22} />
        <span className="font-medium text-fg">{p.name}</span>
        <span className="ml-auto flex items-center gap-2">
          {!p.inWatchlist && !p.unavailable && (
            <button
              type="button"
              onClick={p.onAdd}
              disabled={p.watchlistFull}
              title={p.watchlistFull ? "Watchlist is full (20 coins)" : undefined}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
            >
              <PlusIcon size={12} /> Add to watchlist
            </button>
          )}
          <CurrencyToggle value={p.currencySetting} onChange={p.onCurrencyChange} />
        </span>
      </div>
      {body}
      <div className="mt-3 flex flex-wrap gap-2 empty:hidden" role="status" aria-live="polite">
        {p.badges.map((b) => (
          <Badge key={b.id} title={b.title}>
            {b.text}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
