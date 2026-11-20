import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const company = "Long-Horizon Technology and Communications Research Corporation";
const sector = "Information technology and communications infrastructure";
const dates = Array.from({ length: 45 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

async function securityFixture(page: Page) {
  let emptyHistory = false;
  const comparisons: string[] = [];
  await page.clock.setFixedTime(new Date("2026-11-20T12:00:00Z"));
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith("/stocks/AAPL")) return route.fulfill({ json: { ticker: "AAPL", symbol: "AAPL", company_name: company, exchange: "NASDAQ", sector, industry: "Electronic equipment and research infrastructure", country: "United States", currency: "USD", current_price: 220, change_pct: 0, volume: 12345678, pe: 0, dividend_yield: null, beta: null, market_cap: 123456789000, low_52_week: 150, high_52_week: 230, open: 218, high: 221, low: 217, previous_close: 219, avg_volume: 15000000 } });
    if (path.includes("/chart/AAPL")) return route.fulfill({ json: { ticker: "AAPL", currency: "USD", data: emptyHistory ? [] : dates.map((date, i) => ({ t: Date.parse(date) * (url.searchParams.has("normalized") ? 1 : .001), o: 200 + i, h: 202 + i, l: 198 + i, c: 201 + i, v: 5000 })) } });
    if (path.endsWith("/financials")) return route.fulfill({ json: { rows: [{ date: "2026-09-30", revenue: 0, totalRevenue: 100, netIncome: 0, eps: 0, epsDiluted: 1, ebitda: 0 }, { date: "2025-09-30", revenue: 2000000, netIncome: 200000, eps: 2, ebitda: 300000 }] } });
    if (path.endsWith("/analyst-consensus")) return route.fulfill({ json: { consensus: "Moderate buy", buy_pct: 60, hold_pct: 30, sell_pct: 10 } });
    if (path.endsWith("/stock-picking/conviction/AAPL")) return route.fulfill({ json: { symbol: "AAPL", source_count: 2, engine: "llm", model_profile: { requested_profile: "deep", resolved_profile: "deep", model: "research-model" }, bullish_score: 60, bearish_score: 40, summary: "Dated research describes demand and execution risks; this is a saved extraction.", catalysts: [{ title: "Long-term infrastructure demand and capital expenditure update", date: "2026-12-01", source: "Quarterly research notes and annual filing", impact: "bullish" }] } });
    if (path.endsWith("/ownership")) return route.fulfill({ json: { shareholding: { public_holding: 0 }, institutional_holders: [{ holder: "Long Horizon International Investment Management", shares: 123000, change: 0, date_reported: "2026-09-30" }], insider_transactions: [{ name: "Alex Morgan", transactionDate: "2026-10-01", transactionCode: "S", change: 100, price: 220 }] } });
    if (path.endsWith("/estimates")) return route.fulfill({ json: { price_target: { targetMean: 240 }, recommendation_trends: [{ period: "2026-10", buy: 0, strongBuy: 10, hold: 5, sell: 2 }], analyst_estimates: [{ date: "2027-09-30", estimatedRevenueAvg: 3000000, estimatedEpsAvg: 3, numberAnalystEstimatedRevenue: 12, numberAnalystsEstimatedEps: 15 }] } });
    if (path.endsWith("/peers/AAPL")) return route.fulfill({ json: { peers: [{ symbol: "MSFT", name: "Microsoft Research and Technology", market_cap: 1000000000, pe: 30, change_pct: 1 }] } });
    if (path.endsWith("/esg")) return route.fulfill({ json: { latest: { environmentalScore: 0, socialScore: 10, governanceScore: 20, ESGScore: 30, rating: "Medium risk", date: "2026-10-01" }, history: [{ date: "2026-10-01", environmentalScore: 0, socialScore: 10, governanceScore: 20, ESGScore: 30 }] } });
    if (path.includes("/news/sentiment/")) return route.fulfill({ json: { overall_label: "Neutral", average_score: 0, daily_sentiment: [] } });
    if (path.includes("/news/by-ticker/")) return route.fulfill({ json: { items: [{ id: "news-1", title: "A longer research headline covering investment plans and capital expenditure", source: "International Financial Research Desk", url: "https://example.com/research", published_at: "2026-11-20T11:00:00Z", sentiment_label: "Neutral" }] } });
    if (path.endsWith("/charts/compare")) { comparisons.push(url.searchParams.get("symbols") || ""); return route.fulfill({ json: { dates, series: { AAPL: dates.map((_, i) => 100 + i), MSFT: dates.map((_, i) => 100 + i / 2) } } }); }
    return route.fulfill({ json: { items: [], data: [], quotes: [], results: [] } });
  });
  return { comparisons, clearHistory: () => { emptyHistory = true; } };
}

