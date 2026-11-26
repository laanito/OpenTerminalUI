import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const companyName = "European enterprise software and worldwide information technology infrastructure company with a full readable native listing name";
const nativeSymbol = "LONG-INTERNATIONAL-NATIVE-LISTING-SYMBOL.DE";
async function fixture(page: Page) {
  const state = { failed: [] as string[], failPortfolio: false, portfolioCount: 1, empty: false, waitPeriod: "", releaseMatrix: null as null | (() => void), waitWindow: 0, releaseRolling: null as null | (() => void), waitSearch: "", releaseSearch: null as null | (() => void), requests: [] as { key: string; body: any }[], searches: [] as string[] };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, key = path.split("/").pop() || "";
    if (path.endsWith("/instruments/search")) {
      const query = url.searchParams.get("q") || ""; state.searches.push(`${query}:${url.searchParams.get("market") || "all"}`); if (query === state.waitSearch) await new Promise<void>(resolve => { state.releaseSearch = resolve; });
      return route.fulfill({ json: { results: [{ display_symbol: query === "OLD" ? "STALE" : "SAP.DE", name: query === "OLD" ? "Old search name" : companyName, exchange: "XETRA" }] } });
    }
    if (path.endsWith("/portfolios/primary")) return route.fulfill(state.failPortfolio ? { status: 503, json: { detail: "PRIVATE_PORTFOLIO" } } : { json: { items: Array.from({ length: state.portfolioCount },(_,i) => ({ ticker: state.portfolioCount === 1 ? "SAP.DE" : `HOLDING${i}` })), summary: {} } });
    if (!path.includes("/correlation/")) return route.fulfill({ json: { items: [], results: [], alerts: [] } });
    const body = route.request().postDataJSON(); state.requests.push({ key, body });
    if (state.failed.includes(key)) return route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER" } });
    if (key === "matrix") {
      if (body.period === state.waitPeriod) await new Promise<void>(resolve => { state.releaseMatrix = resolve; });
      const symbols: string[] = state.empty ? [] : body.symbols;
      return route.fulfill({ json: { symbols, matrix: symbols.map((a,i) => symbols.map((b,j) => i === j ? 1 : (i === 0 && j === 2) || (i === 2 && j === 0) ? null : (i === 0 && j === 3) || (i === 3 && j === 0) ? -.8 : body.period === "6M" ? .66 : body.period === "3M" ? .99 : 0)), period_start: "2026-01-01", period_end: "2026-11-25" } });
    }
    if (key === "rolling") {
      if (body.window === state.waitWindow) await new Promise<void>(resolve => { state.releaseRolling = resolve; });
      const value = body.window/100;
      return route.fulfill({ json: { series: state.empty ? [] : [{ date: "2026-11-01", correlation: -.2 }, { date: "2026-11-02", correlation: null }, { date: "2026-11-03", correlation: value }], current: value, avg: 0, min: -.2, max: value, regimes: [{ start: "2026-11-01", end: "2026-11-03", label: "medium", avg_correlation: 0 }] } });
    }
    if (key === "clusters") {
      const symbols: string[] = body.symbols;
      const tree = (names: string[], distance = .8): any => names.length === 1 ? { name: names[0], distance: 0, children: [] } : { distance, children: [tree(names.slice(0, Math.ceil(names.length/2)),distance/2),tree(names.slice(Math.ceil(names.length/2)),distance/2)] };
      return route.fulfill({ json: { clusters: state.empty ? [] : [{ cluster_id: 1, symbols: symbols.slice(0,2), avg_intra_correlation: 0 }, { cluster_id: 2, symbols: symbols.slice(2), avg_intra_correlation: null }], dendrogram: tree(symbols) } });
    }
    return route.fulfill({ json: {} });
  }); return state;
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Correlation workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke Correlation matrix, native scope, rolling evidence and clusters at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/correlation"); const main = page.getByRole("main", { name: "Correlation workspace", exact: true }); const active = main.getByRole("region", { name: "Active correlation view", exact: true });
  await expect(main.getByRole("heading", { name: "Correlation analysis", exact: true })).toHaveCSS("font-size", "18px"); await expect(active.getByRole("region", { name: "Correlation heatmap table", exact: true })).toBeVisible();
  await main.getByText(/Manage scope/).click(); await main.getByRole("textbox", { name: "Find or enter symbol", exact: true }).fill("SAP"); const suggestion = main.getByRole("button", { name: `SAP.DE ${companyName} XETRA`, exact: true }); await expect(suggestion).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("correlation-scope.png"), fullPage: true, animations: "disabled" }); await suggestion.click(); await expect(main.getByRole("button", { name: "Remove SAP.DE", exact: true })).toBeVisible(); await main.getByText(/Manage scope/).click();
  const matrix = active.getByRole("region", { name: "Correlation heatmap table", exact: true }); await expect(matrix.getByRole("button", { name: "Inspect AAPL / MSFT rolling correlation", exact: true })).toHaveText("0.00"); await expect(matrix.getByRole("button", { name: "Inspect AAPL / GOOGL rolling correlation", exact: true })).toHaveText("Unavailable"); await matrix.focus(); await expect(matrix).toBeFocused(); if (width === 390) { await matrix.press("ArrowRight"); await expect.poll(() => matrix.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await matrix.evaluate(el => { el.scrollLeft = 0; }); expect(await matrix.getByRole("button", { name: "Inspect AAPL / GOOGL rolling correlation", exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await bounded(page); await page.screenshot({ path: info.outputPath("correlation-matrix.png"), fullPage: true, animations: "disabled" });
  await matrix.getByRole("button", { name: "Inspect AAPL / MSFT rolling correlation", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(active).toBeFocused(); await expect(active.getByRole("img", { name: "Rolling correlation chart for AAPL and MSFT", exact: true })).toBeVisible(); await expect(active.getByRole("combobox", { name: "First rolling symbol", exact: true })).toHaveValue("AAPL"); await expect(active.getByRole("combobox", { name: "Second rolling symbol", exact: true })).toHaveValue("MSFT");
  await active.getByText("Exact rolling values", { exact: true }).click(); await expect(active.getByRole("region", { name: "Rolling correlation values", exact: true }).getByText("Unavailable", { exact: true })).toBeVisible(); await active.getByText("Correlation regimes", { exact: true, selector: "summary" }).click(); const regimes = active.getByRole("region", { name: "Correlation regimes", exact: true }); await regimes.focus(); await expect(regimes).toBeFocused(); if (width === 390) { await regimes.press("ArrowRight"); await expect.poll(() => regimes.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); await page.screenshot({ path: info.outputPath("correlation-rolling.png"), fullPage: true, animations: "disabled" });
  await main.getByRole("button", { name: "Clusters", exact: true }).click(); await expect(active.getByRole("heading", { name: "Cluster 1", exact: true })).toBeVisible(); await active.getByText("Merge tree", { exact: true }).click(); const tree = active.getByRole("region", { name: "Correlation merge tree", exact: true }); await tree.getByText("Merge · distance 0.4000", { exact: true }).first().click(); await tree.focus(); await expect(tree).toBeFocused(); await active.getByRole("heading", { name: "Hierarchical clusters", exact: true }).evaluate(el => el.scrollIntoView({ block: "start" })); await bounded(page); await page.screenshot({ path: info.outputPath("correlation-clusters.png"), fullPage: true, animations: "disabled" });
  const lowest = active.getByRole("region", { name: "Lowest correlation pairs", exact: true }); await expect(lowest.getByRole("button").first()).toHaveText("AAPL / AMZN"); await lowest.getByRole("button").first().click(); await expect(active.getByRole("combobox", { name: "Second rolling symbol", exact: true })).toHaveValue("AMZN"); expect(state.searches).toContain("SAP:all"); expect(errors).toEqual([]);
});
test("@smoke Correlation applies latest scopes, retries failures and ignores late search/window reads", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/correlation"); const main = page.getByRole("main", { name: "Correlation workspace", exact: true }); const active = main.getByRole("region", { name: "Active correlation view", exact: true }); await expect(active.getByRole("region", { name: "Correlation heatmap table", exact: true })).toBeVisible(); state.waitPeriod = "3M";
  const period = active.getByRole("combobox", { name: "Matrix and cluster period", exact: true }); await period.selectOption("3M"); await expect.poll(() => Boolean(state.releaseMatrix)).toBe(true); await expect(active.getByRole("region", { name: "Correlation heatmap table", exact: true })).toHaveCount(0); await period.selectOption("6M"); await expect(active.getByRole("button", { name: "Inspect AAPL / MSFT rolling correlation", exact: true })).toHaveText("0.66"); state.releaseMatrix?.();
  state.failed = ["matrix"]; await period.selectOption("1M"); await expect(active.getByRole("alert")).toBeVisible(); state.failed = []; await active.getByRole("button", { name: "Refresh Correlation matrix", exact: true }).click(); await expect(active.getByRole("region", { name: "Correlation heatmap table", exact: true })).toBeVisible();
  await main.getByText(/Manage scope/).click(); state.waitSearch = "OLD"; const input = main.getByRole("textbox", { name: "Find or enter symbol", exact: true }); await input.fill("OLD"); await expect.poll(() => Boolean(state.releaseSearch)).toBe(true); await input.fill("SAP"); await expect(main.getByRole("button", { name: `SAP.DE ${companyName} XETRA`, exact: true })).toBeVisible(); state.releaseSearch?.(); await expect(main.getByText("Old search name", { exact: true })).toHaveCount(0); await input.fill(nativeSymbol); await input.press("Enter"); await expect(main.getByRole("button", { name: `Remove ${nativeSymbol}`, exact: true })).toBeVisible(); await expect(active.getByRole("rowheader", { name: nativeSymbol, exact: true })).toBeVisible(); await bounded(page); await main.getByText(/Manage scope/).click();
  await main.getByRole("button", { name: "Rolling pairs", exact: true }).click(); state.waitWindow = 20; const window = active.getByRole("combobox", { name: "Rolling window", exact: true }); await window.selectOption("20"); await expect.poll(() => Boolean(state.releaseRolling)).toBe(true); await expect(active.getByRole("img", { name: /Rolling correlation chart/ })).toHaveCount(0); await window.selectOption("30"); await expect(active.getByRole("img", { name: /Rolling correlation chart/ })).toBeVisible(); state.releaseRolling?.(); await expect(active.getByText("0.20", { exact: true })).toHaveCount(0); await bounded(page); state.empty = true; await active.getByRole("button", { name: "Refresh Rolling correlation", exact: true }).click(); await expect(active.getByText("No data returned for this scope.", { exact: true })).toBeVisible(); await expect(active.getByRole("img", { name: /Rolling correlation chart/ })).toHaveCount(0); await expect(main.getByText(/PRIVATE_/)).toHaveCount(0);
});
test("@smoke Correlation portfolio failure, twenty-symbol cap and empty analysis are explicit", async ({ page }) => {
  const state = await fixture(page); state.failPortfolio = true; state.portfolioCount = 25; await page.goto("/equity/correlation"); const main = page.getByRole("main", { name: "Correlation workspace", exact: true }); await main.getByText(/Manage scope/).click(); state.failPortfolio = false; await main.getByRole("button", { name: "Retry portfolio symbols", exact: true }).click(); const add = main.getByRole("button", { name: "Add current portfolio", exact: true }); await expect(add).toBeEnabled(); await add.click(); await expect(main.getByRole("list", { name: "Selected correlation symbols", exact: true }).getByRole("listitem")).toHaveCount(20); await expect(main.getByRole("textbox", { name: "Find or enter symbol", exact: true })).toBeDisabled(); await expect(main.getByText(/some names were not added/)).toBeVisible(); await bounded(page);
  for (const name of await main.getByRole("list", { name: "Selected correlation symbols", exact: true }).getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")!))) { if (name !== "Remove AAPL") await main.getByRole("button", { name, exact: true }).click(); }
  await expect(main.getByText(/Add at least two distinct symbols/)).toBeVisible(); await expect(main.getByRole("region", { name: "Correlation heatmap table", exact: true })).toHaveCount(0); expect(state.requests.filter(item => item.key === "matrix").every(item => item.body.symbols.length >= 2)).toBe(true);
});
test("@smoke Correlation views reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "correlation-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "correlation-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/correlation`);
    for (const view of ["Matrix", "Rolling pairs", "Clusters"]) { await page.getByRole("button", { name: view, exact: true }).click(); if (view === "Matrix") await expect(page.getByRole("region", { name: "Correlation heatmap table", exact: true })).toBeVisible(); if (view === "Rolling pairs") await expect(page.getByRole("img", { name: /Rolling correlation chart/ })).toBeVisible(); if (view === "Clusters") await expect(page.getByRole("heading", { name: "Cluster 1", exact: true })).toBeVisible(); await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" }); // Capture the real Chrome surface: fullPage clips CSS dimensions at native zoom.
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const table = page.getByRole("region", { name: "Lowest correlation pairs", exact: true });
    await table.scrollIntoViewIfNeeded(); await table.focus(); await expect(table).toBeFocused();
    await table.getByRole("button").first().scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(info.outputPath("correlation-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});
