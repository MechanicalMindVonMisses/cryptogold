# PRD: AuRatio — Crypto/Gold Ratio Dashboard

> **Note (October 2026):** this is the original plan the app was built from, kept as written. The built app differs
> in these ways; the [README](README.md) describes how it works now.
>
> - **Price history** is recorded by AuRatio itself: every minute it saves FreeCryptoAPI coin prices and the XAUS
>   gold price into a local SQLite database, and charts are drawn from that recording. It does not use CoinGecko or
>   Binance history (§7.1), so history starts when recording starts and 1Y/5Y/Max fill in over time.
> - **Live coin prices** come from FreeCryptoAPI (each checked against CoinGecko's price for the same coin), with
>   CoinGecko as the fallback. CoinGecko still provides search, names, icons and the 24h change.
> - **Hosting** is a Windows PC behind a Cloudflare Tunnel at www.cryptogold.me, not Vercel (§15): serverless
>   hosting can't run the background recorder.
> - **Configuration:** `FREECRYPTOAPI_KEY` is required; `COINGECKO_DEMO_API_KEY` is optional (§9.5).
> - **TRY display:** historical prices in tooltips and CSV stay in USD; only live prices are converted (§FR-10).

| Field | Value |
|---|---|
| Owner | Berke |
| Status | Draft v1.0 — ready for task breakdown |
| Date | 2026-10-11 |
| Scale | Solo developer, personal tool (shareable as a web link) |
| Codename | AuRatio ("Au" = gold) |

---

## 1. Overview

AuRatio is a browser-based dashboard that answers one question instantly and clearly: **"How much gold is one unit of this cryptocurrency worth, and how has that changed?"**

The user picks any cryptocurrency (from a pinned watchlist or by searching thousands of coins). The app shows the live crypto/gold ratio in **troy ounces or grams** (one toggle), plots how the ratio has moved over time, and writes a short **plain-language summary** of what the chart says. The interface is a single clean dashboard with no clutter, no accounts and no trading features.

**Illustrative snapshot (live data, 2026-10-11 13:23 UTC):** gold $4,195.6/oz ($134.89/g), BTC $83,039 → **1 BTC = 19.79 oz = 615.6 g of gold**.

## 2. Problem Statement

Pricing crypto in dollars mixes two moving things: the coin and the dollar. Pricing it in gold gives a "hard-asset" view of whether a coin has actually gained purchasing power. Today, getting that number means opening two price sites, dividing by hand, and converting ounces to grams. Historical crypto/gold charts exist only for Bitcoin on a few sites, rarely in grams, and never for arbitrary altcoins. Nothing explains what the chart means in plain words.

## 3. Goals and Success Metrics

| # | Goal | Metric | Target |
|---|---|---|---|
| G1 | Instant answer | Time from page load to visible live ratio for the default coin | ≤ 3 s on broadband (cold), ≤ 1 s (warm cache) |
| G2 | Any coin | Coins searchable | Every coin in the CoinGecko catalogue |
| G3 | Correct numbers | Live BTC/gold ratio vs. independent reference (XAUS `btc_gold_oz`) | Within ±0.5 % |
| G4 | Clear story | Summary generator unit-test coverage of defined scenarios | 100 % of scenarios in §7.4 pass |
| G5 | Clean, usable UI | Lighthouse Accessibility score; manual usability check | ≥ 90; a first-time user finds unit toggle + range selector without help |
| G6 | Safe | Third-party API keys exposed to the browser | 0 |

## 4. Users and Use Cases

**Primary user:** an individual crypto holder (DCA investor) who compares crypto against gold as a store of value. Comfortable with numbers, wants clarity over density. Uses desktop and phone.

| ID | Use case |
|---|---|
| UC1 | Open the app and immediately see "1 BTC = 19.79 oz (615.6 g) of gold" with today's change. |
| UC2 | Switch the unit from ounces to grams and see every number and chart update instantly. |
| UC3 | Look at a 1-year chart of ETH/gold and read a two-sentence summary of the trend. |
| UC4 | Search for a smaller coin (e.g., SUI), add it to the watchlist, and see its gold ratio. |
| UC5 | Compare how BTC, ETH and SUI performed against gold over the same period on one chart. |
| UC6 | Export the ratio series to CSV or the chart to PNG for notes or a report. |

## 5. Scope

### 5.1 In scope (v1)
- Live crypto/gold ratio for any coin, in troy oz and grams.
- Historical ratio chart with range presets, crosshair tooltip, log/linear scale.
- Plain-language summary generated from the data (deterministic templates, no AI service).
- Watchlist (default: BTC, ETH, SUI) with search to add any coin.
- Compare mode: up to 4 coins on one indexed chart.
- KPI strip (current ratio, period change, period high/low).
- Underlying prices (coin in USD, gold per oz/gram in USD; TRY as optional display currency).
- CSV/PNG export, data-source attribution, stale-data indicators.
- Light/dark theme, responsive layout.

### 5.2 Out of scope (v1)
- Price alerts and push/email notifications.
- Portfolio tracking, wallet connections, exchange integrations, trading.
- User accounts, cloud sync, multi-user features.
- Native mobile or desktop apps.
- AI/LLM-generated commentary or forecasts; investment advice of any kind.
- Other metals (silver, platinum) — architecture should not block adding them later.

## 6. Functional Requirements

Priority: **Must** (MVP), **Should** (v1 complete), **Could** (if time allows).

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | **Live ratio.** For the selected coin, compute `ratio_oz = coin_usd / gold_usd_per_oz` and `ratio_g = ratio_oz × 31.1034768`. Refresh every 60 s while the tab is visible. Show an "as of" timestamp. | Must |
| FR-2 | **Unit toggle.** One global oz ↔ gram switch in the header. Changing it updates every number, axis, tooltip and summary instantly, with no network request. Choice persists across visits. | Must |
| FR-3 | **Historical ratio chart.** Line/area chart of the ratio. Range presets: 7D, 1M, 3M, 6M, 1Y, 5Y, Max. Ranges the data cannot support are disabled with a tooltip explaining why. | Must |
| FR-4 | **Chart interaction.** Crosshair tooltip (date, ratio in current unit, coin USD price, gold USD price); horizontal reference lines for period high, low and average; log/linear toggle; drag-to-pan and scroll/pinch zoom. | Must |
| FR-5 | **Plain-language summary.** 2–4 sentences describing current value, change over the selected range, position relative to the period high/low, and trend direction. Rules in §7.4. Updates with coin, range and unit. | Must |
| FR-6 | **KPI strip.** Cards for: current ratio; change over 24h / 7D / 30D / 1Y (%); period high and low with dates. Green/red is never the only signal (arrows + sign). | Must |
| FR-7 | **Coin search.** Search box with 300 ms debounce, keyboard navigation (↑ ↓ Enter Esc), showing icon, name, symbol and market-cap rank. Selecting a result shows that coin; a "+" adds it to the watchlist. | Must |
| FR-8 | **Watchlist.** Default BTC, ETH, SUI. Add, remove and drag-reorder; max 20 coins; persisted in the browser. Each row shows the current ratio, 7-day sparkline and 24h change. | Must |
| FR-9 | **Compare mode.** Overlay up to 4 coins, each indexed to 100 at the start of the selected range (raw ratios differ by orders of magnitude). Legend with distinct, colour-blind-safe colours. | Should |
| FR-10 | **Price context.** Show the coin price in USD and the gold price per oz and per gram in USD. Optional display currency TRY (gram gold in TRY is a familiar local reference). Ratios are unaffected by display currency. | Should |
| FR-11 | **Data provenance.** Footer and info popover listing sources, last update time per source, and the disclaimer "Indicative prices, not financial advice." | Must |
| FR-12 | **Stale and fallback indicators.** If a source is stale (> 15 min for live, > 2 days for daily) or a fallback source is in use, show a non-blocking badge explaining it. | Must |
| FR-13 | **Theme.** Light and dark themes; defaults to system preference; manual toggle persists. | Should |
| FR-14 | **Responsive layout.** Usable from 360 px wide (phone) to 2560 px (desktop). See §8. | Must |
| FR-15 | **Export.** Download the current ratio series as CSV (`date, coin_usd, gold_usd_oz, ratio_oz, ratio_g`) and the chart as PNG. | Could |
| FR-16 | **Shareable state.** Coin, range, unit and compare selection reflected in the URL query string so a view can be bookmarked or shared. | Could |

## 7. Data and Methodology

### 7.1 Data sources (verified 2026-10-11)

| Data | Primary source | Notes | Fallback |
|---|---|---|---|
| Gold spot (live) | **XAUS** `GET https://xaus.com/api/v1/spot?unit=oz\|gram&currency=USD` | Free, no key, CORS open, asks clients to cache ≥ 60 s. Returns `price_as_of` and `stale`. | PAXG price from CoinGecko (`pax-gold`), labelled "gold proxy" |
| Gold history | **XAUS** `GET /api/v1/chart?symbol=xau&range=…&interval=1d\|1h` (ranges `1mo…10y, max`) and `/api/v1/history` (≈5 y daily) | Sourced from Yahoo Finance; no weekend/holiday prints. | PAXG history from CoinGecko / Binance `PAXGUSDT` |
| Coin search & catalogue | **CoinGecko** Demo API `/search`, `/coins/list` | Free Demo key, sent as `x-cg-demo-api-key`. 100 calls/min. CoinGecko recommends proxying through a backend (CORS). | — |
| Coin price (live) | **CoinGecko** `/simple/price` | Batched for the whole watchlist in one call. | Binance `/api/v3/ticker/price` for USDT pairs |
| Coin history ≤ 365 days | **CoinGecko** `/coins/{id}/market_chart?vs_currency=usd&days=N` | Auto granularity: hourly for 2–90 days, daily (00:00 UTC) above 90 days. Demo plan is limited to the past 365 days. | Binance klines |
| Coin history > 365 days | **Binance** `GET /api/v3/klines?symbol=<SYM>USDT&interval=1d&limit=1000` | No key; weight 2 per call; paginate by `startTime`. USDT ≈ USD (difference shown in methodology note). | If the coin has no Binance USDT pair, cap history at 365 days and disable 5Y/Max with an explanation |

### 7.2 Ratio formula and units
- `ratio_oz(t) = coin_usd(t) / gold_usd_per_oz(t)`
- `ratio_g(t) = ratio_oz(t) × 31.1034768` (1 troy ounce = 31.1034768 g)
- Ratios are computed once in ounces; grams are derived on the client so the unit toggle is instant.
- Display precision: ≥ 1 → 2 decimals; 0.01–1 → 4 significant digits; < 0.01 → scientific-style compact notation with a "mg" hint for grams (e.g., "0.0021 g = 2.1 mg").

### 7.3 Time alignment
- Daily series are keyed by UTC date (`YYYY-MM-DD`). Crypto trades 24/7; gold does not trade on weekends and exchange holidays.
- Missing gold days are **forward-filled** from the last available close and flagged `goldFilled: true`; tooltips show "gold: last close Fri" for those points.
- Hourly series (7D, 1M) are keyed by UTC hour with the same forward-fill rule.
- A point is dropped only if no gold value exists at or before it (start-of-series edge).

### 7.4 Plain-language summary rules
Deterministic, template-based, unit-aware. Inputs: aligned series for the selected range, current unit, coin symbol. Output: 2–4 sentences, ≤ 60 words.

| Sentence | Template (example) | Rule |
|---|---|---|
| S1 Current | "1 BTC is worth **19.79 oz** of gold (615.6 g)." | Always. Secondary unit in parentheses. |
| S2 Change | "That's **up 8.4 %** over the last 30 days." | Sign words: "up", "down", or "roughly flat" when abs(change) < 1 %. |
| S3 Position | "It sits **12 % below** its 1-year high of 22.5 oz (3 Mar 2026)." | Use high if current is in the top half of the period range, low otherwise. "at a new period high/low" when within 0.5 %. |
| S4 Trend | "Over the past year, BTC has **outperformed gold**; the 30-day average is above the 90-day average." | Only when the range ≥ 3M. Outperformed if ratio change > +1 %, underperformed if < −1 %, otherwise "kept pace with gold". |

Edge cases with defined wording: fewer than 2 data points ("Not enough history yet for <COIN>."); range truncated by data availability ("Showing the 214 days available."); fallback gold source in use (appends "Gold priced via PAXG proxy.").

The coin name and numbers come only from data; there is no free text from external sources in the summary.

### 7.5 Caching and rate budget
| Data | Server cache TTL | Client refresh |
|---|---|---|
| Gold spot | 60 s | 60 s (visible tab only) |
| Coin spot (batched) | 60 s | 60 s |
| Hourly history | 15 min | on range/coin change |
| Daily history | 6 h | on range/coin change |
| Search results | 24 h per query | debounced |
| Coin catalogue | 24 h | — |

Budget: stay below 50 calls/min to CoinGecko (half the Demo limit) under normal single-user use; coalesce concurrent identical requests.

## 8. UX and UI Specification

### 8.1 Principles
One question per screen region. Big number first, chart second, words third. No more than three accent colours. Every number carries its unit. Nothing moves unless the user acted or data refreshed.

### 8.2 Layout (desktop ≥ 1024 px)
Wireframe figures other than the BTC snapshot are illustrative only.

```
┌───────────────────────────────────────────────────────────────────┐
│ AuRatio      [ Search any coin…        ]     oz ◉─○ g    ☀/☾  ⓘ  │  header
├──────────────┬────────────────────────────────────────────────────┤
│ WATCHLIST    │  1 BTC = 19.79 oz of gold        ▲ 2.1 % 24h       │  hero
│ ▸ BTC 19.79  │  615.6 g · as of 16:23 · BTC $83,039 · Au $4,196/oz│
│   ETH  0.52  ├────────────────────────────────────────────────────┤
│   SUI  0.0009│  [7D 1M 3M 6M 1Y 5Y Max]   [Compare +] [log] [⤓]   │
│   + Add coin │                                                    │
│              │            ratio chart (≈ 60 % of height)          │
│              │                                                    │
│              ├──────────────┬──────────────┬──────────────────────┤
│              │ 30D  +8.4 %  │ High 22.5 oz │ Low 15.1 oz          │  KPI strip
│              ├──────────────┴──────────────┴──────────────────────┤
│              │ Summary: 1 BTC is worth 19.79 oz of gold (615.6 g).│
│              │ That's up 8.4 % over the last 30 days. …           │
├──────────────┴────────────────────────────────────────────────────┤
│ Sources: XAUS (gold), CoinGecko, Binance · Indicative, not advice │  footer
└───────────────────────────────────────────────────────────────────┘
```

### 8.3 Layout (mobile < 768 px)
Stacked: header (search collapses to an icon) → hero → range chips (horizontally scrollable) → chart (fixed 280 px height) → KPI cards (2 × 2) → summary → watchlist (as a horizontal chip row above the hero, plus full list in a bottom sheet) → footer.

### 8.4 Visual design
- Neutral surface palette; one gold accent for the selected coin's series; compare colours from a colour-blind-safe categorical palette.
- Tabular numerals for all figures; hero number ≥ 40 px on desktop, ≥ 32 px on mobile.
- Loading: skeletons sized like the final content (no layout shift). Errors: inline, with a retry button.
- Accessibility: WCAG 2.2 AA contrast in both themes; full keyboard path through search, watchlist, range chips, unit toggle; the summary paragraph is the chart's text alternative (`aria-describedby`).

## 9. Technical Architecture

### 9.1 Stack (default choice — reasons in brackets)
- **Next.js (current stable, App Router) + TypeScript** [one project for UI and the server proxy that hides the CoinGecko key and handles CORS; free hosting on Vercel or `npm run dev` locally].
- **Tailwind CSS** for styling [fast, consistent design tokens].
- **TradingView Lightweight Charts (v5)** for the main chart [built for financial time series, fast with thousands of points, small bundle]; inline SVG for sparklines.
- **TanStack Query** for client data fetching, caching and 60 s polling.
- **Zod** for validating API inputs and upstream responses.
- **Vitest** (unit), **Playwright** (end-to-end), **axe-core** (accessibility).

### 9.2 Components

```
Browser (React)
  ├─ Header: SearchBox, UnitToggle, ThemeToggle, InfoPopover
  ├─ Watchlist (localStorage)  ─┐
  ├─ Hero / KPI strip           ├─ TanStack Query ──► /api/* (Next.js route handlers)
  ├─ RatioChart / CompareChart  │                         ├─ cache (in-memory TTL + request coalescing)
  └─ SummaryCard (lib/summary)  ┘                         ├─ providers/xaus.ts       (gold)
                                                          ├─ providers/coingecko.ts  (search, spot, ≤365 d)
lib/ratio.ts  (pure: align, forward-fill, ratio, stats)   ├─ providers/binance.ts    (> 365 d)
lib/summary.ts (pure: templates)                          └─ providers/paxg.ts       (gold fallback)
```

### 9.3 Internal API

| Route | Query | Response (JSON) |
|---|---|---|
| `GET /api/search` | `q` (2–50 chars) | `{ results: [{ id, symbol, name, thumb, rank }] }` |
| `GET /api/spot` | `ids` (comma list, ≤ 20 CoinGecko ids) | `{ gold: { usdPerOz, asOf, source, stale }, coins: [{ id, usd, change24h, ratioOz, asOf }] }` |
| `GET /api/history` | `id`, `range` ∈ `7d,1m,3m,6m,1y,5y,max` | `{ id, range, granularity: "hour"\|"day", points: [{ t, coinUsd, goldUsdOz, ratioOz, goldFilled }], meta: { coinSource, goldSource, availableFrom, truncated } }` |

All routes: Zod-validated input, `400` on bad input, `502` with `{ error, source }` when every upstream fails, `Cache-Control` headers matching §7.5. The server never returns the API key or raw upstream error bodies.

### 9.4 Data model (client)
- `Settings { unit: "oz"|"g", theme: "system"|"light"|"dark", displayCurrency: "USD"|"TRY" }`
- `Watchlist { ids: string[] }` (CoinGecko ids, ordered)
- `RatioPoint { t: number, coinUsd: number, goldUsdOz: number, ratioOz: number, goldFilled: boolean }`
- `RatioStats { current, changePct, high: {value,t}, low: {value,t}, avg, ma30, ma90, percentile }`

### 9.5 Configuration
- `.env.local`: `COINGECKO_DEMO_API_KEY` (required; free key from CoinGecko developer dashboard).
- Optional: `BINANCE_BASE_URL` (default `https://api.binance.com`; alternative `https://data-api.binance.vision` if the main host is unreachable).

## 10. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 Performance | Initial JS ≤ 250 KB gzipped; chart renders 2,000 points in < 200 ms on a mid-range laptop; unit toggle re-render < 50 ms. |
| NFR-2 Reliability | Any single upstream failure degrades gracefully (fallback or cached data + badge); the page never shows a blank screen. |
| NFR-3 Security | API keys only on the server; input validated; no user data leaves the browser except coin ids and search terms. |
| NFR-4 Privacy | No accounts, no analytics, no cookies beyond functional local storage. |
| NFR-5 Accessibility | WCAG 2.2 AA; Lighthouse Accessibility ≥ 90; keyboard-only operation of every control. |
| NFR-6 Maintainability | Providers behind one interface so a source can be swapped without touching UI; pure functions for all math; ≥ 90 % line coverage on `lib/ratio.ts` and `lib/summary.ts`. |
| NFR-7 Correctness | Live BTC/gold ratio within ±0.5 % of XAUS `btc_gold_oz`; gram conversion exact to 1e-9 relative error. |

## 11. Error Handling and Edge Cases

| Case | Behaviour |
|---|---|
| Gold API down | Use PAXG proxy; badge "Gold priced via PAXG (tracks 1 oz LBMA gold)". |
| CoinGecko rate-limited (429) | Serve cached data; back off exponentially (1 s, 2 s, 4 s, max 30 s); badge "Live updates paused". |
| Coin has < 365 days of history | Disable unavailable ranges; summary states actual span. |
| Coin not on Binance | 5Y/Max disabled with tooltip "Longer history not available for this coin". |
| Very small ratios (micro-caps) | Compact notation; grams shown as mg when < 0.01 g. |
| Delisted/unknown coin id in watchlist | Row shows "Unavailable" with a remove button; never crashes the list. |
| Weekend/holiday | Gold forward-filled; tooltip notes last close. |
| Offline | Show last successful data from the query cache with "Offline — showing data from HH:MM". |

## 12. Testing Strategy
- **Unit (Vitest):** ratio alignment and forward-fill; gram conversion; stats (high/low/avg/MA/percentile); every summary template and edge case in §7.4; number formatting; provider response parsers against recorded fixtures.
- **Integration:** route handlers with mocked upstreams (success, 429, 5xx, malformed JSON, timeout) asserting fallback and error envelopes.
- **End-to-end (Playwright):** load → default BTC ratio visible; unit toggle changes hero and axis without network calls; search "sui" → add to watchlist → persists after reload; range change updates chart and summary; compare 3 coins; CSV export file has expected header.
- **Accessibility:** axe-core on main views in both themes; keyboard-only walkthrough.
- **Correctness check:** scripted comparison of `/api/spot` BTC ratio against XAUS `btc_gold_oz` (±0.5 %).

## 13. Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| M1 Data layer | Scaffold, cache, providers, ratio engine, API routes | `/api/spot` and `/api/history` return correct BTC data for all ranges; unit tests green |
| M2 MVP dashboard | Layout, hero, KPI strip, ratio chart, summary, unit toggle | UC1–UC3 work end-to-end |
| M3 Any coin | Search, watchlist, compare mode, price context | UC4–UC5 work end-to-end |
| M4 Polish & ship | Error states, export, theme, a11y/perf pass, README, deploy | All Must + Should requirements pass; G1–G6 met |

## 14. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| XAUS is a small free service and may change or go offline | Medium | High | Provider interface + PAXG fallback; cached last-known data; version-pinned `/v1` path |
| CoinGecko Demo history capped at 365 days | Certain | Medium | Binance klines for longer ranges; clear UI messaging when unavailable |
| Binance API unreachable from some networks | Low–Medium | Medium | Configurable base URL (`data-api.binance.vision`); degrade to 365-day cap |
| USDT vs USD pricing difference on Binance history | Low | Low | Documented in methodology popover; typically < 0.5 % |
| Gold weekend gaps distort short-range charts | Certain | Low | Forward-fill with flagged points; tooltip notes last close |
| Free-tier rate limits during development (hot reload) | Medium | Low | Server cache + request coalescing; recorded fixtures for tests |

## 15. Decisions Made by Default (easy to change)
1. Stack: Next.js + TypeScript (alternative: Python FastAPI + a JS frontend, or Streamlit for a quicker but less customisable UI).
2. Base currency USD; TRY offered as an optional display currency only.
3. Runs locally first; Vercel deployment is the final optional step.
4. No alerts in v1 (not selected during discovery); the stats engine is designed so alerts can be added later without refactoring.

## 16. Glossary
- **Troy ounce (oz t):** 31.1034768 g, the standard unit for precious metals.
- **PAXG / XAUT:** tokens each backed by one troy ounce of physical gold; used here only as a fallback price proxy.
- **Indexed series:** a series rescaled so its first value is 100, used to compare coins whose raw ratios differ in magnitude.
