import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const longType = "Extraordinary special distribution subject to shareholder approval and a long provider description";
async function fixture(page: Page) {
  const state = { failed: false, empty: false, reads: [] as string[], release: null as null | (() => void), wait: false };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.includes("/dividends/")) return route.fulfill({ json: { items: [], results: [], alerts: [] } });
    state.reads.push(path);
    if (state.failed) return route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER" } });
    if (path.endsWith("/history/AAPL") && state.wait) await new Promise<void>(resolve => { state.release = resolve; });
    if (path.endsWith("/portfolio-income")) return route.fulfill({ json: { annual_income: 1234.56, monthly_breakdown: state.empty ? [] : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((month,i) => ({ month, amount: i === 0 ? 0 : i === 1 ? null : i*10.25 })) } });
    const data = path.endsWith("/calendar") ? [{ symbol: "SAP.DE", ex_date: "2026-12-01", amount: 2.35, type: longType }, { symbol: "ZERO", ex_date: null, amount: 0, estimated: true }, { symbol: "MISSING", amount: null }]
      : path.endsWith("/aristocrats") ? [{ symbol: "PG", years_growth: 68, yield: 0 }, { symbol: "MMM", years_growth: 66, yield: null }]
      : [{ date: "2026-01-01", amount: path.endsWith("SAP.DE") ? 2.35 : 999 }, { date: "2026-04-01", amount: 0 }, { date: "2026-07-01", amount: null }];
    return route.fulfill({ json: state.empty ? [] : data });
  });
  return state;
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Dividends workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke Dividends four-view workflow and readable scope at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await fixture(page);
  if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.goto("/equity/dividends");
  const results = page.getByRole("region", { name: "Dividend results", exact: true });
  await expect(results.getByText(longType, { exact: true })).toBeVisible(); expect(await results.getByText(longType, { exact: true }).evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(210); await expect(results.getByText("Estimated", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dividends", exact: true })).toHaveCSS("font-size", "18px"); await bounded(page);
  await page.screenshot({ path: info.outputPath("dividends-calendar.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Portfolio income", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(results.getByText("1,234.56", { exact: true })).toBeVisible(); await expect(results.getByText("Reported total · currency not supplied", { exact: true })).toBeVisible(); await expect(results.getByRole("img", { name: "Monthly reported dividend amounts" })).toBeVisible(); await bounded(page);
  await page.screenshot({ path: info.outputPath("dividends-income.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Stock history", exact: true }).click(); const input = page.getByRole("textbox", { name: "History symbol", exact: true }); await input.fill("sap.de"); await input.press("Enter");
  await expect(results.getByRole("heading", { name: "Dividend history · SAP.DE", exact: true })).toBeVisible(); await expect(results.getByText("2.35", { exact: true })).toBeVisible();
  const table = results.getByRole("region", { name: "Historical dividends table", exact: true }); await table.focus(); await expect(table).toBeFocused();
  if (width === 390) { await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
  await table.evaluate(el => { el.scrollLeft = 0; }); await bounded(page); await page.screenshot({ path: info.outputPath("dividends-history.png"), fullPage: true, animations: "disabled" });
  const longSymbol = "INTERNATIONAL-LISTING-WITH-A-LONG-PROVIDER-SYMBOL-SUFFIX.DE"; await input.fill(longSymbol); await input.press("Enter"); await expect(results.getByRole("heading", { name: `Dividend history · ${longSymbol}`, exact: true })).toBeVisible(); await bounded(page);
  await page.getByRole("button", { name: "Aristocrats", exact: true }).click(); await expect(results.getByText("0.00%", { exact: true })).toBeVisible(); await expect(results.getByText("Unavailable", { exact: true })).toBeVisible(); await bounded(page);
  await page.getByText("Coverage and projection method", { exact: true }).click(); await expect(page.getByText(/Mixed-currency totals/)).toBeVisible(); await bounded(page);
  await page.screenshot({ path: info.outputPath("dividends-aristocrats.png"), fullPage: true, animations: "disabled" });
});
test("@smoke Dividend history keeps applied scope through late reads, failure and manual retry", async ({ page }) => {
  const state = await fixture(page); await page.goto("/equity/dividends"); await expect(page.getByText(longType, { exact: true })).toBeVisible(); state.wait = true;
  await page.getByRole("button", { name: "Stock history", exact: true }).click(); await expect.poll(() => Boolean(state.release)).toBe(true);
  const input = page.getByRole("textbox", { name: "History symbol", exact: true }); await input.fill("SAP.DE"); expect(state.reads.some(path => path.endsWith("/SAP.DE"))).toBe(false); await input.press("Enter");
  await expect(page.getByRole("region", { name: "Historical dividends table", exact: true }).getByText("2.35", { exact: true })).toBeVisible(); state.release?.();
  await expect(page.getByText("999", { exact: true })).toHaveCount(0); await input.fill("KEPT-DRAFT"); state.failed = true;
  await page.getByRole("button", { name: "Refresh view", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("No previous result"); await expect(page.getByRole("img", { name: /Reported dividend history/ })).toHaveCount(0); await expect(input).toHaveValue("KEPT-DRAFT"); await expect(page.getByText(/PRIVATE_PROVIDER/)).toHaveCount(0);
  state.failed = false; state.empty = true; await page.getByRole("button", { name: "Refresh view", exact: true }).click(); await expect(page.getByText("No dividend rows returned for this scope.", { exact: true })).toBeVisible(); expect(state.reads.at(-1)).toMatch(/history\/SAP.DE$/);
});
test("@smoke Dividends reflow at actual 200% Chrome browser zoom", async ({ playwright, baseURL }, info) => {
  const profile = await mkdtemp(join(tmpdir(), "dividends-review-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "dividends-review", email: "zoom@example.test", exp: Math.floor(Date.now()/1000)+3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/dividends`);
    for (const view of ["Upcoming calendar", "Portfolio income", "Stock history", "Aristocrats"]) { await page.getByRole("button", { name: view, exact: true }).click(); await expect(page.getByRole("region", { name: "Dividend results", exact: true })).toHaveAttribute("aria-busy", "false"); await bounded(page); }
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics", { body: JSON.stringify(metrics), contentType: "application/json" }); // Capture the real Chrome surface: fullPage clips CSS dimensions at native zoom.
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const table = page.getByRole("region", { name: "Dividend aristocrats table", exact: true });
    await table.scrollIntoViewIfNeeded(); await table.focus(); await expect(table).toBeFocused();
    await table.getByText("0.00%", { exact: true }).scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(info.outputPath("dividends-zoom.png"), Buffer.from(capture.data, "base64"));
  } finally { await context.close(); }
});
