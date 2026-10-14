import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { apiCalls, mockApi } from "./mock-api";

const hero = (page: Page) => page.getByTestId("hero-ratio");
const summary = (page: Page) => page.locator("#chart-summary");
const unitButton = (page: Page, unit: "oz" | "g") =>
  page
    .getByRole("group", { name: "Gold unit" })
    .getByRole("button", { name: new RegExp(`^${unit} `) });
const rangeButton = (page: Page, label: string) =>
  page
    .getByRole("group", { name: "Time range" })
    .getByRole("button", { name: new RegExp(`^${label}`) });

async function ready(page: Page) {
  await expect(hero(page)).toBeVisible();
  await expect(summary(page)).toContainText("is worth");
}

test.describe("core flows", () => {
  test("UC1: shows the live BTC ratio on load with one batched spot request", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/AuRatio/);
    await ready(page);
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
    await expect(page.getByTestId("hero-details")).toContainText("615.6 g");
    await expect(page.getByTestId("hero")).toContainText("+2.1");
    expect(apiCalls(api, "/api/spot")).toHaveLength(1);
    expect(apiCalls(api, "/api/spot")[0]).toContain("bitcoin,ethereum,sui");
  });

  test("UC2: the unit toggle updates every figure without a network request and persists", async ({
    page,
  }) => {
    const api = await mockApi(page);
    await page.goto("/");
    await ready(page);
    const before = api.requests.length;
    await unitButton(page, "g").click();
    await expect(hero(page)).toHaveText("1 BTC = 615.6 g of gold");
    await expect(summary(page)).toContainText("1 BTC is worth 615.6 g of gold (19.79 oz).");
    await expect(page.getByTestId("kpi-strip")).toContainText("615.6 g");
    await page.waitForTimeout(500);
    expect(api.requests.length).toBe(before);
    await expect(page).toHaveURL(/unit=g/);
    await page.goto("/");
    await expect(hero(page)).toHaveText("1 BTC = 615.6 g of gold");
  });

  test("UC3: 1-year ETH chart with a trend summary", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page
      .locator("aside")
      .getByTestId("watch-row-ethereum")
      .getByRole("button", { name: /ETH/ })
      .first()
      .click();
    await rangeButton(page, "1Y").click();
    await expect(hero(page)).toHaveText("1 ETH = 0.5966 oz of gold");
    await expect(summary(page)).toContainText("1 ETH is worth 0.5966 oz of gold");
    await expect(summary(page)).toContainText(
      /Over the past year, ETH has (outperformed|underperformed|kept pace with) gold/,
    );
  });

  test("range change refetches history and rewrites the summary", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/");
    await ready(page);
    await rangeButton(page, "3M").click();
    await expect(summary(page)).toContainText("over the last 3 months");
    expect(apiCalls(api, "/api/history?id=bitcoin&range=3m")).toHaveLength(1);
    await expect(rangeButton(page, "3M")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/range=3m/);
  });

  test("UC4: search, add to watchlist, and it survives a reload", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    const search = page.getByRole("combobox", { name: "Search any coin" });
    await search.fill("sol");
    await expect(page.getByRole("option", { name: /Solana/ })).toBeVisible();
    await page.getByTestId("add-solana").click();
    await expect(hero(page)).toContainText("1 SOL =");
    await expect(page.locator("aside").getByTestId("watch-row-solana")).toBeVisible();
    await page.reload();
    await expect(page.locator("aside").getByTestId("watch-row-solana")).toBeVisible();
  });

  test("keyboard-only search and selection", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page.getByRole("combobox", { name: "Search any coin" }).focus();
    await page.keyboard.type("eth");
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(hero(page)).toContainText("1 ETH =");
  });

  test("an unknown coin id in the watchlist shows Unavailable with a remove button", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "auratio:watchlist",
        JSON.stringify({ ids: ["bitcoin", "delisted-coin"] }),
      ),
    );
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    const row = page.locator("aside").getByTestId("watch-row-delisted-coin");
    await expect(row).toContainText("Unavailable");
    await row.getByRole("button", { name: /Remove .* from watchlist/ }).click();
    await expect(page.locator("aside").getByTestId("watch-row-delisted-coin")).toHaveCount(0);
  });

  test("watchlist reorder persists; corrupt storage falls back to defaults", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Move ETH up" }).first().click();
    const order = () =>
      page
        .locator("aside [data-testid^=watch-row-]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    await expect.poll(order).toEqual(["watch-row-ethereum", "watch-row-bitcoin", "watch-row-sui"]);
    await page.reload();
    await expect.poll(order).toEqual(["watch-row-ethereum", "watch-row-bitcoin", "watch-row-sui"]);

    await page.evaluate(() => localStorage.setItem("auratio:watchlist", "{not json"));
    await page.reload();
    await expect.poll(order).toEqual(["watch-row-bitcoin", "watch-row-ethereum", "watch-row-sui"]);
  });

  test("UC5: compare BTC, ETH and SUI on one indexed chart", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Compare" }).click();
    const legend = page.getByTestId("compare-legend");
    await expect(legend.getByRole("listitem")).toHaveCount(3);
    await expect(legend).toContainText("BTC");
    await expect(legend).toContainText("ETH");
    await expect(legend).toContainText("SUI");
    await expect(summary(page)).toContainText("did best against gold");
    await expect(page).toHaveURL(/compare=bitcoin,ethereum,sui/);
    const box = (await page.getByTestId("chart-area").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const tooltip = page.getByTestId("chart-tooltip");
    await expect(tooltip).toBeVisible();
    for (const s of ["BTC", "ETH", "SUI"]) await expect(tooltip).toContainText(s);
    // Leaving compare returns to the single-coin view.
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(legend).toHaveCount(0);
    await expect(summary(page)).toContainText("1 BTC is worth");
  });

  test("UC6: CSV and PNG export", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    const [csv] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "CSV" }).click(),
    ]);
    expect(csv.suggestedFilename()).toMatch(/^auratio-btc-1y-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await readFile((await csv.path())!, "utf8")).trim().split("\n");
    expect(lines[0]).toBe("date,coin_usd,gold_usd_oz,ratio_oz,ratio_g");
    expect(lines.length).toBe(366);
    const [png] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG" }).click(),
    ]);
    expect(png.suggestedFilename()).toMatch(/\.png$/);
  });
});

