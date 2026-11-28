import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
const fixtureData = JSON.parse(readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/backtest-result.json"), "utf8"));
async function fixture(page: Page) {
  const state = { failed: false, analyticsFailed: false, submissions: [] as any[], optimizations: [] as any[] };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith("/data/version/active")) return json({ id: "review-version" });
    if (path.endsWith("/v1/backtest/submit")) { state.submissions.push(route.request().postDataJSON()); return state.failed ? json({ detail: "Review submit failure" }, 503) : json(fixtureData.submit); }
    if (path.includes("/v1/backtest/status/")) return json(fixtureData.status);
    if (path.includes("/v1/backtest/result/")) return json({ ...fixtureData.result, result: { ...fixtureData.result.result, trades: [{ date: "2026-01-02", action: "BUY", quantity: .12345678, price: 100 }] } });
    if (path.endsWith("/analytics")) return state.analyticsFailed ? json({}, 503) : json(fixtureData.analytics);
    if (path.endsWith("/walkforward")) return json({ validation: { windows: [{ window: "Window with a long descriptive training/test period", train_start: "2025-01-01", train_end: "2025-08-01", test_start: "2025-08-02", test_end: "2026-01-01", sharpe: 1.2, total_return: .1, max_drawdown: -.04 }] } });
    if (path.endsWith("/optimize")) { state.optimizations.push(route.request().postDataJSON()); return json({ optimization: { trials: [] } }); }
    return json({ items: [], results: [], alerts: [] });
  });
  return state;
}
async function bounded(page: Page) {
  const issues = await page.getByRole("main", { name: "Backtesting workspace", exact: true }).evaluate(main => {
    const visible = (el: Element) => el.getClientRects().length > 0;
    return [...main.querySelectorAll("input, select, button, summary, [role=region]")].filter(visible).flatMap(el => {
      if (el.closest("[role=region] table")) return [];
      const box = el.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1 ? [el.getAttribute("aria-label") || el.textContent?.slice(0,80)] : [];
    });
  }); expect(issues).toEqual([]);
  expect(await page.getByRole("main", { name: "Backtesting workspace", exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}
async function run(page: Page) { await page.getByRole("button", { name: "Run", exact: true }).click(); await expect(page.getByText("Status: DONE")).toBeVisible(); }
for (const width of [1440, 1024, 390]) test(`@smoke Backtesting readable setup, submitted results and secondary inspection at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  if (width === 1024) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/backtesting"); const main = page.getByRole("main", { name: "Backtesting workspace", exact: true });
  await expect(main.getByText("Run a backtest to load charts and result analytics.")).toBeVisible(); await expect(main.getByText("Backtest Performance", { exact: true })).toHaveCount(0); await bounded(page);
  expect(await main.getByLabel("Asset (Ticker)").evaluate(el => getComputedStyle(el).fontSize)).toBe("14px");
  await page.screenshot({ path: info.outputPath("backtesting-setup.png"), fullPage: true, animations: "disabled" });
  await main.locator("summary").filter({ hasText: "Data and execution settings" }).click(); await expect(main.getByLabel("Commission (bps)")).toHaveValue("5"); await bounded(page); await page.screenshot({ path: info.outputPath("backtesting-execution.png"), fullPage: true, animations: "disabled" }); await main.locator("summary").filter({ hasText: "Data and execution settings" }).click();
  await run(page); expect(state.submissions[0]).toMatchObject({ symbol: "AAPL", market: "NASDAQ", timeframe: "1d", strategy: "example:sma_crossover", config: { initial_cash: 100000, adjusted: true, execution_profile: { commission_bps: 5, slippage_bps: 3, spread_bps: 1, volume_cap_pct: 10 } } });
  await expect(main.getByText("$112,000.00", { exact: true }).first()).toBeVisible();
  const manager = main.getByRole("button", { name: "Indicator manager", exact: true }); await expect(manager).toHaveAttribute("aria-pressed", "false"); await manager.click(); await expect(main.getByRole("textbox", { name: "Search indicators", exact: true })).toBeVisible(); await bounded(page); await manager.click(); await expect(main.getByRole("textbox", { name: "Search indicators", exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Equity Curve", exact: true }).click(); await expect(main.locator("svg polyline").first()).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("backtesting-results.png"), fullPage: true, animations: "disabled" });
  await main.getByLabel("Asset (Ticker)").fill("RELIANCE"); await main.getByRole("combobox", { name: "Market", exact: true }).selectOption("NSE"); await main.getByRole("combobox", { name: "Model", exact: true }).selectOption("mean_reversion");
  await expect(main.getByRole("region", { name: "Submitted backtest", exact: true })).toContainText("AAPL · NASDAQ · SMA Crossover"); await expect(main.getByText("$112,000.00", { exact: true }).first()).toBeVisible(); expect(state.optimizations).toHaveLength(1); expect(state.optimizations[0].symbol).toBe("AAPL");
  await main.locator("summary").filter({ hasText: "Exact run observations" }).click(); const exact = main.getByRole("region", { name: "Backtest equity observations", exact: true }); await exact.focus(); await expect(exact).toBeFocused(); if (await exact.evaluate(el => el.scrollWidth > el.clientWidth + 1)) { await exact.press("ArrowRight"); await expect.poll(() => exact.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page);
  await main.getByRole("button", { name: "Monthly Returns", exact: true }).click(); const months = main.getByRole("region", { name: "Monthly return values", exact: true }); await expect(months).toBeVisible(); await months.focus(); if (await months.evaluate(el => el.scrollWidth > el.clientWidth + 1)) { await months.press("ArrowRight"); await expect.poll(() => months.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page);
  await main.locator("summary").filter({ hasText: "Costs, data checks and validation" }).click(); await expect(main.getByRole("region", { name: "Walk-forward values", exact: true })).toBeVisible(); await bounded(page);
  await main.locator("summary").filter({ hasText: "Trade blotter and execution logs" }).click(); const ledger = main.getByRole("region", { name: "Backtest trade ledger", exact: true }); await expect(ledger).toContainText("0.12345678"); await bounded(page); await page.screenshot({ path: info.outputPath("backtesting-inspection.png"), fullPage: true, animations: "disabled" }); expect(errors).toEqual([]);
});
test("@smoke Backtesting analytics failure and failed resubmission retain the editable setup", async ({ page }, info) => {
  const state = await fixture(page); state.analyticsFailed = true; await page.goto("/backtesting"); await run(page); await expect(page.getByText(/Server analytics unavailable/)).toBeVisible(); state.analyticsFailed = false; await page.getByRole("button", { name: "Retry analytics", exact: true }).click(); await expect(page.getByText("Analytics returned for this run.")).toBeVisible(); expect(state.submissions).toHaveLength(1);
  state.failed = true; await page.getByRole("button", { name: "Run", exact: true }).click(); await expect(page.getByText(/No completed result is shown/)).toBeVisible(); await expect(page.getByText("Backtest Performance", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Asset (Ticker)")).toHaveValue("AAPL"); await bounded(page); await page.screenshot({ path: info.outputPath("backtesting-failed.png"), fullPage: true, animations: "disabled" });
});
test("@smoke Backtesting result inspection reflows at native 200% Chrome zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "backtesting-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const token = `x.${btoa(JSON.stringify({ sub: "backtest-review", email: "review@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", token); localStorage.setItem("ot-refresh-token", token); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/backtesting`); await run(page); await page.getByRole("button", { name: "Equity Curve", exact: true }).click(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await info.attach("zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" });
    await page.locator("summary").filter({ hasText: "Exact run observations" }).click(); const values = page.getByRole("region", { name: "Backtest equity observations", exact: true }); await values.focus(); if (await values.evaluate(el => el.scrollWidth > el.clientWidth + 1)) { await values.press("ArrowRight"); await expect.poll(() => values.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); const cdp = await context.newCDPSession(page); const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(info.outputPath("backtesting-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});

test("@smoke Backtesting restores Saved View setup without shared defaults overwriting it", async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => localStorage.setItem("ot:saved-view:pending", JSON.stringify({ page: "/backtesting", filters: { asset: "MSFT", market: "NYSE", start: "2025-01-01", end: "2025-12-01", dataTimeframe: "1h", strategyMode: "mean_reversion" }, activeTabs: { activeTab: "equity" } })));
  await page.goto("/backtesting"); await expect(page.getByLabel("Asset (Ticker)")).toHaveValue("MSFT"); await expect(page.getByRole("combobox", { name: "Market", exact: true })).toHaveValue("NYSE"); await expect(page.getByRole("combobox", { name: "Data interval", exact: true })).toHaveValue("1h"); await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("mean_reversion"); expect(state.submissions).toHaveLength(0); await bounded(page);
});
