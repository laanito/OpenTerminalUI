import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const company = "Long-term global infrastructure and communications technology research holding";
const workspaceName = "Cross-market research with dated evidence and independent chart studies";
const toolsName = "Workspace tools · symbol, comparison, replay and saved layouts";
async function fixture(page: Page, count = 4, failed = false) {
  const symbols = ["AAPL", "MSFT", "NVDA", "BTC-USD", "SAP.DE", "SPY"];
  const slots = Array.from({ length: count }, (_, i) => ({ id: `pane-${i + 1}`, ticker: symbols[i], companyName: `${symbols[i]} · ${company}`, market: "US", timeframe: "1D", chartType: "candle", indicators: [], extendedHours: { enabled: false, showPreMarket: true, showAfterHours: true, visualMode: "merged", colorScheme: "dimmed" }, preMarketLevels: { showPMHigh: true, showPMLow: true, showPMOpen: false, showPMVWAP: false, extendIntoRTH: true, daysToShow: 1 } }));
  const grid = { cols: count === 6 ? 3 : 2, rows: 2, arrangement: "grid" };
  await page.clock.setFixedTime(new Date("2026-11-22T12:00:00Z"));
  await page.addInitScript(({ slots, grid, workspaceName }) => localStorage.setItem("ot:chart-workstation:tabs:v1", JSON.stringify({ activeTabId: "research", tabs: [{ id: "research", name: workspaceName, snapshot: { slots, gridTemplate: grid, syncCrosshair: true }, linkGroups: Object.fromEntries(slots.map(slot => [slot.id, "off"])), linkSettings: { symbol: true, interval: true, crosshair: true, replay: false, dateRange: false }, compareSymbols: [], compareConfig: { mode: "normalized", placement: "active" }, rangePresets: {} }] })), { slots, grid, workspaceName });
  await page.routeWebSocket("**/*", socket => socket.close());
  const requests: string[] = [];
  const bars = Array.from({ length: 100 }, (_, i) => ({ t: Date.parse("2026-08-01T12:00:00Z") / 1000 + i * 86400, o: 100 + i, h: 104 + i, l: 98 + i, c: 102 + i, v: 1000 + i * 10 }));
  const chart = (ticker: string) => ({ ticker, interval: "1d", currency: "USD", data: bars });
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/charts/batch") {
      const tickers = route.request().postDataJSON().tickers;
      tickers.forEach((row: { symbol: string; timeframe: string }) => requests.push(`${row.symbol}:${row.timeframe}`));
      return route.fulfill({ json: Object.fromEntries(tickers.map((row: { symbol: string }) => [row.symbol, failed ? { ...chart(row.symbol), data: [], error: "Historical provider unavailable" } : chart(row.symbol)])) });
    }
    if (path.startsWith("/api/chart/") || path.startsWith("/api/v3/chart/")) { requests.push(`${decodeURIComponent(path.split("/").pop() || "")}:compare`); return route.fulfill({ json: { ...chart("SPY"), data: bars.map(bar => ({ ...bar, t: bar.t * 1000 })) } }); }
    if (path === "/api/instruments/search") return route.fulfill({ json: { results: [{ display_symbol: "NVDA", name: company, country_code: "US", exchange: "NASDAQ" }] } });
    if (path.includes("templates") || path === "/api/scripting/scripts") return route.fulfill({ json: [] });
    if (path.endsWith("/alerts")) return route.fulfill({ json: { alerts: [] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return requests;
}
async function bounded(page: Page) {
  const main = page.getByRole("main", { name: "Chart Workstation", exact: true });
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await main.locator(".chart-panel-header, .chart-panel-footer").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Workstation keeps real charts readable and workspace controls reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const requests = await fixture(page);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("/equity/chart-workstation");
    const main = page.getByRole("main", { name: "Chart Workstation", exact: true });
    const first = main.getByTestId("chart-panel-pane-1"), second = main.getByTestId("chart-panel-pane-2");
    await expect(first.locator("canvas").first()).toBeVisible();
    const plot = (await first.locator(".chart-panel-body").boundingBox())!;
    expect(plot.y).toBeLessThan(850); expect(plot.height).toBeGreaterThanOrEqual(250);
    await expect(main.getByRole("region", { name: "Workspace tools", exact: true })).toBeHidden();
    await expect(main.getByRole("button", { name: "Load", exact: true })).toHaveCount(0);
    await expect(first.getByText(`AAPL · ${company}`, { exact: true })).toBeVisible();
    await expect(first.getByTestId("chart-panel-footer")).toContainText("201.00");
    expect(await first.getByTestId("chart-panel-footer").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    expect(await first.getByText(`AAPL · ${company}`, { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("workstation-charts.png"), fullPage: true });
    await first.getByText("Chart tools", { exact: true }).click();
    const surfaceTools = first.getByRole("group", { name: "Chart tools", exact: true });
    await expect(surfaceTools.getByTestId("chart-context-summary")).toBeVisible();
    await surfaceTools.getByRole("combobox", { name: "Price scale transform", exact: true }).selectOption("logarithmic");
    await expect(surfaceTools.getByRole("combobox", { name: "Price scale transform", exact: true })).toHaveValue("logarithmic");
    await surfaceTools.getByRole("combobox", { name: "Price scale transform", exact: true }).selectOption("normal");
    await first.getByText("Chart tools", { exact: true }).click();
    await first.focus(); await page.keyboard.press("2"); await expect(second).toBeFocused(); await page.keyboard.press("1"); await expect(first).toBeFocused();
    const search = first.getByRole("combobox", { name: "Chart symbol", exact: true });
    await search.click(); await search.fill("NV"); await page.keyboard.type("m"); await expect(search).toHaveValue("NVm"); await expect(search).toBeFocused();
    await first.getByRole("option").filter({ hasText: company }).click(); await expect(search).toHaveValue("NVDA");
    await first.getByRole("button", { name: "Change timeframe", exact: true }).click(); await page.getByRole("menuitem", { name: "1h", exact: true }).click();
    await expect.poll(() => requests).toContain("NVDA:60m");
    await main.getByText(toolsName, { exact: true }).click();
    const tools = main.getByRole("region", { name: "Workspace tools", exact: true });
    const compare = tools.getByTestId(width < 768 ? "chart-shell-compare-input-mobile" : "chart-shell-compare-input-desktop");
    await compare.fill("SPY"); await compare.press("Enter"); await expect.poll(() => requests.some(request => request.startsWith("SPY:"))).toBe(true);
    await tools.getByRole("button", { name: width < 768 ? "Snapshot" : "Save Snapshot", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ot:chart-workstation:snapshots:v1") || "[]").length)).toBeGreaterThan(0);
    await tools.scrollIntoViewIfNeeded(); await bounded(page); await page.screenshot({ path: testInfo.outputPath("workstation-tools.png"), fullPage: true });
    await main.getByText(toolsName, { exact: true }).click(); await expect(tools).toBeHidden();
    const indicators = first.getByRole("button", { name: "Show indicators panel", exact: true }); await indicators.click();
    const manager = page.getByRole("dialog", { name: "Manage indicators · NVDA", exact: true }); await expect(manager).toBeVisible();
    await page.keyboard.press("2"); await expect(main.getByTestId("chart-shell-active-pane")).toContainText("Pane 1: NVDA");
    await manager.getByRole("textbox", { name: "Search indicators", exact: true }).fill("sma"); await manager.getByTitle("sma", { exact: true }).click();
    await expect(manager.getByRole("button", { name: "Configure", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("workstation-indicators.png"), fullPage: true });
    await page.keyboard.press("Escape"); await expect(manager).toHaveCount(0); await expect(indicators).toBeFocused();
    await first.getByRole("button", { name: "Fullscreen chart", exact: true }).click(); await expect(first).toHaveClass(/fullscreen/);
    await first.getByRole("button", { name: "Show indicators panel", exact: true }).click();
    await expect(manager).toBeVisible(); await manager.getByRole("button", { name: "Close modal", exact: true }).click();
    await expect(manager).toHaveCount(0); await expect(first).toHaveClass(/fullscreen/);
    await first.getByRole("button", { name: "Exit fullscreen", exact: true }).click(); await expect(first).not.toHaveClass(/fullscreen/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ot:chart-workstation:tabs:v1") || "{}"));
    expect(saved.tabs[0].snapshot.gridTemplate).toMatchObject({ cols: 2, rows: 2 });
    expect(saved.tabs[0].snapshot.slots[0].indicators).toHaveLength(1); expect(saved.tabs[0].snapshot.slots[1].indicators).toHaveLength(0);
    await main.getByRole("button", { name: "Layout 3x2", exact: true }).click();
    await main.getByRole("button", { name: "+ Add Pane", exact: true }).click();
    await expect(main.locator(".chart-panel")).toHaveCount(5);
    await main.locator(".chart-panel").last().getByRole("button", { name: "Remove chart", exact: true }).click();
    await expect(main.locator(".chart-panel")).toHaveCount(4);
    await main.getByRole("button", { name: "Layout 2x2", exact: true }).click();
    await bounded(page); expect(errors).toEqual([]);
  });
}

test("@smoke Six populated panes reflow without rewriting the saved desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await fixture(page, 6); await page.goto("/equity/chart-workstation");
  const grid = page.getByTestId("chart-grid"); await expect(grid).toHaveAttribute("data-grid-cols", "3");
  await expect(page.locator(".chart-panel-body canvas").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1000 }); await expect(grid).toHaveAttribute("data-grid-cols", "1");
  await expect(page.getByRole("region", { name: "Chart pane 6: SPY", exact: true })).toBeVisible();
  await page.getByTestId("chart-panel-pane-6").focus(); await expect(page.getByTestId("chart-panel-pane-6")).toBeFocused(); await bounded(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(grid).toHaveAttribute("data-grid-cols", "3");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ot:chart-workstation:tabs:v1") || "{}"));
  expect(saved.tabs[0].snapshot.gridTemplate).toMatchObject({ cols: 3, rows: 2 }); expect(saved.tabs[0].snapshot.slots).toHaveLength(6);
});

test("@smoke Workstation provider errors remain explicit instead of blank plots", async ({ page }) => {
  await fixture(page, 4, true); await page.goto("/equity/chart-workstation");
  await expect(page.getByTestId("chart-panel-pane-1").getByRole("alert")).toContainText("Historical provider unavailable");
  await expect(page.getByTestId("chart-panel-pane-1").locator("canvas")).toHaveCount(0);
});

test("@smoke Workstation charts and per-pane indicator management reflow at native 200% zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "workstation-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "workstation-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-23T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/chart-workstation`);
    const first = page.getByTestId("chart-panel-pane-1"); await expect(first.locator("canvas").first()).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" }); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    await first.getByRole("button", { name: "Show indicators panel", exact: true }).click(); const manager = page.getByRole("dialog", { name: "Manage indicators · AAPL", exact: true }); await expect(manager).toBeVisible();
    expect(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("workstation-native-zoom.png"), Buffer.from(shot.data, "base64"));
    await page.keyboard.press("Escape"); await expect(manager).toHaveCount(0);
  } finally { await context.close(); }
});
