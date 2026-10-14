"use client";

import { formatClock, formatDate } from "@/lib/format";
import type { CoinPriceSource, GoldSource, ThemePref } from "@/lib/types";
import { Modal } from "./Modal";
import { OfflineIcon } from "./ui/icons";

export const DISCLAIMER = "Indicative prices, not financial advice.";

export interface ProvenanceInfo {
  goldSource: GoldSource | undefined;
  goldAsOf: string | undefined;
  coinsAsOf: string | undefined;
  /** Source of the selected coin's live price. */
  coinPriceSource: CoinPriceSource | undefined;
  historyGoldSource: GoldSource | undefined;
  /** When AuRatio started recording the selected coin, and its latest saved price (ms). */
  recordedFrom: number | null | undefined;
  lastRecordedAt: number | null | undefined;
  fx: { rate: number; asOf: string; source: string } | undefined;
}

const link = "underline decoration-border underline-offset-2 hover:decoration-fg";

function goldLabel(source: GoldSource | undefined): string {
  return source === "paxg" ? "PAXG proxy (fallback)" : "XAUS";
}

const PRICE_SOURCE_LABEL: Record<CoinPriceSource, string> = {
  freecryptoapi: "FreeCryptoAPI",
  coingecko: "CoinGecko (fallback)",
  binance: "Binance (fallback)",
};

function priceLabel(source: CoinPriceSource | undefined): string {
  return source ? PRICE_SOURCE_LABEL[source] : "FreeCryptoAPI";
}

/** Footer: sources, last update per source and the disclaimer (FR-11). */
export function Footer({ info }: { info: ProvenanceInfo }) {
  return (
    <footer className="mt-8 border-t border-border" data-testid="footer">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1.5 px-4 py-5 text-xs text-muted md:flex-row md:flex-wrap md:items-center md:gap-x-4">
        <span>
          Sources:{" "}
          <a className={link} href="https://xaus.com" target="_blank" rel="noreferrer">
            XAUS
          </a>{" "}
          (gold
          {info.goldSource === "paxg" || info.historyGoldSource === "paxg"
            ? "; PAXG fallback in use"
            : ""}
          ),{" "}
          <a className={link} href="https://freecryptoapi.com" target="_blank" rel="noreferrer">
            FreeCryptoAPI
          </a>{" "}
          (coin prices; history recorded by AuRatio),{" "}
          <a className={link} href="https://www.coingecko.com" target="_blank" rel="noreferrer">
            CoinGecko
          </a>{" "}
          (search, names)
        </span>
        <span data-testid="footer-updated">
          Gold ({goldLabel(info.goldSource)}){" "}
          {info.goldAsOf ? `updated ${formatClock(info.goldAsOf)}` : "loading"}
          {" · "}Coins ({priceLabel(info.coinPriceSource)}){" "}
          {info.coinsAsOf ? `updated ${formatClock(info.coinsAsOf)}` : "loading"}
          {info.recordedFrom ? ` · Recording since ${formatDate(info.recordedFrom)}` : ""}
          {info.lastRecordedAt ? `, last saved ${formatClock(info.lastRecordedAt)}` : ""}
        </span>
        <span>
          Charts:{" "}
          <a className={link} href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts
          </a>
        </span>
        <strong className="font-semibold text-fg md:ml-auto">{DISCLAIMER}</strong>
      </div>
    </footer>
  );
}

interface InfoDialogProps {
  open: boolean;
  onClose: () => void;
  info: ProvenanceInfo;
  themePref: ThemePref;
  onUseSystemTheme: () => void;
}

