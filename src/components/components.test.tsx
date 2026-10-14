import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rangeAvailability } from "@/lib/availability";
import type { CoinSpotDto, GoldSpotDto, HistoryMeta } from "@/lib/types";
import { Hero, type HeroProps } from "./Hero";
import { KpiStrip } from "./KpiStrip";
import { RangeSelector } from "./RangeSelector";
import { SearchBox } from "./SearchBox";
import { SummaryCard } from "./SummaryCard";

const NOW = Date.UTC(2026, 9, 11, 13, 23);
const coin: CoinSpotDto = {
  id: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  image: null,
  rank: 1,
  usd: 83_039,
  change24h: 2.1,
  ratioOz: 83_039 / 4195.6,
  ratioChange24h: 2.1,
  asOf: new Date(NOW).toISOString(),
  priceSource: "freecryptoapi",
};
const gold: GoldSpotDto = {
  usdPerOz: 4195.6,
  asOf: new Date(NOW).toISOString(),
  source: "xaus",
  stale: false,
  change24h: 0,
};

function hero(overrides: Partial<HeroProps> = {}) {
  const props: HeroProps = {
    symbol: "BTC",
    name: "Bitcoin",
    image: null,
    coin,
    gold,
    unit: "oz",
    price: { currency: "USD", rate: 1 },
    currencySetting: "USD",
    onCurrencyChange: vi.fn(),
    badges: [],
    loading: false,
    error: false,
    onRetry: vi.fn(),
    unavailable: false,
    inWatchlist: true,
    watchlistFull: false,
    onAdd: vi.fn(),
    ...overrides,
  };
  return render(<Hero {...props} />);
}

