import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const views = ["Pair test","Spread and z-score","Backtest","Scan"];
const basket = ["VOO","SPY","KO","PEP","XOM","CVX","GLD","IAU"];
const verdict = "The reported cointegration result includes a deliberately long explanation about the tested historical observations and model limitations; this is synthetic reading evidence, not a forecast or trading recommendation.";
async function fixture(page: Page) {
 const state = { failed: false,empty: false,partial: false,emptyScan: false,holdSymbol: "",release: null as null | (() => void),requests: [] as { operation: string;body: any }[] };
 await page.context().routeWebSocket("**/*", socket => socket.close());
 await page.context().route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (!path.includes("/pairs/")) return route.fulfill({ json: { items: [],results: [],alerts: [] } });
  const operation = path.split("/").pop()!, body = route.request().postDataJSON(); state.requests.push({ operation,body });
  if (body.symbol1 === state.holdSymbol) await new Promise<void>(resolve => { state.release = resolve; });
  if (state.failed) return route.fulfill({ status: 503,json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
  if (state.empty) return route.fulfill({ json: {} });
  const pair = { symbol1: body.symbol1,symbol2: body.symbol2,beta: state.partial ? null : 1.1,entry_z: body.entry_z,exit_z: body.exit_z };
  const dates = ["2026-11-20","2026-11-23","2026-11-24","2026-11-25"];
  if (operation === "test") return route.fulfill({ json: { ...pair,period: body.period,period_start: dates[0],period_end: dates[3],alpha: 0,adf_stat: -3,adf_pvalue: .02,coint_pvalue: 0,half_life: state.partial ? null : 12,zscore_current: 0,resid_mean: 0,resid_std: .1,cointegrated: state.partial ? null : true,verdict } });
  if (operation === "spread") return route.fulfill({ json: { ...pair,points: dates.map((date,i) => ({ date,price1: 100+i,price2: 90+i,hedged: 99+i,spread: [1,2,-1,0][i],zscore: [null,1,-1,0][i] })) } });
  if (operation === "signals") return route.fulfill({ json: { ...pair,equity: dates.map((date,i) => ({ date,equity: [1,1.02,null,.99][i],position: [0,-1,-1,0][i],zscore: [null,1,-1,0][i] })),stats: { trades: 0,win_rate: 0,sharpe: state.partial ? null : 0,max_drawdown: -.03,total_return: -.01 } } });
  const results = basket.flatMap((symbol1,i) => basket.slice(i+1).map(symbol2 => ({ symbol1,symbol2,beta: 1.1,coint_pvalue: 0,adf_pvalue: .02,half_life: 10,zscore_current: 0,cointegrated: state.partial ? null : true })));
  return route.fulfill({ json: { period: body.period,results: state.emptyScan ? [] : results } });
 }); return state;
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Pair Trading workspace", exact: true }).evaluate(main => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility !== "visible") return false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          const summary = Array.from(parent.children).find(child => child.tagName === "SUMMARY");
          if (!summary?.contains(element)) return false;
        }
      }
      return true;
    };
    const measure = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName, left: rect.left, right: rect.right };
    };
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: main.clientWidth,
      mainScrollWidth: main.scrollWidth,
      controls: Array.from(main.querySelectorAll("input, select, button")).filter(element => !element.closest("table") && visible(element)).map(measure),
      regions: Array.from(main.querySelectorAll('[role="region"], section[aria-label], section[aria-labelledby]')).filter(visible).map(measure),
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.mainScrollWidth).toBeLessThanOrEqual(metrics.mainWidth + 1);
  expect(metrics.controls.length).toBeGreaterThan(0);
  for (const control of metrics.controls) {
    expect(control.left, control.name).toBeGreaterThanOrEqual(0);
    expect(control.right, control.name).toBeLessThanOrEqual(metrics.viewport + 1);
  }
  for (const region of metrics.regions) expect(region.right, region.name).toBeLessThanOrEqual(metrics.viewport + 1);
}