/** Methodology and source details (FR-11, §7). */
export function InfoDialog({ open, onClose, info, themePref, onUseSystemTheme }: InfoDialogProps) {
  const rows: Array<[string, string, string]> = [
    ["Gold (live)", goldLabel(info.goldSource), info.goldAsOf ? formatClock(info.goldAsOf) : "—"],
    [
      "Coin prices",
      priceLabel(info.coinPriceSource),
      info.coinsAsOf ? formatClock(info.coinsAsOf) : "—",
    ],
    ["Coin names, 24h change", "CoinGecko", "every 5 min"],
    [
      "Chart history",
      `Recorded by AuRatio: FreeCryptoAPI + ${goldLabel(info.historyGoldSource)}`,
      info.lastRecordedAt ? formatClock(info.lastRecordedAt) : "—",
    ],
  ];
  if (info.fx) rows.push(["USD/TRY rate", info.fx.source, formatClock(info.fx.asOf)]);

  return (
    <Modal open={open} onClose={onClose} title="About AuRatio">
      <div className="space-y-4 text-sm leading-relaxed">
        <p>
          AuRatio shows how much gold one unit of a cryptocurrency is worth. Pricing a coin in gold
          instead of dollars shows whether it gained purchasing power against a hard asset.
        </p>

        <section>
          <h3 className="mb-1 font-semibold">Method</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>
              <span className="text-fg">Ratio (oz)</span> = coin price in USD ÷ gold price in USD
              per troy ounce. <span className="text-fg">Grams</span> = ounces × 31.1034768 (one troy
              ounce), computed in your browser.
            </li>
            <li>
              Charts use prices AuRatio records itself. Every minute while the AuRatio server runs,
              it saves the FreeCryptoAPI price of each coin you follow and the XAUS spot gold price.
              A coin’s history therefore starts when its recording started, and time with the server
              switched off shows as a gap in the line.
            </li>
            <li>
              Per-minute prices are kept for 8 days; the last price of every hour is kept for good.
              7D and 1M show hourly points (per-minute while a coin has only a few hours recorded);
              3M and longer show each day’s last price (UTC).
            </li>
            <li>
              If a gold price is missing for a moment, the previous one is carried forward and the
              tooltip says so.
            </li>
            <li>
              The 24-hour change is the coin’s 24-hour change in USD (CoinGecko), adjusted for
              gold’s own 24-hour move (XAUS).
            </li>
            <li>
              Live coin prices come from FreeCryptoAPI (Binance market prices in USDT, which tracks
              USD closely, typically within 0.5%). Each price is checked against CoinGecko’s price
              for the same coin, so a different coin that shares the ticker can never supply it;
              CoinGecko is the fallback.
            </li>
            <li>CoinGecko provides search, coin names and icons, and the 24-hour change.</li>
            <li>
              If XAUS is unavailable, gold is priced from PAXG, a token backed by one troy ounce of
              LBMA gold (FreeCryptoAPI, then CoinGecko, then Binance).
            </li>
            <li>Live prices refresh every 60 seconds while this tab is visible.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">Sources and last update</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Data</th>
                <th className="py-1 font-medium">Source</th>
                <th className="py-1 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([data, source, time]) => (
                <tr key={data} className="border-t border-border">
                  <td className="py-1.5">{data}</td>
                  <td className="py-1.5">{source}</td>
                  <td className="py-1.5 text-right">{time}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {info.fx && (
            <p className="mt-1 text-xs text-muted">
              1 USD = {info.fx.rate.toFixed(4)} TRY. TRY affects displayed prices only, never
              ratios.
            </p>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-muted">
            Theme:{" "}
            {themePref === "system"
              ? "following your system setting"
              : `${themePref} (chosen manually)`}
          </span>
          {themePref !== "system" && (
            <button
              type="button"
              onClick={onUseSystemTheme}
              className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2"
            >
              Use system theme
            </button>
          )}
        </section>

        <p className="font-semibold">
          {DISCLAIMER} No accounts, no tracking: settings stay in this browser.
        </p>
      </div>
    </Modal>
  );
}

/** Shown while the browser is offline: the last data stays on screen (§11). */
export function OfflineBanner({
  offline,
  lastUpdated,
}: {
  offline: boolean;
  lastUpdated: number | undefined;
}) {
  if (!offline) return null;
  return (
    <div role="status" className="bg-warn-bg text-warn-text" data-testid="offline-banner">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2 text-sm font-medium">
        <OfflineIcon />
        Offline — showing data from {lastUpdated ? formatClock(lastUpdated) : "earlier"}
      </div>
    </div>
  );
}
