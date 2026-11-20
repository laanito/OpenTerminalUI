import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function populatedHome(page: Page, preset = "trader") {
  await page.clock.setFixedTime(new Date("2026-11-20T12:00:00Z"));
  await page.addInitScript(value => localStorage.setItem("ot:workspace:preset:v1", value), preset);
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/portfolios/primary")) return route.fulfill({ json: {
      portfolio_id: "home-layout", portfolio_name: "Long-term multi-market allocation", portfolio_currency: "USD",
      items: [{ ticker: "AAPL", symbol: "AAPL", quantity: 10, current_value: 2500, native_currency: "USD", sector: "Information technology and communications infrastructure" }],
      summary: { net_liquidation_value: 1234567.89, total_cost: 1100000, overall_pnl: 134567.89 },
      accounting: { base_currency: "USD", status: "complete", issues: [], degraded_reasons: [], fx_rates: [] },
    } });
    if (path.includes("/analytics/history")) return route.fulfill({ json: {
      base_currency: "USD", benchmark: "SPY", status: "complete", methodology: "daily_ledger_reconstruction", issues: [], degraded_reasons: [],
      equity_curve: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 22 + i)).toISOString().slice(0, 10), portfolio: 100 + i, benchmark: 100 + i / 2, net_liquidation_value: 1200000 + i * 1000 })),
    } });
    if (path.endsWith("/watchlists")) return route.fulfill({ json: [{ id: "wl", name: "Research", symbols: ["AAPL", "BTC-USD"] }] });
    if (path.includes("/backtest/v1/presets")) return route.fulfill({ json: [] });
    if (path.endsWith("/quotes")) return route.fulfill({ json: { market: "US", quotes: ["^GSPC", "^IXIC", "^DJI", "GC=F", "SI=F", "CL=F"].map((symbol, i) => ({ symbol, last: 6000 + i, change: 10, changePct: .5 })) } });
    if (path.includes("/news/")) return route.fulfill({ json: { items: Array.from({ length: 5 }, (_, i) => ({ id: `news-${i}`, title: `Global markets research ${i + 1}: a longer headline for portfolio and economic context`, source: "International Market Research and Analysis", published_at: "2026-11-20T11:00:00Z", url: "https://example.com/research", sentiment: { label: "Bullish", confidence: .87, score: .5 } })) } });
    return route.fulfill({ json: { items: [], quotes: [], data: [], spot_price: 6000, pcr: { pcr_oi: 1.1, signal: "neutral" } } });
  });
}

for (const width of [1440, 1024, 390]) {
  test(`@smoke Home prioritizes portfolio history and keeps populated labels readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await populatedHome(page);
    await page.goto("/");
    const dashboard = page.getByRole("main", { name: "Mission Control Dashboard" });
    const portfolio = dashboard.getByRole("region", { name: "Portfolio HQ", exact: true });
    const history = dashboard.getByRole("region", { name: "Primary portfolio historical comparison" });
    await expect(history).toContainText("Approximate history");
    const portfolioBounds = (await portfolio.boundingBox())!;
    expect(portfolioBounds.y).toBeLessThan(600);
    if (width === 1440) expect((await history.boundingBox())!.y).toBeLessThan(850);
    const rail = page.getByRole("complementary", { name: "Market outlook and desk context" });
    if (width === 1440) {
      expect((await rail.boundingBox())!.x).toBeGreaterThan(portfolioBounds.x + portfolioBounds.width);
      expect(Math.abs((await rail.boundingBox())!.y - portfolioBounds.y)).toBeLessThan(2);
    } else {
      expect((await rail.boundingBox())!.y).toBeGreaterThan((await history.boundingBox())!.y);
    }
    const snapshot = page.getByRole("region", { name: "Desk snapshot", exact: true });
    expect((await snapshot.boundingBox())!.y).toBeGreaterThan((await history.boundingBox())!.y);
    // Check the entire market strip, not only its first horizontally-visible chip.
    const strip = page.getByRole("list", { name: "Market heat strip", exact: true });
    await expect(strip.getByRole("button")).toHaveCount(6);
    expect(await strip.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const labels = dashboard.locator(".ot-home-widget-card-kicker, .ot-home-widget-metric-detail-label, .ot-home-widget-strip-label, .ot-home-widget-nav-label, .ot-home-widget-nav-section-title");
    expect(await labels.evaluateAll(elements => elements.filter(el => el.getClientRects().length).every(el => parseFloat(getComputedStyle(el).fontSize) >= 12 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    const details = page.getByText("Desk details and clocks", { exact: true });
    await details.focus(); await page.keyboard.press("Enter");
    await expect(page.getByText(/^Desk e2e@example\.com$/i)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^Desk e2e@example\.com$/i)).not.toBeVisible();
    const matrix = page.getByLabel("Launch matrix", { exact: true });
    const first = matrix.locator("button").first();
    await first.focus();
    const columns = await first.evaluate(button => getComputedStyle(button.parentElement!).gridTemplateColumns.split(" ").length);
    if (width === 390) expect(columns).toBe(1);
    await page.keyboard.press("ArrowDown"); await expect(matrix.locator("button").nth(columns)).toBeFocused();
    await page.keyboard.press("Home"); await expect(first).toBeFocused();
    await history.scrollIntoViewIfNeeded();
    const plot = history.locator(".ot-home-widget-chart-svg");
    const plotBounds = (await plot.boundingBox())!;
    await page.mouse.move(plotBounds.x + plotBounds.width * .25, plotBounds.y + 110);
    await expect(history.locator(".ot-home-widget-chart-tooltip-value")).not.toHaveText("129.00 index");
    expect(await history.locator(".ot-home-widget-chart-axis-y span").evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1 && parseFloat(getComputedStyle(el).fontSize) >= 12))).toBe(true);
    expect(await dashboard.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await dashboard.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("home-populated.png"), fullPage: true });
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("home-history.png"), fullPage: true });
  });
}

test("@smoke Quant Home fills its intelligence column without reserving an absent heatmap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await populatedHome(page, "quant"); await page.goto("/");
  const intelligence = page.getByRole("region", { name: "Dashboard Intelligence", exact: true });
  const timeline = intelligence.getByRole("heading", { name: "Home Intelligence Timeline", exact: true }).locator("xpath=ancestor::div[3]");
  await expect(timeline).toBeVisible();
  const parent = (await intelligence.boundingBox())!, child = (await timeline.boundingBox())!;
  expect(child.width).toBeGreaterThan(parent.width * .95);
  expect(Math.abs(child.x - parent.x)).toBeLessThan(2);
  await expect(page.getByRole("region", { name: "System Health", exact: true })).toHaveCount(0);
});

// Use the same full-browser preference contract as Portfolio acceptance. A
// 720px resized viewport alone does not establish native browser zoom.
test("@smoke Home labels and launch navigation reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "home-zoom-"));
  await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    // Expire one day after the fixed test clock, avoiding refresh timer overflow.
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "home-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-21T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await populatedHome(page); await page.goto(`${baseURL}/`);
    const main = page.getByRole("main", { name: "Mission Control Dashboard", exact: true });
    await expect(main.getByRole("region", { name: "Primary portfolio historical comparison" })).toContainText("Approximate history");
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const first = main.getByLabel("Launch matrix", { exact: true }).locator("button").first();
    await first.focus(); await page.keyboard.press("ArrowDown");
    await expect(main.getByLabel("Launch matrix", { exact: true }).locator("button").nth(1)).toBeFocused();
    await main.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("home-native-zoom.png"), Buffer.from(screenshot.data, "base64"));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
