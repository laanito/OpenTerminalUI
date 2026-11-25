import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const groupName = "Worldwide industrial infrastructure and information technology services";
const company = "International infrastructure and communications equipment research corporation";
async function fixture(page: Page) {
  const state = { failed: false, empty: false, waitETF: false, releaseETF: null as null | (() => void), reads: [] as string[] };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const failure = () => route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
    if (/\/(heatmap|analytics|etf)\//.test(path) && state.failed) return failure();
    if (path.endsWith("/heatmap/treemap")) {
      const items = state.empty ? [] : [{ symbol: "AAPL", name: company, sector: groupName, industry: "Communications equipment and global infrastructure", market_cap: 500, price: 100, change_pct: 2, volume: 10000, turnover: 1000000, value: 500 }, { symbol: "MSFT", name: "Worldwide enterprise systems and research services", sector: groupName, industry: "Enterprise systems", market_cap: 100, price: null, change_pct: null, volume: null, turnover: null, value: 100 }];
      return route.fulfill({ json: { market: url.searchParams.get("market"), period: url.searchParams.get("period"), group: url.searchParams.get("group"), size_by: url.searchParams.get("size_by"), data: items, total_value: 600, groups: state.empty ? [] : [{ name: groupName, value: 600, children: items }], degraded: { reason: "no_live_source" } } });
    }
    if (path.endsWith("/analytics/sector-rotation")) return route.fulfill({ json: { benchmark: url.searchParams.get("benchmark"), timestamp: "2026-11-25T12:00:00Z", sectors: state.empty ? [] : ["XLK", "XLI"].map((symbol, index) => ({ symbol, current: { date: "2026-11-25", x: 102, y: 101 }, trail: [{ date: "2026-11-23", x: 95 + index, y: 95 }, { date: "2026-11-24", x: 98 + index, y: 99 }, { date: "2026-11-25", x: 102 + index, y: 101 }] })), degraded: { reason: "no_live_source" } } });
    if (path.endsWith("/etf/holdings")) {
      const ticker = url.searchParams.get("ticker"); state.reads.push(`holdings:${ticker}`);
      if (ticker === "SPY" && state.waitETF) await new Promise<void>(resolve => { state.releaseETF = resolve; });
      return route.fulfill({ json: { holdings: state.empty ? [] : [{ symbol: ticker === "QQQ" ? "NEWCO" : "AAPL", name: ticker === "QQQ" ? "New scope research holding" : company, weight: 7.1 }, { symbol: "MSFT", name: "Enterprise research services", weight: 6.5 }], degraded: { reason: "no_live_source" } } });
    }
    if (path.endsWith("/etf/flows")) return route.fulfill({ json: { ticker: url.searchParams.get("ticker"), flows: state.empty ? [] : [{ date: "2026-11-24", net_flow: 0 }, { date: "2026-11-25", net_flow: -2.5 }], degraded: { reason: "no_live_source" } } });
    if (path.endsWith("/etf/overlap")) { state.reads.push(`overlap:${url.searchParams.get("tickers")}`); return route.fulfill({ json: { tickers: url.searchParams.get("tickers")?.split(","), overlap_pct: 95.2, common_holdings: state.empty ? [] : [{ symbol: "AAPL", name: company, weight: 7 }], degraded: { reason: "no_live_source" } } }); }
    return route.fulfill({ json: { items: [], results: [], quotes: [], alerts: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const main = page.getByRole("main").last(); expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const input of await main.locator("input, select, button").all()) {
    if (!await input.isVisible() || await input.evaluate(el => Boolean(el.closest("table")))) continue;
    const box = await input.boundingBox(); if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1); }
  }
}
for (const width of [1440, 1024, 390]) test(`@smoke Market heatmap, rotation and ETF readable review at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/heatmap"); const map = page.getByRole("main", { name: "Market heatmap", exact: true }); await map.getByRole("combobox", { name: "Heatmap period", exact: true }).selectOption("1m"); await map.getByRole("combobox", { name: "Inspect heatmap group", exact: true }).selectOption(groupName); await expect(map.getByText(`${groupName} · US · 1m · Market Cap`, { exact: true })).toBeVisible();
  const svg = map.getByTestId("market-heatmap-svg");
  if (await svg.count()) {
    const coverage = await svg.evaluate(el => { const area = Number(el.getAttribute("width")) * Number(el.getAttribute("height")); return [...el.querySelectorAll("[data-testid=heatmap-rect]")].reduce((sum, tile) => sum + Number(tile.getAttribute("width")) * Number(tile.getAttribute("height")), 0) / area; }); expect(coverage).toBeGreaterThan(.85);
    await svg.getByRole("link", { name: new RegExp(`AAPL · ${company}`) }).focus(); await expect(map.getByRole("region", { name: "Heatmap tile inspection", exact: true })).toContainText(company); await page.screenshot({ path: info.outputPath("market-map.png"), fullPage: true, animations: "disabled" }); await map.getByRole("button", { name: /^list$/i }).click(); }
  await expect(map.getByText(company, { exact: true }).first()).toBeVisible(); await expect(map.getByText("NA", { exact: true }).first()).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("market-heatmap.png"), fullPage: true, animations: "disabled" });
  await page.goto("/equity/sector-rotation"); await page.getByRole("combobox", { name: "Rotation benchmark", exact: true }).selectOption("QQQ"); await expect(page.getByText(/Benchmark: QQQ/)).toBeVisible(); const slider = page.getByRole("slider", { name: "Rotation historical point", exact: true }); await slider.focus(); await page.keyboard.press("ArrowLeft"); await expect(slider).toHaveValue("1"); await expect(page.getByRole("article").filter({ hasText: "XLK" })).toContainText("2026-11-24"); await expect(page.getByRole("button", { name: "XLK", exact: true })).toHaveCSS("font-size", "14px"); await bounded(page); await page.screenshot({ path: info.outputPath("market-rotation.png"), fullPage: true, animations: "disabled" });
  await page.goto("/equity/etf-analytics?ticker=SPY&review=keep"); const etf = page.getByRole("main", { name: "ETF analytics", exact: true }); await expect(etf.getByText(company, { exact: true }).first()).toBeVisible();
  const initial = state.reads.length; await etf.getByRole("textbox", { name: "ETF ticker", exact: true }).fill("QQQ"); expect(state.reads).toHaveLength(initial); await etf.getByRole("button", { name: "Load ETF", exact: true }).click(); await expect(etf.getByText("New scope research holding", { exact: true })).toBeVisible(); expect(new URL(page.url()).searchParams.get("review")).toBe("keep");
  await etf.getByRole("textbox", { name: "Comparison tickers", exact: true }).fill("SPY"); await etf.getByRole("button", { name: "Compare ETFs", exact: true }).click(); await expect(etf.getByRole("alert")).toContainText("at least two"); await expect(etf.getByText(/Applied comparison: SPY vs VOO/)).toBeVisible(); await etf.getByRole("textbox", { name: "Comparison tickers", exact: true }).fill("QQQ, VOO"); await etf.getByRole("button", { name: "Compare ETFs", exact: true }).click(); await expect(etf.getByText(/Applied comparison: QQQ vs VOO/)).toBeVisible();
  await etf.locator("summary").filter({ hasText: /^Fund flows$/ }).click(); await expect(etf.getByText("+0.00M", { exact: true })).toBeVisible();
  await bounded(page); await page.screenshot({ path: info.outputPath("market-etf.png"), fullPage: true, animations: "disabled" });
});
test("@smoke ETF late responses cannot replace an applied scope", async ({ page }) => {
  const state = await fixture(page); state.waitETF = true; await page.goto("/equity/etf-analytics?ticker=SPY"); await expect.poll(() => Boolean(state.releaseETF)).toBe(true); await page.getByRole("textbox", { name: "ETF ticker", exact: true }).fill("QQQ"); await page.getByRole("button", { name: "Load ETF", exact: true }).click(); await expect(page.getByText("New scope research holding", { exact: true })).toBeVisible(); state.releaseETF?.(); await expect(page.getByRole("heading", { name: "Holdings Analysis: QQQ", exact: true }).locator("xpath=ancestor::section[1]")).not.toContainText(company);
});
test("@smoke Market review failures and empty scopes stay distinct from zero observations", async ({ page }) => {
  const state = await fixture(page); state.failed = true;
  await page.goto("/equity/heatmap"); await expect(page.getByRole("alert")).toContainText("Failed to load heatmap data"); await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await page.goto("/equity/sector-rotation"); await expect(page.getByRole("alert")).toContainText("Failed to load sector rotation"); await expect(page.getByRole("button", { name: "Play rotation playback", exact: true })).toBeDisabled();
  await page.goto("/equity/etf-analytics"); await expect(page.getByRole("button", { name: "Retry holdings", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Retry overlap", exact: true })).toBeVisible(); expect(await page.locator("body").innerText()).not.toContain("PRIVATE_PROVIDER_CONTEXT"); state.failed = false; state.empty = true; await page.getByRole("button", { name: "Retry holdings", exact: true }).click(); await expect(page.getByText("No holdings data available", { exact: true })).toBeVisible();
  await page.goto("/equity/heatmap"); await expect(page.getByText("No heatmap data available.", { exact: true })).toBeVisible(); await page.goto("/equity/sector-rotation"); await expect(page.getByText("No dated rotation trails returned.", { exact: true })).toBeVisible();
});
test("@smoke Rotation playback advances once per step, stops and resets on benchmark changes", async ({ page }) => {
  await fixture(page); await page.goto("/equity/sector-rotation"); const slider = page.getByRole("slider", { name: "Rotation historical point", exact: true }); await expect(slider).toHaveValue("2"); await page.clock.install(); await page.getByRole("button", { name: "Play rotation playback", exact: true }).click(); await expect(slider).toHaveValue("0"); await page.clock.runFor(500); await expect(slider).toHaveValue("1"); await page.clock.runFor(500); await expect(slider).toHaveValue("2"); await expect(page.getByRole("button", { name: "Play rotation playback", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Play rotation playback", exact: true }).click(); await page.getByRole("combobox", { name: "Rotation benchmark", exact: true }).selectOption("QQQ"); await expect(page.getByRole("button", { name: "Play rotation playback", exact: true })).toBeVisible(); await page.clock.runFor(1500); await expect(slider).toHaveValue("2");
});
test("@smoke Market review reflows under actual 200% Chrome zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "market-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "market-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page);
    for (const path of ["heatmap", "sector-rotation", "etf-analytics"]) { await page.goto(`${baseURL}/equity/${path}`); await expect(page.getByRole("main").last()).toBeVisible(); await bounded(page); }
    await expect(page.getByText(company, { exact: true }).first()).toBeVisible(); const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom", { body: JSON.stringify(metrics), contentType: "application/json" }); const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(info.outputPath("market-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
test("@smoke Shared rotation remains usable in a narrow Launchpad popout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 }); await fixture(page);
  await page.goto("/equity/launchpad/popout?type=sector-rotation&title=Rotation%20review&linked=0&linkGroup=none");
  const panel = page.getByRole("region", { name: "Sector rotation", exact: true });
  await expect(panel.getByRole("button", { name: "XLK", exact: true })).toBeAttached();
  const benchmark = panel.getByRole("combobox", { name: "Rotation benchmark", exact: true }); await benchmark.selectOption("QQQ");
  await expect(panel.getByText(/Benchmark: QQQ/)).toBeVisible(); await panel.getByRole("button", { name: "XLK", exact: true }).focus(); await expect(panel.getByRole("button", { name: "XLK", exact: true })).toBeInViewport();
  const box = (await panel.boundingBox())!; expect(box.width).toBeLessThanOrEqual(390); expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