for (const width of [1440, 1024, 390]) {
  test(`@smoke Security Hub has readable populated research tabs and independent context at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const fixture = await securityFixture(page);
    await page.goto("/equity/security/AAPL?tab=overview&scope=retained");
    const hub = page.getByRole("main", { name: "Security research", exact: true });
    await expect(hub.getByRole("heading", { level: 1, name: "AAPL", exact: true })).toBeVisible();
    await expect(hub.getByText(company, { exact: true })).toBeVisible();
    // The shell owns page scrolling; a second bounded page scroller reserves
    // mobile bottom padding as a permanent blank strip.
    expect(await hub.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(hub.getByRole("img", { name: "AAPL six-month price history" })).toBeVisible();
    await expect(hub.getByText("Model extraction · Deep profile · research-model", { exact: true })).toBeVisible();
    const context = hub.getByRole("complementary", { name: "Security context" });
    const overview = hub.getByRole("heading", { name: "Overview", exact: true }).locator("xpath=ancestor::section[1]");
    const catalysts = hub.getByRole("heading", { name: "AI Catalyst Conviction" });
    if (width === 1440) {
      expect((await context.boundingBox())!.x).toBeGreaterThan((await overview.boundingBox())!.x);
      expect((await catalysts.boundingBox())!.y - ((await overview.boundingBox())!.y + (await overview.boundingBox())!.height)).toBeLessThan(60);
    }
    await expect(hub.getByText("P/E", { exact: true }).locator("xpath=parent::dl/dd")).toHaveText("0");
    await expect(hub.getByText("Div Yield", { exact: true }).locator("xpath=parent::dl/dd")).toHaveText("-");
    expect(await hub.locator(".ot-type-label").evaluateAll(elements => elements.filter(el => el.getClientRects().length).every(el => parseFloat(getComputedStyle(el).fontSize) >= 12 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await hub.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("security-overview.png"), fullPage: true });
    const tabs = hub.getByRole("tablist", { name: "Security research sections" });
    const overviewTab = tabs.getByRole("tab", { name: "Overview", exact: true });
    await overviewTab.focus(); await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Financials", exact: true })).toBeFocused();
    await expect(page).toHaveURL(/tab=financials&scope=retained/);
    const annual = hub.getByRole("grid", { name: "Annual financial statements", exact: true });
    await expect(annual.getByRole("row")).toHaveCount(3);
    expect((await annual.boundingBox())!.height).toBeLessThan(180);
    const zeroRow = annual.getByRole("row").nth(1);
    await expect(zeroRow.getByRole("gridcell").nth(1)).toHaveText(/^0(?:\.00)?$/);
    await expect(zeroRow.getByRole("gridcell").last()).toHaveText(/^0(?:\.00)?$/);
    await page.screenshot({ path: testInfo.outputPath("security-financials.png"), fullPage: true });
    for (const [tab, grid] of [["Ownership", "Institutional holders"], ["Estimates", "Analyst estimates"], ["Peers", "Comparable companies"], ["ESG", "ESG history"]]) {
      await tabs.getByRole("tab", { name: tab, exact: true }).click();
      await expect(hub.getByRole("grid", { name: grid, exact: true })).toBeVisible();
      expect(await hub.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await tabs.getByRole("tab", { name: "News", exact: true }).click();
    await expect(hub.getByRole("region", { name: "Security headlines" })).toContainText("A longer research headline");
    await tabs.getByRole("tab", { name: "Chart", exact: true }).click();
    await hub.getByRole("textbox", { name: "Add comparison symbol" }).fill("MSFT");
    await hub.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => fixture.comparisons).toContain("AAPL,MSFT");
    await hub.getByRole("button", { name: "Remove MSFT comparison", exact: true }).click();
    await expect(hub.getByRole("button", { name: "Remove MSFT comparison", exact: true })).toHaveCount(0);
    expect(await hub.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("@smoke Security Hub shows missing history and empty statements without blank charts or tables", async ({ page }) => {
  const fixture = await securityFixture(page); fixture.clearHistory();
  await page.route("**/stocks/AAPL/financials?*", route => route.fulfill({ json: { rows: [] } }));
  await page.goto("/equity/security/AAPL");
  await expect(page.getByText("No price history is available for this security.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Financials", exact: true }).click();
  await expect(page.getByText("No annual financial statements available.", { exact: true })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Annual financial statements", exact: true })).toHaveCount(0);
});

test("@smoke Security research tabs and metrics reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "security-zoom-")); await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "security-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-21T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await securityFixture(page); await page.goto(`${baseURL}/equity/security/AAPL`);
    const hub = page.getByRole("main", { name: "Security research", exact: true });
    await expect(hub.getByRole("img", { name: "AAPL six-month price history" })).toBeVisible();
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    expect(await hub.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const tabs = hub.getByRole("tablist", { name: "Security research sections" });
    await tabs.getByRole("tab", { name: "Overview", exact: true }).focus(); await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "ESG", exact: true })).toBeFocused();
    await expect(hub.getByRole("grid", { name: "ESG history", exact: true })).toBeVisible();
    const dismissInstall = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismissInstall.isVisible()) await dismissInstall.click();
    await hub.getByRole("heading", { name: "ESG", exact: true }).scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("security-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
