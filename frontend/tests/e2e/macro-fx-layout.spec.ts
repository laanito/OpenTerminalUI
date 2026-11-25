import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const eventName = "International inflation expectations and long-term household purchasing power survey";
const commodityName = "International benchmark crude oil futures with a long descriptive contract name";
async function fixture(page: Page) {
  const state = { failed: false, compareFailed: false, compareWait: false, releaseComparison: null as null | (() => void), calendarEmpty: false, calendarActual: 0, pairWait: false, releasePair: null as null | (() => void), comparisons: [] as string[] };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const failure = () => route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
    if (/\/(forex|commodities|economics|fixed-income)\//.test(path) && state.failed) return failure();
    if (path.endsWith("/forex/cross-rates")) {
      const rates = [1, .9, .8, 150, .88, 1.5, 1.3, 83];
      return route.fulfill({ json: { as_of: "2026-11-25T12:00:00Z", currencies: ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"], matrix: rates.map(base => rates.map(quote => quote / base)) } });
    }
    if (path.endsWith("/forex/central-banks")) return route.fulfill({ json: { banks: [{ currency: "EUR", bank: "European Central Bank and Eurosystem reference policy snapshot", policy_rate: 3, last_decision_date: "2026-03-05", next_decision_date: "2026-04-16", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 200, days_until_next_decision: -200, decision_cycle: "Reference schedule" }] } });
    if (path.includes("/forex/pairs/")) {
      const pair = path.split("/").pop();
      if (pair === "GBPUSD" && state.pairWait) await new Promise<void>(resolve => { state.releasePair = resolve; });
      return route.fulfill({ json: { pair, source_symbol: `${pair}=X`, as_of: "2026-11-25T12:00:00Z", current_rate: pair === "GBPUSD" ? 1.25 : 1.1, candles: Array.from({ length: 20 }, (_, i) => ({ t: 1795000000 + i * 86400, o: 1, h: 1.15, l: .99, c: 1 + i / 100, v: 1 })) } });
    }
    if (path.endsWith("/commodities/quotes")) return route.fulfill({ json: { as_of: "2026-11-25T12:00:00Z", categories: ["energy", "metals", "agriculture"].map((id, index) => ({ id, label: id, items: [{ symbol: ["CL=F", "GC=F", "ZC=F"][index], name: commodityName, category: id, price: 100 + index * 20, change: 2, change_pct: 2, volume: 1000, sparkline: [95, 98, 100] }] })) } });
    if (path.includes("/commodities/futures-chain/")) return route.fulfill({ json: { source: "projected", as_of: "2026-11-25T12:00:00Z", points: [{ contract: "Front", expiry: "2026-12-01", price: 100 }, { contract: "M+1", expiry: "2027-01-01", price: 102 }] } });
    if (path.includes("/commodities/seasonal/")) return route.fulfill({ json: { source: "yahoo", as_of: "2026-11-25T12:00:00Z", years: 7, monthly: [{ month: "Jan", average_return_pct: 1 }, { month: "Feb", average_return_pct: -1 }] } });
    if (path.endsWith("/economics/calendar")) return route.fulfill({ json: state.calendarEmpty ? [] : [{ date: `${url.searchParams.get("from")?.slice(0,7)}-10`, time: "14:30", country: "European Union", event_name: eventName, impact: "high", actual: state.calendarActual, forecast: 2.1, previous: 2, unit: "%", sample: true }] });
    if (path.endsWith("/economics/indicators")) return route.fulfill({ json: { eurozone: { long_term_inflation_expectations: { value: 2.1, last_value: 2, date: "2026-11-25", history: [{ date: "2026-10-25", value: 2 }, { date: "2026-11-25", value: 2.1 }] } }, degraded: { reason: "no_live_source" } } });
    if (path.endsWith("/fixed-income/yield-curve/historical")) { state.comparisons.push(url.searchParams.get("date") || ""); if (state.compareFailed) return failure(); if (state.compareWait) await new Promise<void>(resolve => { state.releaseComparison = resolve; }); return route.fulfill({ json: { date: url.searchParams.get("date"), data: [{ series_id: "DGS2", label: "2Y", order: 1, yield: 3.2 }, { series_id: "DGS10", label: "10Y", order: 2, yield: 3.1 }], degraded: { reason: "no_live_source" } } }); }
    if (path.endsWith("/fixed-income/yield-curve")) return route.fulfill({ json: { date: "2026-11-25", data: [{ series_id: "DGS2", label: "2Y", order: 1, yield: 4, chg_1d: .01 }, { series_id: "DGS10", label: "10Y", order: 2, yield: 3.5, chg_1d: -.02 }], spreads: { "2s10s": -.5 } } });
    if (path.endsWith("/fixed-income/2s10s-spread-history")) return route.fulfill({ json: { history: [{ date: "2026-11-24", value: -.4 }, { date: "2026-11-25", value: -.5 }], degraded: { reason: "no_live_source" } } });
    return route.fulfill({ json: { items: [], results: [], quotes: [], alerts: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const main = page.getByRole("main").last();
  const overflow = await main.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll("*")].filter(node => node.getBoundingClientRect().right > el.getBoundingClientRect().right + 1 && getComputedStyle(node).overflowX !== "auto").slice(0, 8).map(node => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right })) }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
  for (const region of await main.getByRole("region").all()) {
    const box = await region.boundingBox(); if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1); }
  }
}
for (const width of [1440, 1024, 390]) test(`@smoke Macro and FX readable scopes, local tables, event review and yield comparisons at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/forex?pair=EURUSD&review=keep");
  await expect(page.getByText(/Cross rates: backend snapshot/)).toBeVisible();
  const matrix = page.getByRole("region", { name: "FX cross rates table", exact: true }); await matrix.focus(); await expect(matrix).toBeFocused();
  await matrix.getByRole("button", { name: /^GBP\/USD:/ }).click(); await expect(page).toHaveURL(/pair=GBPUSD/); expect(new URL(page.url()).searchParams.get("review")).toBe("keep");
  await expect(page.getByText("GBP/USD Detail", { exact: true })).toBeVisible(); await expect(page.getByText(/Static reference snapshot/)).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("forex.png"), fullPage: true, animations: "disabled" });
  await page.goto("/equity/commodities"); const quotes = page.getByRole("region", { name: "Commodity quotes table", exact: true }); await expect(quotes.getByText(commodityName)).toBeVisible(); await page.getByRole("button", { name: "Metals", exact: true }).click(); await quotes.getByRole("button", { name: "GC=F", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(/symbol=GC%3DF/); await expect(page.getByText(/Modelled curve, not observed futures quotes/)).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("commodities.png"), fullPage: true, animations: "disabled" });
  await page.goto("/equity/economics"); await page.getByRole("button", { name: new RegExp(eventName) }).click(); const detail = page.getByRole("region", { name: "Economic event details", exact: true }); await expect(detail).toBeFocused(); await expect(detail.getByText("0", { exact: true })).toBeVisible(); state.calendarActual = 3; await page.getByRole("button", { name: "Refresh calendar", exact: true }).click(); await expect(detail.getByText(/Select an event/)).toBeVisible(); await page.getByRole("button", { name: new RegExp(eventName) }).click(); await expect(detail.getByText("3", { exact: true })).toBeVisible(); await page.getByRole("checkbox", { name: "high", exact: true }).uncheck(); await expect(page.getByText("No events match the selected impacts.", { exact: true })).toBeVisible(); await expect(detail.getByText(/Select an event/)).toBeVisible(); await page.getByRole("checkbox", { name: "high", exact: true }).check(); await bounded(page); await page.screenshot({ path: info.outputPath("economics.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Macro dashboard", exact: true }).click(); await expect(page.getByRole("heading", { name: "long term inflation expectations", exact: true })).toBeVisible(); await bounded(page);
  await page.goto("/equity/yield-curve"); const date = page.getByLabel("Historical comparison date", { exact: true }); await date.fill("2026-10-01"); state.compareFailed = true; await page.getByRole("button", { name: "Compare", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("comparison date is kept"); await expect(date).toHaveValue("2026-10-01"); state.compareFailed = false; state.compareWait = true; await page.getByRole("button", { name: "Compare", exact: true }).click(); await expect.poll(() => Boolean(state.releaseComparison)).toBe(true); await expect(date).toBeDisabled(); await expect(page.getByRole("button", { name: "Loading comparison…", exact: true })).toBeDisabled(); expect(state.comparisons).toHaveLength(2); state.releaseComparison?.(); await expect(page.getByText("Non-live comparison", { exact: true })).toBeVisible(); expect(state.comparisons).toEqual(["2026-10-01", "2026-10-01"]); await bounded(page); await page.screenshot({ path: info.outputPath("yield.png"), fullPage: true, animations: "disabled" }); await page.getByRole("button", { name: "Remove comparison 2026-10-01", exact: true }).click(); await expect(page.getByText("No historical curves added", { exact: true })).toBeVisible();
});
test("@smoke FX late pair reads cannot overwrite a newer selection", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/forex?pair=EURUSD"); await expect(page.getByText(/Pair history: backend history/)).toBeVisible(); state.pairWait = true;
  await page.getByRole("button", { name: /^GBP\/USD:/ }).click(); await expect.poll(() => Boolean(state.releasePair)).toBe(true); await expect(page.getByText("Loading…", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: /^EUR\/USD:/ }).click(); await expect(page.getByText(/Pair history: backend history/)).toBeVisible(); state.releasePair?.(); await expect(page.getByText("EUR/USD Detail", { exact: true })).toBeVisible(); await expect(page.locator("div").filter({ hasText: /^1\.1000$/ })).toBeVisible();
});
test("@smoke Macro and FX failed reads distinguish samples, unavailable and empty data", async ({ page }) => {
  const state = await fixture(page); state.failed = true; await page.goto("/equity/forex"); await expect(page.getByText(/synthetic sample; not market history/)).toBeVisible(); await expect(page.getByText(/Sample cross rates are shown/)).toBeVisible();
  await page.goto("/equity/commodities"); await expect(page.getByText(/Samples are not live quotes/)).toBeVisible();
  await page.goto("/equity/economics"); await expect(page.getByRole("alert")).toContainText("Calendar could not be refreshed"); await page.getByRole("button", { name: "Macro dashboard", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Macro snapshots could not be refreshed");
  await page.goto("/equity/yield-curve"); await expect(page.getByText(/Current curve could not be refreshed/)).toBeVisible(); await expect(page.getByText(/Spread history could not be refreshed/)).toBeVisible(); await expect(page.getByText("Unavailable", { exact: true })).toBeVisible(); await expect(page.getByText("Inversion status unavailable.", { exact: true })).toBeVisible(); expect(await page.locator("body").innerText()).not.toContain("PRIVATE_PROVIDER_CONTEXT");
  state.failed = false; state.calendarEmpty = true; await page.goto("/equity/economics"); await expect(page.getByText("No events returned for this month.", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Next month", exact: true }).click(); await expect(page.getByText("No events returned for this month.", { exact: true })).toBeVisible();
});
test("@smoke Macro and FX reflow at actual 200% Chrome zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "macro-fx-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "macro-zoom", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page);
    for (const route of ["forex", "commodities", "economics", "yield-curve"]) { await page.goto(`${baseURL}/equity/${route}`); await expect(page.getByRole("main").last()).toBeVisible(); await bounded(page); }
    await page.getByLabel("Historical comparison date", { exact: true }).fill("2026-10-01"); await page.getByRole("button", { name: "Compare", exact: true }).click(); await expect(page.getByRole("button", { name: "Remove comparison 2026-10-01", exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(info.outputPath("macro-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