describe("Hero", () => {
  it("shows the BTC example in ounces with grams as the secondary unit", () => {
    hero();
    expect(screen.getByTestId("hero-ratio")).toHaveTextContent("1 BTC = 19.79 oz of gold");
    const details = screen.getByTestId("hero-details");
    expect(details).toHaveTextContent("615.6 g");
    expect(details).toHaveTextContent("BTC $83,039");
    expect(details).toHaveTextContent("Gold $4,195.60/oz");
    expect(details).toHaveTextContent("$134.89/g");
  });

  it("switches every figure to grams", () => {
    hero({ unit: "g" });
    expect(screen.getByTestId("hero-ratio")).toHaveTextContent("1 BTC = 615.6 g of gold");
    expect(screen.getByTestId("hero-details")).toHaveTextContent("19.79 oz");
  });

  it("marks the 24h change with an arrow and a sign, not colour alone", () => {
    hero({ coin: { ...coin, ratioChange24h: -1.26 } });
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getByText("−1.3 %")).toBeInTheDocument(); // the matcher normalises the NBSP
    expect(screen.getByText("down 1.3 percent over 24h")).toBeInTheDocument();
  });

  it("converts prices (not the ratio) to TRY", () => {
    hero({ price: { currency: "TRY", rate: 49.333088 }, currencySetting: "TRY" });
    expect(screen.getByTestId("hero-ratio")).toHaveTextContent("19.79 oz");
    expect(screen.getByTestId("price-gold-oz")).toHaveTextContent("Gold ₺206,982/oz");
    expect(screen.getByTestId("price-gold-g")).toHaveTextContent("₺6,654.62/g");
  });

  it("shows status badges", () => {
    hero({
      badges: [{ id: "gold-stale", text: "Gold price delayed", title: "Last update 13:00" }],
    });
    expect(screen.getByRole("status")).toHaveTextContent("Gold price delayed");
  });

  it("handles loading, errors and unavailable coins", async () => {
    const onRetry = vi.fn();
    const { rerender } = hero({ coin: undefined, loading: true });
    expect(screen.getByLabelText("Loading live ratio")).toBeInTheDocument();
    rerender(
      <Hero {...({} as HeroProps)} {...defaultsFor({ coin: undefined, error: true, onRetry })} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<Hero {...defaultsFor({ coin: undefined, unavailable: true, symbol: "OLD" })} />);
    expect(screen.getByRole("heading", { name: "OLD is unavailable" })).toBeInTheDocument();
  });

  it("offers to add a coin that is not in the watchlist", async () => {
    const onAdd = vi.fn();
    hero({ inWatchlist: false, onAdd });
    await userEvent.click(screen.getByRole("button", { name: /add to watchlist/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});

function defaultsFor(overrides: Partial<HeroProps>): HeroProps {
  return {
    symbol: "BTC",
    name: "Bitcoin",
    image: null,
    coin,
    gold,
    unit: "oz",
    price: { currency: "USD", rate: 1 },
    currencySetting: "USD",
    onCurrencyChange: vi.fn(),
    badges: [],
    loading: false,
    error: false,
    onRetry: vi.fn(),
    unavailable: false,
    inWatchlist: true,
    watchlistFull: false,
    onAdd: vi.fn(),
    ...overrides,
  };
}

describe("KpiStrip", () => {
  it("renders current value, changes with arrows and period extremes", () => {
    render(
      <KpiStrip
        unit="oz"
        currentOz={19.79}
        changes={{ "24h": 2.1, "7D": -5.3, "30D": 12.44, "1Y": null }}
        stats={{
          first: 18,
          current: 19.79,
          changePct: 9.9,
          high: { value: 22.5, t: Date.UTC(2026, 2, 3) },
          low: { value: 15.1, t: Date.UTC(2026, 0, 12) },
          avg: 18.5,
          ma30: null,
          ma90: null,
          percentile: 70,
          startT: 0,
          endT: 1,
          count: 10,
        }}
        rangeLabel="1Y"
        granularity="day"
        loading={false}
      />,
    );
    const strip = screen.getByTestId("kpi-strip");
    expect(strip).toHaveTextContent("19.79 oz");
    expect(strip).toHaveTextContent("615.5 g");
    expect(within(strip).getByText("1Y high").parentElement).toHaveTextContent(
      "22.50 oz3 Mar 2026",
    );
    expect(within(strip).getByText("1Y low").parentElement).toHaveTextContent(
      "15.10 oz12 Jan 2026",
    );
    expect(strip).toHaveTextContent("up 12.4 percent");
    expect(strip).toHaveTextContent("down 5.3 percent");
    expect(strip).toHaveTextContent("not available");
  });
});

describe("RangeSelector", () => {
  const meta: HistoryMeta = {
    coinSource: "freecryptoapi",
    goldSource: "xaus",
    availableFrom: NOW - 214 * 86_400_000,
    truncated: true,
    recordedFrom: NOW - 214 * 86_400_000,
    lastRecordedAt: NOW,
    recordingStale: false,
    goldStale: false,
    goldLastT: NOW,
  };

  it("disables ranges the data cannot support and explains why", async () => {
    const onChange = vi.fn();
    const onHint = vi.fn();
    render(
      <RangeSelector
        value="1y"
        availability={rangeAvailability(meta, NOW)}
        onChange={onChange}
        onHint={onHint}
      />,
    );
    const fiveYears = screen.getByRole("button", { name: /5Y/ });
    expect(fiveYears).toHaveAttribute("aria-disabled", "true");
    expect(fiveYears).toHaveAccessibleDescription(
      "Unavailable: Only 214 days of history recorded so far",
    );
    await userEvent.click(fiveYears);
    expect(onChange).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenCalledWith("Only 214 days of history recorded so far");
    await userEvent.click(screen.getByRole("button", { name: "3M" }));
    expect(onChange).toHaveBeenCalledWith("3m");
    expect(screen.getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SummaryCard", () => {
  it("renders the summary text as the chart description target", () => {
    render(<SummaryCard text="1 BTC is worth 19.79 oz of gold (615.6 g)." loading={false} />);
    expect(document.getElementById("chart-summary")).toHaveTextContent("1 BTC is worth 19.79 oz");
  });
});

describe("SearchBox", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderSearch() {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/search?q=sui");
      return new Response(
        JSON.stringify({
          results: [
            { id: "sui", symbol: "SUI", name: "Sui", thumb: null, rank: 29 },
            { id: "usdsui", symbol: "USDSUI", name: "USDsui", thumb: null, rank: 340 },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <SearchBox watchlist={["bitcoin"]} watchlistFull={false} onSelect={onSelect} onAdd={onAdd} />,
      { wrapper },
    );
    return { fetchMock, onSelect, onAdd };
  }

  it("debounces, then supports ↓ / Enter to select", async () => {
    const { fetchMock, onSelect } = renderSearch();
    const input = screen.getByRole("combobox", { name: "Search any coin" });
    await userEvent.type(input, "sui");
    expect(fetchMock).not.toHaveBeenCalled(); // still inside the 300 ms debounce
    const options = await screen.findAllByRole("option");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(options[0]).toHaveTextContent("Sui");
    expect(options[0]).toHaveTextContent("#29");
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "sui" }));
    expect(input).toHaveValue("");
  });

  it("adds with Shift+Enter and closes with Esc", async () => {
    const { onAdd } = renderSearch();
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "sui");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Shift>}{Enter}{/Shift}");
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "sui" }));

    await userEvent.type(input, "sui");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(input).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      await userEvent.keyboard("{Escape}");
    });
    expect(input).toHaveValue("");
  });
});
