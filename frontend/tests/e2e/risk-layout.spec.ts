import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const sectorName = "International information technology and decentralised financial infrastructure";
const scenarioName = "Worldwide funding and cross-market liquidity disruption with persistent risk repricing";
const description = "A long retained scenario description covering cross-market shocks and explicitly hypothetical outcomes for the current portfolio.";
const factors = ["market","size","value","momentum","quality","low_vol"];
async function fixture(page: Page) {
  const state = { failed: [] as string[], partial: false, empty: false, waitTicker: "", releaseTicker: null as null | (() => void), waitPeriod: "", releasePeriod: null as null | (() => void), pauseRun: false, releaseRun: null as null | (() => void), failMC: false, failHistory: false, reads: [] as string[], posts: [] as { path: string; body: any }[] };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, key = path.split("/").pop() || "", ticker = url.searchParams.get("ticker") || "portfolio", period = url.searchParams.get("period") || "1Y";
    if (!path.includes("/risk/")) return route.fulfill({ json: { items: [], results: [], alerts: [] } });
    state.reads.push(`${key}:${ticker}:${period}`);
    if (state.failed.includes(key)) return route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER" } });
    if (key === "summary") { if (ticker === state.waitTicker) await new Promise<void>(resolve => { state.releaseTicker = resolve; }); return route.fulfill({ json: { ewma_vol: ticker === "NVDA" ? .25 : ticker === "MSFT" ? .99 : 0, beta: state.partial ? null : 1.2, marginal_contribution: state.empty ? {} : { "BTC-USD": 0, "INTERNATIONAL-LONG-LISTING-SYMBOL.DE": .02, ...Object.fromEntries(Array.from({ length: 12 }, (_,i) => [`ASSET${i}`, .001*i])) } } }); }
    if (key === "exposures") return route.fulfill({ json: { pca_factors: state.empty ? [] : [{ factor: "PC1", variance_explained: .7 }, { factor: "PC2", variance_explained: .3 }] } });
    if (key === "correlation") return route.fulfill({ json: { assets: state.empty ? [] : ["BTC-USD","SAP.DE"], matrix: [[1,null],[0,1]] } });
    if (key === "sector-concentration") return route.fulfill({ json: { sectors: state.empty ? {} : { [sectorName]: 75, Other: 25 } } });
    if (key === "factor-exposures") return route.fulfill({ json: { exposures: state.empty ? {} : Object.fromEntries(factors.map((key,i) => [key,{ exposure: state.partial && key === "size" ? null : i*.1, t_stat: i, confidence: state.partial ? null : .8 }])) } });
    if (key === "factor-attribution") { if (period === state.waitPeriod) await new Promise<void>(resolve => { state.releasePeriod = resolve; }); return route.fulfill({ json: state.empty ? {} : { factor_contributions: Object.fromEntries(factors.map((key,i) => [key, state.partial && key === "size" ? null : i*.01])), alpha: .01, total_return: period === "3Y" ? .3 : period === "6M" ? .99 : .16, r_squared: .75 } }); }
    if (key === "factor-history") return route.fulfill({ json: { series: state.empty ? {} : Object.fromEntries(factors.map((key,i) => [key,[{ date: "2026-11-01", exposure: i*.1 }, { date: "2026-11-02", exposure: i*.2 }]])) } });
    if (key === "factor-returns") return route.fulfill({ json: { factors: state.empty ? {} : { market: [{ date: "2026-11-01", return: 0 }, { date: "2026-11-02", return: .1 }] } } });
    if (key === "predefined") return route.fulfill({ json: state.empty ? [] : [{ id: "gfc_2008", name: scenarioName, description, severity: "extreme", shocks: { equity: -.2, rates: .01 } }] });
    if (key === "history") return route.fulfill(state.failHistory ? { status: 503, json: {} } : { json: state.posts.some(post => post.path.endsWith("/run")) ? [{ id: "run1", run_date: "2026-11-25T12:00:00Z", scenario_name: scenarioName, total_impact_pct: -.2 }] : [] });
    if (["run","monte-carlo"].includes(key)) state.posts.push({ path, body: route.request().postDataJSON() });
    if (key === "run") { if (state.pauseRun) await new Promise<void>(resolve => { state.releaseRun = resolve; }); const holding = { symbol: "BTC-USD", sector: sectorName, weight: 1, current_value: 5000, impact_pct: -.2, impact_value: -1000, new_value: 4000 }; return route.fulfill({ json: { scenario_name: route.request().postDataJSON().custom_shocks ? "Custom Scenario" : scenarioName, total_impact_pct: -.2, total_impact_value: -1000, by_holding: [holding], by_sector: [{ sector: sectorName, weight: 1, impact_pct: -.2, impact_value: -1000 }], worst_holdings: [holding] } }); }
    if (key === "monte-carlo") return route.fulfill(state.failMC ? { status: 503, json: { detail: "PRIVATE_SIMULATION" } } : { json: { percentiles: { p5: -.2, p25: -.1, p50: 0, p75: .1, p95: .2 }, worst_case: -.3, best_case: .3, paths: [[0,.1,.2],[0,0,0],[0,-.1,-.2]] } });
    return route.fulfill({ json: {} });
  }); return state;
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Risk workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke Risk overview, factors and captured stress results stay readable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/risk"); const main = page.getByRole("main", { name: "Risk workspace", exact: true });
  await expect(main.getByRole("heading", { name: "Risk analytics", exact: true })).toHaveCSS("font-size", "18px");
  await expect(main.getByRole("region", { name: "Reported classification values", exact: true }).getByText(sectorName, { exact: true })).toBeVisible();
  const matrix = main.getByRole("region", { name: "Risk correlation matrix", exact: true }); await expect(matrix.getByText("Unavailable", { exact: true })).toBeVisible(); await expect(matrix.getByText("0.00", { exact: true })).toBeVisible(); const contributions = main.getByRole("region", { name: "Marginal risk contributions", exact: true }); await contributions.focus(); await contributions.press("ArrowDown"); await expect.poll(() => contributions.evaluate(el => el.scrollTop)).toBeGreaterThan(0); await main.getByRole("heading", { name: "Risk analytics", exact: true }).evaluate(el => el.scrollIntoView({ block: "start" })); await bounded(page); await page.screenshot({ path: info.outputPath("risk-overview.png"), fullPage: true, animations: "disabled" });
  await main.getByRole("button", { name: "Factor attribution", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(main.getByTestId("factor-exposure-chart")).toBeVisible(); await expect(main.getByTestId("factor-waterfall-chart")).toBeVisible(); await expect(main.getByText("Current positioning: Mid / Blend", { exact: true })).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("risk-factor-loadings.png"), fullPage: true, animations: "disabled" });
  await main.getByRole("checkbox", { name: "Market", exact: true }).uncheck(); await expect(main.getByRole("checkbox", { name: "Market", exact: true })).not.toBeChecked(); await main.getByText("Exact rolling values", { exact: true }).click(); const rolling = main.getByRole("region", { name: "Rolling exposure values", exact: true }); await rolling.focus(); await expect(rolling).toBeFocused(); if (width === 390) { await rolling.press("ArrowRight"); await expect.poll(() => rolling.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); await page.screenshot({ path: info.outputPath("risk-factors.png"), fullPage: true, animations: "disabled" });
  await main.getByRole("button", { name: "Stress test", exact: true }).click(); const setup = main.getByRole("form", { name: "Stress scenario setup", exact: true }); await expect(setup.getByText(description, { exact: true })).toBeVisible(); await main.getByText("Scenario library and assumptions", { exact: true }).click(); await expect(main.getByRole("heading", { name: scenarioName, exact: true })).toBeVisible(); await bounded(page); await main.getByText("Scenario library and assumptions", { exact: true }).click();
  await main.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("custom"); await main.getByRole("slider", { name: "Interest Rates shock", exact: true }).focus(); await page.keyboard.press("ArrowRight"); await expect(main.getByRole("slider", { name: "Interest Rates shock", exact: true })).toHaveValue("25"); await bounded(page); await page.screenshot({ path: info.outputPath("risk-setup.png"), fullPage: true, animations: "disabled" });
  await main.getByRole("button", { name: "Run scenario", exact: true }).click(); await expect(main.getByRole("heading", { name: "Scenario impact", exact: true })).toBeVisible(); await expect(main.getByRole("img", { name: "Monte Carlo fan chart", exact: true })).toBeVisible(); expect(state.posts.find(post => post.path.endsWith("/run"))?.body).toEqual({ portfolio_id: "current", custom_shocks: { equity: -.2, rates: .0025, volatility: .1, fx_inr: 0, gold: 0, crude_oil: 0 } });
  await expect(main.getByRole("img", { name: "Holding impact chart", exact: true }).getByText("0%", { exact: true })).toBeVisible();
  await main.getByRole("heading", { name: "Scenario impact", exact: true }).evaluate(el => el.scrollIntoView({ block: "start" })); await page.screenshot({ path: info.outputPath("risk-impact.png"), fullPage: true, animations: "disabled" });
  await main.getByText("All holding impacts", { exact: true }).click(); const holdings = main.getByRole("region", { name: "Stress holding impacts", exact: true }); await holdings.focus(); await expect(holdings).toBeFocused(); await main.getByText("Service run history", { exact: true }).click(); await expect(main.getByRole("region", { name: "Stress run history", exact: true })).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("risk-results.png"), fullPage: true, animations: "disabled" });
  expect(state.posts.filter(post => post.path.endsWith("/run"))).toHaveLength(1); expect(errors).toEqual([]);
});
test("@smoke Risk scoped drafts, independent refresh, partial factors and late period responses", async ({ page }) => {
  const state = await fixture(page); state.partial = true; state.failed = ["exposures"]; await page.goto("/equity/risk"); const main = page.getByRole("main", { name: "Risk workspace", exact: true }); await expect(main.getByRole("region", { name: "PCA factor exposures", exact: true }).getByRole("alert")).toBeVisible(); await expect(main.getByRole("region", { name: "Statistical risk metrics", exact: true }).getByText("0.00%", { exact: true })).toBeVisible(); state.failed = []; await main.getByRole("button", { name: "Refresh PCA factor exposures", exact: true }).click(); await expect(main.getByRole("region", { name: "PCA variance values", exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "Risk scope", exact: true }).selectOption("ticker"); state.waitTicker = "MSFT"; const input = main.getByRole("textbox", { name: "Risk ticker", exact: true }); await input.fill("MSFT"); expect(state.reads.some(read => read.startsWith("summary:MSFT:"))).toBe(false); await input.press("Enter"); await expect.poll(() => Boolean(state.releaseTicker)).toBe(true); await input.fill("NVDA"); await input.press("Enter"); await expect(main.getByRole("region", { name: "Statistical risk metrics", exact: true }).getByText("25.00%", { exact: true })).toBeVisible(); state.releaseTicker?.(); await expect(main.getByText("99.00%", { exact: true })).toHaveCount(0); await page.getByRole("button", { name: /show context rail/i }).click(); await expect(page.getByText("Reference scope: AAPL and peers. Page analysis has its own applied scope.", { exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Shared ticker PCA", exact: true })).toBeVisible(); await page.getByRole("button", { name: /hide context rail/i }).click();
  await main.getByRole("button", { name: "Factor attribution", exact: true }).click(); await expect(main.getByText(/Style unavailable/)).toBeVisible(); await expect(main.getByText(/Attribution is incomplete/)).toBeVisible(); state.partial = false; state.waitPeriod = "6M";
  const period = main.getByRole("combobox", { name: "Attribution and history period", exact: true }); await period.selectOption("6M"); await expect.poll(() => Boolean(state.releasePeriod)).toBe(true); await period.selectOption("3Y"); await expect(main.getByRole("region", { name: "Factor return contributions", exact: true }).getByRole("cell", { name: "+30.00%", exact: true })).toBeVisible(); state.releasePeriod?.(); await expect(main.getByText("+99.00%", { exact: true })).toHaveCount(0); expect(state.reads.filter(read => read.startsWith("factor-exposures:"))).toHaveLength(1); await bounded(page);
});
test("@smoke Captured stress runs lock setup and keep confirmed impacts through simulation/history failure", async ({ page }) => {
  const state = await fixture(page); state.pauseRun = true; state.failMC = true; await page.goto("/equity/risk"); const main = page.getByRole("main", { name: "Risk workspace", exact: true }); await main.getByRole("button", { name: "Stress test", exact: true }).click(); await expect(main.getByRole("form", { name: "Stress scenario setup", exact: true }).getByText(description, { exact: true })).toBeVisible(); await main.getByRole("button", { name: "Run scenario", exact: true }).click(); await expect.poll(() => Boolean(state.releaseRun)).toBe(true); await expect(main.getByRole("combobox", { name: "Scenario", exact: true })).toBeDisabled(); await expect(main.getByRole("button", { name: "Overview", exact: true })).toBeDisabled(); state.failHistory = true; state.releaseRun?.(); await expect(main.getByRole("heading", { name: "Scenario impact", exact: true })).toBeVisible(); await expect(main.getByText(/Simulation unavailable/)).toBeVisible(); await main.getByText("Service run history", { exact: true }).click(); await expect(main.getByRole("region", { name: "Run history", exact: true }).getByRole("alert")).toBeVisible(); expect(state.posts.filter(post => post.path.endsWith("/run"))).toHaveLength(1); await main.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("custom"); await expect(main.getByRole("heading", { name: `Captured run · ${scenarioName}`, exact: true })).toBeVisible(); await expect(main.getByText(/PRIVATE_/)).toHaveCount(0);
});
test("@smoke Risk views reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "risk-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "risk-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/risk`);
    for (const view of ["Overview", "Factor attribution", "Stress test"]) { await page.getByRole("button", { name: view, exact: true }).click(); if (view === "Overview") await expect(page.getByRole("region", { name: "PCA variance values", exact: true })).toBeVisible(); if (view === "Factor attribution") await expect(page.getByTestId("factor-style-box")).toBeVisible(); if (view === "Stress test") { await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("custom"); await page.getByRole("button", { name: "Run scenario", exact: true }).click(); await expect(page.getByRole("heading", { name: "Scenario impact", exact: true })).toBeVisible(); } await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" }); // Capture the real Chrome surface: fullPage clips CSS dimensions at native zoom.
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const table = page.getByRole("region", { name: "Stress sector impacts", exact: true });
    await table.scrollIntoViewIfNeeded(); await table.focus(); await expect(table).toBeFocused();
    await table.getByText(sectorName, { exact: true }).scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(info.outputPath("risk-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});
