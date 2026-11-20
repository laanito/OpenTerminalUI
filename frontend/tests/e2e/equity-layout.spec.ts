import { expect, test } from "@playwright/test";
for (const width of [1440, 1024, 390]) {
  test(`@smoke Equity chart-first layout and readable indicator drawer at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "BTC-USD", interval: "1d", range: "1y" }, version: 0 })));
    await page.routeWebSocket("**/*", socket => socket.close());
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/crypto/candles")) return route.fulfill({ json: { ticker: "BTC-USD", currency: "USD", interval: "1d", data: Array.from({ length: 90 }, (_, index) => ({ t: 1780000000 + index * 86400, o: 65000 + index * 10, h: 66000 + index * 10, l: 64000 + index * 10, c: 65500 + index * 10, v: 100 })) } });
      if (url.pathname.endsWith("/quotes")) return route.fulfill({ json: { market: "CRYPTO", quotes: [{ symbol: "BTC-USD", last: 66390, change: 10, changePct: .02 }] } });
      return route.fulfill({ json: { items: [], quotes: [], results: [] } });
    });
    await page.goto("/equity/stocks");
    const plot = page.getByRole("region", { name: "BTC-USD price chart", exact: true });
    await expect(plot.locator("canvas").first()).toBeVisible();
    expect((await plot.boundingBox())!.y).toBeLessThan(650);
    const context = page.getByRole("complementary", { name: "Instrument context" });
    await expect(context.getByRole("link", { name: "Cross-market context" })).toHaveAttribute("href", /symbol=BTC-USD/);
    if (width >= 1024) {
      expect((await context.boundingBox())!.x).toBeGreaterThan((await plot.boundingBox())!.x);
      expect((await context.boundingBox())!.y).toBeLessThan((await plot.boundingBox())!.y + 20);
    }
    await expect(context.getByRole("heading", { name: "Futures Chain", exact: true })).toHaveCount(0);
    const chartControls = page.getByLabel("Chart controls", { exact: true });
    expect(await chartControls.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await context.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator("header .ot-type-panel-title").evaluateAll(elements => elements.filter(element => element.getClientRects().length).every(element => parseFloat(getComputedStyle(element).fontSize) >= 14 && element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("equity-chart-first.png"), fullPage: true });
    const indicators = chartControls.getByRole("button", { name: "Indicators", exact: true });
    await expect(page.getByRole("dialog", { name: "Manage indicators", exact: true })).toHaveCount(0);
    await indicators.click();
    const drawer = page.getByRole("dialog", { name: "Manage indicators", exact: true });
    await expect(drawer).toBeVisible();
    const bounds = (await drawer.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width === 1440) expect(bounds.width).toBeGreaterThan(700);
    await page.screenshot({ path: testInfo.outputPath("indicator-library.png"), fullPage: true });
    await drawer.getByRole("textbox", { name: "Search indicators", exact: true }).fill("sma");
    await drawer.getByTitle("sma", { exact: true }).click();
    await expect(drawer.getByRole("button", { name: "Configure", exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Configure", exact: true }).click();
    const editor = page.getByRole("dialog", { name: /^Configure / });
    await expect(editor).toBeVisible();
    const input = editor.getByRole("spinbutton").first();
    await input.fill("30"); await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0); await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Configure", exact: true }).click();
    await editor.getByRole("spinbutton").first().fill("30"); await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await drawer.getByText("Templates and custom indicators", { exact: true }).click();
    await drawer.getByRole("textbox", { name: "Template name", exact: true }).fill("Long-term multi-market trend overlay");
    await drawer.getByRole("button", { name: "Save", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("indicator-manager.png"), fullPage: true });
    await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0); await expect(indicators).toBeFocused();
    const active = context.getByRole("heading", { name: "Active indicators", exact: true }).locator("xpath=ancestor::section[1]");
    await expect(active).toContainText("30");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("chart:indicators:BTC-USD") || "[]").length)).toBe(1);
    await active.getByRole("button", { name: /^Hide .*instance 1$/ }).click();
    await expect(active.getByRole("button", { name: /^Show .*instance 1$/ })).toBeVisible();
    await page.reload();
    await expect(active.getByRole("button", { name: /^Show .*instance 1$/ })).toBeVisible();
    await active.getByRole("button", { name: /^Remove .*instance 1$/ }).click();
    await expect(active).toContainText("No studies selected");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("@smoke AAPL keeps equity market and performance context beside/below the primary chart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "AAPL", interval: "1d", range: "1y" }, version: 0 })));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/chart/AAPL")) return route.fulfill({ json: { symbol: "AAPL", ticker: "AAPL", currency: "USD", interval: "1d", data: Array.from({ length: 90 }, (_, index) => ({ t: (1780000000 + index * 86400) * (url.searchParams.has("normalized") ? 1000 : 1), o: 200 + index / 10, h: 205 + index / 10, l: 195 + index / 10, c: 202 + index / 10, v: 10000 })) } });
    if (url.pathname.endsWith("/stocks/AAPL/scores")) return route.fulfill({ json: { piotroski_f_score: 7, altman_z_score: 4, graham_number: 100, peg_ratio: 2, magic_formula_rank: 10, fcf_yield_pct: 5, cash_conversion_cycle: 30, dupont_analysis: { profit_margin: .2, asset_turnover: 1, equity_multiplier: 2, roe: .4 }, cagr: { revenue_3y_pct: 5, profit_3y_pct: 6 }, dvm_score: { durability: 7, valuation: 6, momentum: 5, overall: 6, band: "Neutral" } } });
    if (url.pathname.endsWith("/performance")) return route.fulfill({ json: { period_changes_pct: { "1D": .5, "1W": 1, "1M": 2, "3M": 3, "6M": 4, "1Y": 5 }, day_range: { low: 208, high: 212 }, range_52w: { low: 170, high: 240 } } });
    if (url.pathname.endsWith("/stocks/AAPL")) return route.fulfill({ json: { symbol: "AAPL", ticker: "AAPL", company_name: "Apple", current_price: 211, change_pct: .5, exchange: "NASDAQ", currency: "USD", country_code: "US" } });
    if (url.pathname.endsWith("/quotes")) return route.fulfill({ json: { quotes: [{ symbol: "AAPL", last: 211, change: 1, changePct: .5 }] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  await page.goto("/equity/stocks");
  const chart = page.getByRole("region", { name: "AAPL price chart", exact: true });
  await expect(chart.locator("canvas").first()).toBeVisible();
  const context = page.getByRole("complementary", { name: "Instrument context" });
  await expect(context.getByRole("link", { name: "Cross-market context" })).toHaveAttribute("href", /symbol=AAPL/);
  await expect(context).toContainText("NASDAQ");
  const performance = page.getByRole("heading", { name: "Performance Strip", exact: true });
  expect((await performance.boundingBox())!.y).toBeGreaterThan((await chart.boundingBox())!.y);
  expect((await chart.boundingBox())!.y).toBeLessThan(650);
  expect(errors).toEqual([]);
});
