import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const company = "International Semiconductor Infrastructure and Advanced Computing Holdings";
const sector = "Information technology infrastructure and communication services";
const presetName = "Quality compounders with resilient balance sheets and long-term earnings growth";
const why = "Strong supplied quality and value scores explain this rank, while the complete explanation remains readable in the table and selected company view.";
const rows = [
  { ticker: "AAPL", company, sector, market: "US", currency: "USD", market_cap: 3000000000000, pe: 25, roe: 30, roce: 20, composite_score: 88, factor_chips: ["QUALITY", "VALUE"], why_ranked: why, scores: { quality_score: { value: 80 }, unusually_long_fundamental_metric_name: { value: 70 } }, sparkline_price_1y: [100, 110, 105, 120] },
  { ticker: "MSFT", company: "Microsoft", sector: "Technology", market: "US", market_cap: 2000000000000, pe: 30, roe: 20, roce: 15, composite_score: 75 },
];
async function fixture(page: Page) {
  const state = { mode: "valid", runs: [] as any[], scans: [] as any[] };
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/screener/presets") return route.fulfill({ json: { items: [{ id: "quality-long", name: presetName, category: "quality", description: why, query: "ROE > 15 AND PE < 30" }] } });
    if (path === "/api/screener/run-revamped") {
      state.runs.push(route.request().postDataJSON());
      if (state.mode === "failed") return route.fulfill({ status: 503, json: { detail: "Screen provider unavailable" } });
      return route.fulfill({ json: { results: state.mode === "empty" ? [] : rows, total_results: state.mode === "empty" ? 0 : 2, execution_time_ms: 12, viz_data: {} } });
    }
    if (path === "/api/screener/scan") { state.scans.push(route.request().postDataJSON()); return route.fulfill({ json: { rows: [{ symbol: "AAPL", company_name: company, exchange: "NASDAQ", market_cap: 3000000000000, pe_ratio: 25, roe: 30 }] } }); }
    if (path === "/api/screener/saved-formulas") return route.fulfill({ json: [] });
    if (path === "/api/watchlist/items") return route.fulfill({ json: { status: "ok" } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const main = page.getByRole("main", { name: "Screener research", exact: true });
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await main.locator("input, select, textarea").evaluateAll(els => els.filter(el => el.getClientRects().length).every(el => el.getBoundingClientRect().right <= innerWidth + 1 && parseFloat(getComputedStyle(el).fontSize) >= 14))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Screener gives results useful space and readable query/detail controls at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/equity/screener");
    const main = page.getByRole("main", { name: "Screener research", exact: true });
    await expect(main.getByRole("textbox", { name: "Screen query", exact: true })).toHaveValue("ROE > 15 AND PE < 30");
    await expect(main.getByText("Run a screen to see results.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("screener-initial.png"), fullPage: true });
    expect((await main.getByText("Run a screen to see results.", { exact: true }).boundingBox())!.y).toBeLessThan(950);
    await main.getByRole("button", { name: "Run Active", exact: true }).click();
    const results = main.getByRole("region", { name: "Screen results", exact: true });
    await expect(results.getByText(company, { exact: true })).toBeVisible();
    expect(state.runs[0]).toMatchObject({ preset_id: "quality-long", query: "ROE > 15 AND PE < 30" });
    const table = results.getByRole("region", { name: "Data table", exact: true });
    expect((await table.boundingBox())!.width).toBeGreaterThan((await results.boundingBox())!.width * 0.9);
    expect(await table.getByRole("columnheader").evaluateAll(els => els.every(el => el.getBoundingClientRect().height < 70))).toBe(true);
    expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(table.getByText(why, { exact: true })).toHaveCSS("text-overflow", "clip");
    await bounded(page); await results.evaluate(el => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: testInfo.outputPath("screener-results.png"), fullPage: true });
    await table.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home");
    await main.getByRole("link", { name: "Inspect selected company", exact: true }).click();
    const detail = main.getByRole("region", { name: "Selected company", exact: true });
    await expect(detail).toBeFocused(); await expect(detail).toContainText(company); await expect(detail).toContainText(why);
    await expect(detail.getByRole("button", { name: "Open Chart", exact: true })).toBeVisible(); await bounded(page);
    await detail.evaluate(el => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: testInfo.outputPath("screener-company.png"), fullPage: true });
    await detail.getByRole("button", { name: "Close", exact: true }).click(); await expect(results).toBeFocused(); await expect(detail).toHaveCount(0);
    await main.getByText("Preset library · browse and run a screen", { exact: true }).click();
    const search = main.getByRole("combobox", { name: "Search presets", exact: true }); await search.fill("compounders");
    await main.getByRole("listbox").getByRole("option").first().click(); await expect.poll(() => state.runs.length).toBe(2);
    await main.getByText("Preset library · browse and run a screen", { exact: true }).click();
    if (width < 640) await main.getByRole("combobox", { name: "Screen source", exact: true }).selectOption("custom");
    else await main.getByRole("button", { name: "Custom Query", exact: true }).click();
    await expect(main.getByRole("combobox", { name: "Field 1", exact: true })).toBeVisible(); await main.getByRole("combobox", { name: "Field 1", exact: true }).selectOption("ROE");
    await main.getByRole("textbox", { name: "Value 1", exact: true }).fill("22");
    await expect(main.getByRole("textbox", { name: "Screen query", exact: true })).toHaveValue("ROE > 22");
    await bounded(page); await main.getByRole("region", { name: "Query construction", exact: true }).evaluate(el => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: testInfo.outputPath("screener-query.png"), fullPage: true });
    if (width < 640) await main.getByRole("combobox", { name: "Screen source", exact: true }).selectOption("formula");
    else await main.getByRole("button", { name: "Custom Formula", exact: true }).click();
    await expect(main.getByRole("textbox", { name: "Arithmetic formula", exact: true })).toBeVisible(); await expect(main.getByRole("combobox", { name: "Formula universe", exact: true })).toBeVisible(); await bounded(page);
    await main.getByText("Multi-market scan · separate filters and results", { exact: true }).click();
    await expect(main.getByLabel("Minimum market cap", { exact: true })).toHaveValue("1000000000");
    await main.getByRole("button", { name: "Run Scan", exact: true }).click();
    await expect.poll(() => state.scans.length).toBe(1); await expect(main.getByText("Loaded 1 scan results", { exact: true })).toBeVisible(); await bounded(page);
    expect(errors).toEqual([]);
  });
}
test("@smoke Screener distinguishes empty results and failed refreshes from a successful screen", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/screener");
  const main = page.getByRole("main", { name: "Screener research", exact: true });
  await expect(main.getByRole("textbox", { name: "Screen query", exact: true })).toHaveValue("ROE > 15 AND PE < 30");
  await main.getByRole("button", { name: "Run Active", exact: true }).click(); await expect(main.getByRole("region", { name: "Selected company", exact: true })).toBeVisible();
  state.mode = "failed"; await main.getByRole("button", { name: "Run Active", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Previous results remain below; they were not refreshed.");
  state.mode = "empty"; await main.getByRole("button", { name: "Run Active", exact: true }).click();
  await expect(main.getByText("No companies match this screen.", { exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "Selected company", exact: true })).toHaveCount(0); await expect(main.getByRole("alert")).toHaveCount(0);
});
test("@smoke Screener query and selected-company reading reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "screener-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "screener-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/screener`);
    const main = page.getByRole("main", { name: "Screener research", exact: true }); await expect(main.getByRole("textbox", { name: "Screen query", exact: true })).toHaveValue("ROE > 15 AND PE < 30");
    await main.getByRole("button", { name: "Run Active", exact: true }).click(); await main.getByRole("link", { name: "Inspect selected company", exact: true }).click();
    await expect(main.getByRole("region", { name: "Selected company", exact: true })).toContainText(company);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale }));
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await bounded(page);
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("screener-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