test.describe("state, URL and settings", () => {
  test("a shared URL restores the view; invalid values fall back to defaults", async ({ page }) => {
    await mockApi(page);
    await page.goto("/?coin=ethereum&range=1y&unit=g");
    await expect(hero(page)).toHaveText("1 ETH = 18.56 g of gold");
    await expect(rangeButton(page, "1Y")).toHaveAttribute("aria-pressed", "true");
    // Invalid values fall back to the defaults (saved settings are cleared first: the shared URL above
    // legitimately changed the saved unit).
    await page.evaluate(() => localStorage.clear());
    await page.goto("/?coin=NOT%20A%20COIN&range=9y&unit=kg");
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
    await expect(rangeButton(page, "1Y")).toHaveAttribute("aria-pressed", "true");
  });

  test("ranges longer than the recorded history are disabled with a reason", async ({ page }) => {
    await mockApi(page);
    await page.goto("/?coin=solana");
    await ready(page);
    // Solana has 20 days recorded: the default 1Y falls back to 1M.
    await expect(rangeButton(page, "1M")).toHaveAttribute("aria-pressed", "true");
    const threeMonths = rangeButton(page, "3M");
    await expect(threeMonths).toHaveAttribute("aria-disabled", "true");
    await threeMonths.hover();
    await expect(
      page.getByText("Only 20 days of history recorded so far", { exact: true }).first(),
    ).toBeVisible();
    await threeMonths.click({ force: true });
    await expect(rangeButton(page, "1M")).toHaveAttribute("aria-pressed", "true");
  });

  test("a coin with nothing recorded yet explains that recording has started", async ({ page }) => {
    await mockApi(page);
    await page.goto("/?coin=new-coin");
    await expect(hero(page)).toHaveText("1 NEW = 0.000477 oz of gold");
    await expect(page.getByTestId("chart-area")).toContainText(
      "AuRatio starts recording NEW within a minute",
    );
    await expect(summary(page)).toContainText("Not enough history yet for NEW.");
    await expect(rangeButton(page, "7D")).toHaveAttribute("aria-pressed", "true");
    await expect(rangeButton(page, "1M")).toHaveAttribute("aria-disabled", "true");
  });

  test("TRY changes price labels but never the ratio", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("group", { name: "Price currency" })
      .getByRole("button", { name: "TRY" })
      .click();
    await expect(page.getByTestId("price-gold-oz")).toHaveText("Gold ₺206,982/oz");
    await expect(page.getByTestId("price-coin")).toContainText("₺");
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
  });

  test("theme toggle persists across reloads", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  });

  test("footer lists sources, update times and the disclaimer", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    const footer = page.getByTestId("footer");
    await expect(footer).toContainText("XAUS");
    await expect(footer).toContainText("CoinGecko");
    await expect(footer).toContainText("Indicative prices, not financial advice.");
    await expect(page.getByTestId("footer-updated")).toContainText("Gold (XAUS) updated");
    await page.getByRole("button", { name: "About the data and methodology" }).click();
    await expect(page.getByRole("dialog", { name: "About AuRatio" })).toContainText("31.1034768");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("resilience", () => {
  test("PAXG fallback shows a badge, a summary note and the footer source", async ({ page }) => {
    await mockApi(page, { goldSource: "paxg" });
    await page.goto("/");
    await ready(page);
    await expect(page.getByText("Gold priced via PAXG (tracks 1 oz LBMA gold)")).toBeVisible();
    await expect(summary(page)).toContainText("Gold priced via PAXG proxy.");
    await expect(page.getByTestId("footer")).toContainText("PAXG fallback in use");
  });

  test("rate limiting keeps data visible with a paused badge", async ({ page }) => {
    await mockApi(page, { rateLimited: true });
    await page.goto("/");
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
    await expect(page.getByText("Live updates paused")).toBeVisible();
  });

  test("an outage shows an inline error, and retry recovers", async ({ page }) => {
    test.setTimeout(45_000);
    const api = await mockApi(page, { spotStatus: 502 });
    await page.goto("/");
    await expect(page.getByText("Live prices could not be loaded.")).toBeVisible({
      timeout: 20_000,
    });
    // The rest of the page still renders.
    await expect(page.getByTestId("footer")).toBeVisible();
    api.set({ spotStatus: undefined });
    await page.getByTestId("hero").getByRole("button", { name: "Retry" }).click();
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
  });

  test("offline mode keeps the last data with a timestamped banner", async ({ page, context }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toContainText(
      /Offline — showing data from \d{2}:\d{2}/,
    );
    await expect(hero(page)).toHaveText("1 BTC = 19.79 oz of gold");
    await context.setOffline(false);
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });
});

test.describe("layout, accessibility and performance", () => {
  for (const width of [360, 768, 1440]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await page.goto("/");
      await ready(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`axe: no serious violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page);
      await page.goto("/");
      await ready(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    });
  }

  test("axe: compare mode and the methodology dialog", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByTestId("compare-legend")).toBeVisible();
    await page.getByRole("button", { name: "About the data and methodology" }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test("the unit toggle re-renders in under 50 ms", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await ready(page);
    const ms = await page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>(
        '[aria-label="Gold unit"] button:last-child',
      )!;
      const heading = document.querySelector("[data-testid=hero-ratio]")!;
      const start = performance.now();
      const done = new Promise<void>((resolve) => {
        const mo = new MutationObserver(() => {
          if (heading.textContent?.includes(" g ")) {
            mo.disconnect();
            resolve();
          }
        });
        mo.observe(heading, { subtree: true, childList: true, characterData: true });
      });
      button.click();
      await done;
      return performance.now() - start;
    });
    expect(ms).toBeLessThan(50);
  });

  test("the chart draws 2,000 points in under 200 ms", async ({ page }) => {
    await mockApi(page);
    await page.goto("/?range=5y");
    await ready(page);
    const canvas = page.getByTestId("chart-canvas");
    await expect(canvas).toHaveAttribute("data-points", "2000");
    const ms = Number(await canvas.getAttribute("data-render-ms"));
    expect(ms).toBeLessThan(200);
  });
});
