import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const methodLabel = "ARIMA model with a deliberately long readable forecasting method and configuration name";
const longName = "International enterprise technology and worldwide financial infrastructure research holding company";
const interpretation = "Returned model interpretation with a full readable explanation. These synthetic observations do not establish future outcomes or real-world causation.";
const tools = ["forecast","coint","stationarity","decomposition","regression","autocorr","causality","regimes"];
const dates = ["2026-11-16","2026-11-17","2026-11-18"];
async function fixture(page: Page) {
 const state = { failed: [] as string[], emptyMethods: false, empty: false, partial: false, holdTicker: "", release: null as null | (() => void), requests: [] as { tool: string; body: any }[] };
 await page.context().routeWebSocket("**/*", socket => socket.close());
 await page.context().route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname, tool = path.split("/").pop() || "";
  if (!path.includes("/statlab/")) return route.fulfill({ json: { items: [],results: [],alerts: [] } });
  if (tool !== "methods") state.requests.push({ tool, body: route.request().postDataJSON() });
  if (state.failed.includes(tool)) return route.fulfill({ status: 503, json: { detail: "PRIVATE_MODEL_CONTEXT" } });
  if (tool === "methods") return route.fulfill({ json: { forecast_methods: state.emptyMethods ? [] : [{ id: "arima",label: methodLabel },{ id: "ets",label: "Exponential smoothing" }] } });
  const body = route.request().postDataJSON(); if (body.ticker === state.holdTicker) await new Promise<void>(resolve => { state.release = resolve; });
  if (state.empty) return route.fulfill({ json: {} });
  let result: any;
  if (tool === "forecast") result = { ticker: body.ticker,method: body.method,history: dates.map((date,i) => ({ date,value: 100+i })),forecast: ["2026-11-19","2026-11-20","2026-11-23"].map((date,i) => ({ date,mean: 103+i,lower: 98+i,upper: 108+i })),model: { order: "ARIMA(1,1,1) with returned model metadata",aic: state.partial ? null : 0 },metrics: { rmse_in_sample: 0 } };
  if (tool === "cointegration") result = { ticker_a: body.ticker_a,ticker_b: body.ticker_b,coint_pvalue: .02,is_cointegrated: true,hedge_ratio: 1.2,half_life: 10,current_z: 0,correlation: .5,signal: "NO_SIGNAL",series: dates.map((date,i) => ({ date,spread: 1+i*.1,zscore: [0,.5,-.5][i] })) };
  if (tool === "stationarity") result = { ticker: body.ticker,hurst: state.partial ? null : .4,adf: { stat: 0,pvalue: state.partial ? null : .01,is_stationary: state.partial ? null : true },kpss: { stat: .1,pvalue: .1,is_stationary: true },returns_adf: { stat: -3,pvalue: .001,is_stationary: true },interpretation };
  if (tool === "regression") result = { ticker: body.ticker,benchmark_ticker: body.benchmark,asset: longName,benchmark: "Broad global market benchmark with a full descriptive name",alpha_daily: 0,alpha_annual: 0,beta: 1.2,r_squared: .75,correlation: .6,tracking_error: .1,information_ratio: .5,alpha_tstat: 0,alpha_pvalue: .5,beta_tstat: 5,beta_pvalue: .001,n_obs: 100,rolling_window: body.rolling_window,rolling_beta: dates.map((date,i) => ({ date,beta: .9+i*.1 })),scatter: [-.02,0,.02].map(x => ({ x,y: x*1.2 })),fit_line: [-.02,.02].map(x => ({ x,y: x*1.2 })),interpretation };
  if (tool === "autocorrelation") result = { ticker: body.ticker,use_returns: body.use_returns,n_obs: 100,conf_band: .2,acf: [1,.5,0].map((value,lag) => ({ lag,value,significant: lag < 2 })),pacf: [1,.3,0].map((value,lag) => ({ lag,value,significant: lag < 2 })),ljung_box: [{ lag: 5,stat: 10,pvalue: .03,has_autocorr: true }],interpretation };
  if (tool === "causality") result = { ticker_a: body.ticker_a,ticker_b: body.ticker_b,name_a: longName,name_b: "Another worldwide research and technology company",max_lag: body.max_lag,n_obs: 100,a_to_b: { best_lag: 1,min_pvalue: .01,significant: true,curve: [.01,.05,.2].map((pvalue,i) => ({ lag: i+1,pvalue })) },b_to_a: { best_lag: 1,min_pvalue: .2,significant: false,curve: [.2,.3,.4].map((pvalue,i) => ({ lag: i+1,pvalue })) },lead: "First series predictively leads second",interpretation };
  if (tool === "regimes") result = { ticker: body.ticker,k_regimes: 2,n_obs: 100,current_regime: "LOW-VOL",current_high_vol_prob: 0,high_vol_regime: { label: "HIGH-VOL",ann_vol_pct: 25,mean: -.01,vol: .05,share: .2 },low_vol_regime: { label: "LOW-VOL",ann_vol_pct: 10,mean: .01,vol: .02,share: .8 },series: dates.map((date,i) => ({ date,high_vol_prob: [.8,.3,0][i] })),interpretation };
  return route.fulfill({ json: result || {} });
 }); return state;
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Statistical Lab workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke Statistical Lab seven retained analyses and unavailable decomposition at ${width}px`, async ({ page }, info) => {
 await page.setViewportSize({ width,height: 1000 }); const state = await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
 if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
 await page.goto("/equity/stat-lab"); const main = page.getByRole("main", { name: "Statistical Lab workspace", exact: true }), selector = main.getByRole("combobox", { name: "Analysis", exact: true }), result = main.getByRole("region", { name: "Statistical analysis result", exact: true });
 await expect(main.getByRole("heading", { name: "Statistical Lab", exact: true })).toHaveCSS("font-size","18px"); await expect(main.getByRole("button", { name: "Run analysis", exact: true })).toBeEnabled(); expect(state.requests).toHaveLength(0); await page.screenshot({ path: info.outputPath("statlab-inputs.png"), fullPage: true, animations: "disabled" });
 for (const tool of tools) {
  await selector.selectOption(tool);
  if (tool === "decomposition") { await expect(main.getByRole("region", { name: "Decomposition availability", exact: true })).toBeVisible(); await expect(main.getByRole("button", { name: "Run analysis", exact: true })).toHaveCount(0); await bounded(page); continue; }
  if (tool === "forecast") await expect(main.getByText(`${methodLabel} · horizon counts model steps; date/calendar semantics depend on the service.`, { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Run analysis", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(result).toHaveAttribute("aria-busy","false"); await expect(result).toBeFocused();
  if (tool === "forecast") { const plot = result.getByRole("img", { name: "History and forecast chart", exact: true }); await expect(plot).toBeVisible(); await expect(plot.locator("path.recharts-line-curve")).toHaveCount(2); await result.getByText("Exact forecast values", { exact: true }).click(); }
  if (tool === "coint") { await expect(result.getByRole("img", { name: "Cointegration spread z-score chart", exact: true }).locator("path.recharts-line-curve")).toHaveCount(1); await result.getByText("Exact spread values", { exact: true }).click(); }
  if (tool === "stationarity") { const table = result.getByRole("region", { name: "Stationarity test results", exact: true }); await table.focus(); await expect(table).toBeFocused(); if (width === 390) { await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } }
  if (tool === "regression") { await expect(result.getByText(longName, { exact: true })).toBeVisible(); const plot = result.getByRole("img", { name: "Regression returns and fitted line chart", exact: true }); await expect(plot.locator(".recharts-scatter-line path")).toHaveCount(1); await result.getByText("Exact fitted line values", { exact: true }).click(); }
  if (tool === "autocorr") { await expect(result.getByRole("img", { name: "ACF chart", exact: true })).toBeVisible(); await result.getByText("Exact ACF values", { exact: true }).click(); await expect(result.getByRole("region", { name: "Ljung-Box results", exact: true })).toBeVisible(); }
  if (tool === "causality") { await expect(result.getByRole("img", { name: "Granger p-values chart", exact: true }).locator("path.recharts-line-curve")).toHaveCount(2); await expect(result.getByRole("region", { name: "Granger directional results", exact: true })).toContainText(longName); }
  if (tool === "regimes") { await expect(result.getByRole("img", { name: "High-volatility probability chart", exact: true })).toBeVisible(); await expect(result.locator("dd").filter({ hasText: /^0%$/ })).toBeVisible(); }
  await bounded(page);
  if (tool !== "stationarity") { const plot = tool === "regression" ? result.getByRole("img", { name: "Regression returns and fitted line chart", exact: true }) : result.getByRole("img").first(); await plot.scrollIntoViewIfNeeded(); }
  await page.screenshot({ path: info.outputPath(`statlab-${tool}.png`),fullPage: true,animations: "disabled" });
 }
 expect(state.requests.map(request => request.tool)).toEqual(["forecast","cointegration","stationarity","regression","autocorrelation","causality","regimes"]); expect(state.requests[0].body).toEqual({ ticker: "AAPL",method: "arima",horizon: 30 }); expect(errors).toEqual([]);
});
test("@smoke Stat Lab retains captured scope, failed drafts and inactive completions", async ({ page }) => {
 const state = await fixture(page); await page.goto("/equity/stat-lab"); const main = page.getByRole("main", { name: "Statistical Lab workspace", exact: true }), selector = main.getByRole("combobox", { name: "Analysis", exact: true }), result = main.getByRole("region", { name: "Statistical analysis result", exact: true });
 const ticker = main.getByRole("textbox", { name: "Forecast symbol", exact: true }); await ticker.fill(" sap.de "); await expect(main.getByRole("button", { name: "Run analysis", exact: true })).toBeEnabled(); await ticker.press("Enter"); await expect(result.getByRole("img", { name: "History and forecast chart", exact: true })).toBeVisible(); await ticker.fill("BTC-USD"); await expect(result.getByText(/Inputs have changed/)).toBeVisible(); await expect(result).toContainText("SAP.DE"); state.failed = ["forecast"];
 await main.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect(result.getByRole("alert")).toContainText("No previous result"); await expect(result.getByRole("img")).toHaveCount(0); await expect(ticker).toHaveValue("BTC-USD"); state.failed = []; state.holdTicker = "SLOW"; await ticker.fill("SLOW"); await main.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect.poll(() => Boolean(state.release)).toBe(true); await expect(ticker).toBeDisabled(); await selector.selectOption("stationarity"); const statTicker = main.getByRole("textbox", { name: "Stationarity symbol", exact: true }); await statTicker.fill("NVDA"); await statTicker.focus(); state.release?.(); await expect(statTicker).toBeFocused(); await expect(result.getByRole("img", { name: "History and forecast chart", exact: true })).toHaveCount(0);
 await selector.selectOption("forecast"); await expect(result.getByRole("img", { name: "History and forecast chart", exact: true })).toBeVisible(); await expect(result).toContainText("SLOW"); expect(state.requests.filter(request => request.tool === "forecast")).toHaveLength(3); await expect(main.getByText(/PRIVATE_/)).toHaveCount(0);
});
test("@smoke Stat Lab method failures, partial values, empty results and unavailable tools are explicit", async ({ page }) => {
 const state = await fixture(page); state.failed = ["methods"]; await page.goto("/equity/stat-lab"); const main = page.getByRole("main", { name: "Statistical Lab workspace", exact: true }), result = main.getByRole("region", { name: "Statistical analysis result", exact: true }); await expect(main.getByText(/Could not load forecast methods/)).toBeVisible(); await expect(main.getByRole("button", { name: "Run analysis", exact: true })).toBeDisabled(); state.failed = []; state.emptyMethods = true; await main.getByRole("button", { name: "Refresh methods", exact: true }).click(); await expect(main.getByText("No forecast methods returned.", { exact: true })).toBeVisible(); state.emptyMethods = false; state.partial = true; await main.getByRole("button", { name: "Refresh methods", exact: true }).click(); await expect(main.getByRole("button", { name: "Run analysis", exact: true })).toBeEnabled(); await main.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect(result.getByText("Unavailable", { exact: true })).toBeVisible(); await expect(result.getByText("0.0000", { exact: true })).toBeVisible(); state.empty = true; await main.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect(result.getByText("No analysis values returned.", { exact: true })).toBeVisible(); await expect(result.getByRole("img")).toHaveCount(0); await main.getByRole("combobox", { name: "Analysis", exact: true }).selectOption("decomposition"); await expect(main.getByRole("region", { name: "Decomposition availability", exact: true })).toBeVisible(); expect(state.requests.every(request => request.tool === "forecast")).toBe(true); await bounded(page);
});
test("@smoke Stat Lab analyses reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "statlab-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "statlab-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/stat-lab`);
    for (const tool of ["forecast","coint","stationarity","regression","autocorr","causality","regimes"]) { await page.getByRole("combobox", { name: "Analysis", exact: true }).selectOption(tool); await expect(page.getByRole("button", { name: "Run analysis", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Run analysis", exact: true }).click(); await expect(page.getByRole("region", { name: "Statistical analysis result", exact: true })).toHaveAttribute("aria-busy", "false"); await expect(page.getByRole("region", { name: "Statistical analysis result", exact: true })).toBeFocused(); await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" }); // Capture the real Chrome surface: fullPage clips CSS dimensions at native zoom.
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const table = page.getByRole("region", { name: "Regime parameters", exact: true }); await table.focus(); await expect(table).toBeFocused(); await table.getByRole("rowheader", { name: "LOW-VOL", exact: true }).scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(info.outputPath("statlab-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});