for (const width of [1440,1024,390]) test(`@smoke Pair Trading readable captured analyses and fixed-basket scan at ${width}px`, async ({ page }, info) => {
 await page.setViewportSize({ width,height: 1000 }); const state = await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
 if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
 await page.goto("/equity/pair-trading"); const main = page.getByRole("main", { name: "Pair Trading workspace",exact: true }),result = main.getByRole("region", { name: "Pair analysis result",exact: true });
 await expect(main.getByRole("heading", { name: "Pair Trading Lab",exact: true })).toHaveCSS("font-size","18px"); expect(state.requests).toHaveLength(0); await page.screenshot({ path: info.outputPath("pairs-inputs.png"),fullPage: true,animations: "disabled" });
 for (const [i,view] of views.entries()) {
  await main.getByRole("button", { name: view,exact: true }).click(); expect(state.requests).toHaveLength(i);
  if (view === "Spread and z-score") { await main.getByRole("spinbutton", { name: "Entry z-score",exact: true }).fill("2.25"); await main.getByRole("spinbutton", { name: "Exit z-score",exact: true }).fill("0.125"); await main.getByRole("spinbutton", { name: "Z-score window (observations)",exact: true }).fill("80"); await page.screenshot({ path: info.outputPath("pairs-thresholds.png"),fullPage: true,animations: "disabled" }); }
  if (view === "Scan") { await expect(main.getByRole("textbox")).toHaveCount(0); await expect(main.getByRole("spinbutton")).toHaveCount(0); await expect(main.getByText(`Fixed scan basket: ${basket.join(", ")}.`, { exact: true })).toBeVisible(); }
  const run = main.getByRole("button", { name: "Run analysis",exact: true }); await run.focus(); await page.keyboard.press("Enter"); await expect(result).toHaveAttribute("aria-busy","false"); await expect(result).toBeFocused();
  if (view === "Pair test") { await expect(result.getByRole("region", { name: "Cointegration verdict",exact: true })).toContainText(verdict); await result.locator("summary").filter({ hasText: "Additional pair estimates" }).click(); }
  if (view === "Spread and z-score") { await expect(result.getByRole("img", { name: "Pair spread chart",exact: true }).locator("path.recharts-line-curve")).toHaveCount(1); await expect(result.getByRole("img", { name: "Pair z-score chart",exact: true }).locator("path.recharts-line-curve")).toHaveCount(1); await expect(result.getByRole("img", { name: "Pair z-score chart",exact: true }).locator(".recharts-reference-line-line")).toHaveCount(5); await result.locator("summary").filter({ hasText: "Exact spread observations" }).click(); await expect(result.getByRole("region", { name: "Exact spread observations",exact: true })).toContainText("Unavailable"); await result.getByRole("img", { name: "Pair z-score chart",exact: true }).scrollIntoViewIfNeeded(); }
  if (view === "Backtest") { await expect(result.getByRole("img", { name: "Pair backtest equity chart",exact: true }).locator("path.recharts-line-curve")).toHaveCount(1); await result.locator("summary").filter({ hasText: "Exact backtest observations" }).click(); await expect(result.getByRole("region", { name: "Exact backtest observations",exact: true })).toContainText("Unavailable"); await result.getByRole("img", { name: "Pair backtest equity chart",exact: true }).scrollIntoViewIfNeeded(); }
  if (view === "Scan") { const table = result.getByRole("region", { name: "Pair scan results",exact: true }); await expect(table.getByRole("row")).toHaveCount(29); await table.focus(); await expect(table).toBeFocused(); await table.press("ArrowDown"); await expect.poll(() => table.evaluate(el => el.scrollTop)).toBeGreaterThan(0); if (width === 390) { await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await table.evaluate(el => el.scrollTo({ top: 0,left: 0,behavior: "instant" })); }
  await bounded(page); await page.screenshot({ path: info.outputPath(`pairs-${i}.png`),fullPage: true,animations: "disabled" });
 }
 expect(state.requests).toEqual([{ operation: "test",body: { symbol1: "VOO",symbol2: "SPY",period: "2Y" } },{ operation: "spread",body: { symbol1: "VOO",symbol2: "SPY",period: "2Y",zwindow: 80,entry_z: 2.25,exit_z: .125 } },{ operation: "signals",body: { symbol1: "VOO",symbol2: "SPY",period: "2Y",zwindow: 80,entry_z: 2.25,exit_z: .125 } },{ operation: "scan",body: { symbols: basket,period: "2Y" } }]); expect(errors).toEqual([]);
});
test("@smoke Pair Trading retains failed drafts and captured results across inactive completions", async ({ page }) => {
 const state = await fixture(page); await page.goto("/equity/pair-trading"); const main = page.getByRole("main", { name: "Pair Trading workspace",exact: true }),result = main.getByRole("region", { name: "Pair analysis result",exact: true }),ticker = main.getByRole("textbox", { name: "First pair symbol",exact: true });
 await ticker.fill(" sap.de "); await ticker.press("Enter"); await expect(result.getByRole("region", { name: "Cointegration verdict",exact: true })).toBeVisible(); await expect(ticker).toHaveValue("SAP.DE"); await ticker.fill("BTC-USD"); await expect(result).toContainText("SAP.DE"); await expect(result.getByText(/Inputs have changed/)).toBeVisible(); state.failed = true; await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect(result.getByRole("alert")).toContainText("No previous result"); await expect(result.getByRole("region", { name: "Cointegration verdict",exact: true })).toHaveCount(0); await expect(ticker).toHaveValue("BTC-USD"); state.failed = false;
 await main.getByRole("button", { name: "Spread and z-score",exact: true }).click(); state.holdSymbol = "SLOW"; await ticker.fill("SLOW"); await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect.poll(() => Boolean(state.release)).toBe(true); await expect(ticker).toBeDisabled(); await main.getByRole("button", { name: "Pair test",exact: true }).click(); await ticker.fill("NVDA"); await ticker.focus(); state.release?.(); await expect(ticker).toBeFocused(); await expect(result.getByRole("img")).toHaveCount(0); await main.getByRole("button", { name: "Spread and z-score",exact: true }).click(); await expect(result.getByRole("img", { name: "Pair spread chart",exact: true })).toBeVisible(); await expect(result).toContainText("SLOW"); await expect(ticker).toHaveValue("NVDA"); await expect(main.getByText(/PRIVATE_/)).toHaveCount(0); expect(state.requests).toHaveLength(3);
});
test("@smoke Pair Trading distinguishes partial, empty and missing scan values from zero", async ({ page }) => {
 const state = await fixture(page); state.partial = true; await page.goto("/equity/pair-trading"); const main = page.getByRole("main", { name: "Pair Trading workspace",exact: true }),result = main.getByRole("region", { name: "Pair analysis result",exact: true }); await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect(result.getByRole("region", { name: "Cointegration verdict",exact: true })).toContainText("Unavailable"); await expect(result.getByText("0.0000", { exact: true })).toBeVisible(); state.empty = true; await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect(result.getByText("No analysis values returned.", { exact: true })).toBeVisible(); await expect(result.getByRole("region", { name: "Cointegration verdict",exact: true })).toHaveCount(0); state.empty = false; state.emptyScan = true; await main.getByRole("button", { name: "Scan",exact: true }).click(); await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect(result.getByText("No rows returned.", { exact: true })).toBeVisible(); state.emptyScan = false; await main.getByRole("button", { name: "Run analysis",exact: true }).click(); await expect(result.getByRole("row")).toHaveCount(29); await expect(result.getByText("Unavailable", { exact: true })).toHaveCount(28); await bounded(page);
});
test("@smoke Pair Trading analyses reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "pairs-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "pairs-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/pair-trading`);
    for (const view of views) { await page.getByRole("button", { name: view, exact: true }).click(); await expect(page.getByRole("button", { name: "Run analysis", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect(page.getByRole("region", { name: "Pair analysis result", exact: true })).toHaveAttribute("aria-busy", "false"); await expect(page.getByRole("region", { name: "Pair analysis result", exact: true })).toBeFocused(); await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" }); // Capture the real Chrome surface: fullPage clips CSS dimensions at native zoom.
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const table = page.getByRole("region", { name: "Pair scan results", exact: true }); await table.focus(); await expect(table).toBeFocused(); await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); await table.press("ArrowDown"); await expect.poll(() => table.evaluate(el => el.scrollTop)).toBeGreaterThan(0); await table.evaluate(el => el.scrollTo({ top: 0,left: 0,behavior: "instant" })); await table.getByRole("rowheader", { name: "VOO", exact: true }).first().scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(info.outputPath("pairs-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});
