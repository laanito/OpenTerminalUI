import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const roles = ["long-term","medium-term","short-term","execution"];
const presetKeys = ["swing","position","day-trade","scalp"];
const stacks = [["W","D","4H","1H"],["M","W","D","4H"],["D","1H","15m","5m"],["1H","15m","5m","1m"]];
const longName = "International enterprise technology and worldwide financial infrastructure research holding company with a fully readable listing name";
function series(interval: string,symbol: string) {
 const step = ({ "1mo": 2592000,"1wk": 604800,"1d": 86400,"4h": 14400,"1h": 3600,"15m": 900,"5m": 300,"1m": 60 } as Record<string,number>)[interval] || 86400;
 const end = Date.UTC(2026,10,25)/1000,base = symbol === "NVDA" ? 500 : 100;
 return Array.from({ length: 72 },(_,i) => ({ t: end-(71-i)*step,o: base+i*.5-1,h: base+i*.5+2,l: base+i*.5-2,c: base+i*.5,v: i*100 }));
}
async function fixture(page: Page) {
 const state = { failIntervals: [] as string[],empty: false,holdInterval: "",release: null as null | (() => void),requests: [] as { symbol: string;interval: string;range: string;market: string }[] };
 await page.context().routeWebSocket("**/*", socket => socket.close());
 await page.context().route("**/api/**", async route => {
  const url = new URL(route.request().url()),path = url.pathname;
  if (path === "/api/instruments/search") return route.fulfill({ json: { results: [{ canonical_id: "NVDA",display_symbol: "NVDA",type: "stock",exchange: "NASDAQ",name: longName,country_code: "US" }] } });
  if (!path.includes("/chart/")) return route.fulfill({ json: { items: [],results: [],alerts: [] } });
  const symbol = decodeURIComponent(path.split("/").pop()!),interval = url.searchParams.get("interval") || "1d",range = url.searchParams.get("period") || url.searchParams.get("range") || "";
  state.requests.push({ symbol,interval,range,market: url.searchParams.get("market") || "" });
  const failed = state.failIntervals.includes(interval),empty = state.empty;
  if (interval === state.holdInterval) await new Promise<void>(resolve => { state.release = resolve; });
  if (failed) return route.fulfill({ status: 503,json: { detail: "PRIVATE_PROVIDER" } });
  const data = empty ? [] : series(interval,symbol);
  return route.fulfill({ json: { symbol,ticker: symbol,currency: "USD",interval,count: data.length,data: data.map(point => url.searchParams.get("normalized") === "true" ? { ...point,t: point.t*1000 } : point) } });
 }); return state;
}
async function ready(page: Page) { for (const role of roles) await expect(page.getByTestId(`mta-panel-${role}`)).toHaveAttribute("aria-busy","false"); }
async function drawn(page: Page) {
 await expect.poll(() => page.getByTestId("mta-grid").evaluate(root => Math.min(...Array.from(root.querySelectorAll('[role="img"]')).map(host => { const canvas = host.querySelector("canvas"); const context = canvas?.getContext("2d"); if (!canvas || !context) return 0; const pixels = context.getImageData(0,0,canvas.width,canvas.height).data; let count=0; for (let i=0;i<pixels.length;i+=4) if (pixels[i]<90 && pixels[i+1]>120 && pixels[i+2]>80 && pixels[i+2]<190) count++; return count; })))).toBeGreaterThan(20);
}
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Multi-timeframe workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke MTA readable four-chart presets, controls and exact observations at ${width}px`, async ({ page },info) => {
 await page.setViewportSize({ width,height: 1000 }); const state = await fixture(page),errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
 await page.goto("/equity/mta"); const main = page.getByRole("main", { name: "Multi-timeframe workspace",exact: true }); await ready(page); await expect(page.getByTestId("mta-preset-scalp").locator("span").last()).toHaveCSS("text-transform","none"); await page.screenshot({ path: info.outputPath("mta-scope.png"),fullPage: true,animations: "disabled" });
 for (const [i,key] of presetKeys.entries()) { await page.getByTestId(`mta-preset-${key}`).click(); await ready(page); for (const [j,role] of roles.entries()) { await expect(page.getByTestId(`mta-interval-${role}`)).toHaveText(stacks[i][j]); const plot = page.getByTestId(`mta-panel-${role}`).getByRole("img", { name: /price chart$/ }); const box = await plot.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(320); } await drawn(page); await bounded(page); }
 expect(state.requests).toHaveLength(16); expect(state.requests.slice(0,4).map(row => [row.interval,row.range,row.market])).toEqual([["1wk","5y","NASDAQ"],["1d","1y","NASDAQ"],["4h","6mo","NASDAQ"],["1h","3mo","NASDAQ"]]);
 const first = page.getByTestId("mta-panel-long-term"); await first.locator("summary").filter({ hasText: "Chart controls" }).click(); await first.getByRole("combobox", { name: "Chart style",exact: true }).selectOption("line"); await first.getByRole("combobox", { name: "EMA overlay",exact: true }).selectOption("50"); await expect(page.getByTestId("mta-panel-execution").locator("summary").filter({ hasText: "Chart controls" })).toContainText("Candles · EMA 20"); await bounded(page); await first.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath("mta-controls.png"),fullPage: true,animations: "disabled" });
 await first.locator("summary").filter({ hasText: "Exact observations" }).click(); const table = first.getByRole("region", { name: "Long-term exact observations",exact: true }); await expect(table.getByRole("columnheader", { name: "EMA 50",exact: true })).toBeVisible(); await expect(table.getByRole("row")).toHaveCount(73); await table.focus(); await expect(table).toBeFocused(); await table.press("ArrowDown"); await expect.poll(() => table.evaluate(el => el.scrollTop)).toBeGreaterThan(0); if (await table.evaluate(el => el.scrollWidth > el.clientWidth+1)) { await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await table.evaluate(el => el.scrollTo({ top: 0,left: 0,behavior: "instant" })); if (width === 1440) expect((await page.getByTestId("mta-panel-medium-term").boundingBox())!.height).toBeLessThan(600); await bounded(page); await page.screenshot({ path: info.outputPath("mta-values.png"),fullPage: true,animations: "disabled" }); expect(state.requests).toHaveLength(16);
 await first.locator("summary").filter({ hasText: "Exact observations" }).click(); await first.locator("summary").filter({ hasText: "Chart controls" }).click(); await page.getByTestId("mta-trend-summary").locator("summary").click(); await expect(main.getByText(/summary always uses EMA20/)).toBeVisible(); await bounded(page); await page.getByTestId("mta-trend-summary").scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath("mta-summary.png"),fullPage: true,animations: "disabled" });
 await main.getByRole("region", { name: "Timeframe scope",exact: true }).hover(); await page.mouse.wheel(0,-10000); await expect(main.getByRole("heading", { name: "Multi-Timeframe Analysis",exact: true })).toBeInViewport(); await main.getByRole("combobox", { name: "Chart symbol",exact: true }).fill("NVDA"); await expect(main.getByRole("listbox").getByRole("option")).toContainText(longName); await bounded(page); await page.screenshot({ path: info.outputPath("mta-search.png"),fullPage: true,animations: "disabled" }); await main.getByRole("listbox").getByRole("option").click(); await ready(page); await expect(main.getByText(`NVDA · NASDAQ · Scalp · ${longName}`, { exact: true })).toBeVisible(); expect(state.requests.slice(16).every(row => row.symbol === "NVDA")).toBe(true); expect(errors).toEqual([]);
});
test("@smoke MTA clears stale history, keeps successful contexts and ignores old preset completions", async ({ page }) => {
 const state = await fixture(page); await page.goto("/equity/mta"); await ready(page); state.holdInterval = "1wk"; state.failIntervals = ["4h"]; await page.getByRole("button", { name: "Refresh charts",exact: true }).click(); await expect.poll(() => Boolean(state.release)).toBe(true); await expect(page.getByTestId("mta-close-long-term")).toHaveText("Unavailable"); await expect(page.getByTestId("mta-panel-short-term").getByRole("alert")).toContainText("Refresh charts to retry"); await expect(page.getByTestId("mta-close-execution")).toHaveText("135.50"); await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible(); state.failIntervals = []; state.holdInterval = ""; await page.getByTestId("mta-preset-scalp").click(); await ready(page); state.release?.(); await expect(page.getByTestId("mta-interval-long-term")).toHaveText("1H"); await expect(page.getByTestId("mta-panel-short-term").getByRole("alert")).toHaveCount(0); await expect(page.getByText(/PRIVATE_/)).toHaveCount(0); await bounded(page);
 state.empty = true; await page.getByRole("button", { name: "Refresh charts",exact: true }).click(); await ready(page); await expect(page.getByText("No chart data returned for this context.", { exact: true })).toHaveCount(4); await expect(page.getByTestId("mta-close-long-term")).toHaveText("Unavailable"); await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
});
test("@smoke MTA real candle hover inspects a historical close and restores latest on leave", async ({ page }) => {
 await fixture(page); await page.goto("/equity/mta"); await ready(page); await drawn(page); const panel = page.getByTestId("mta-panel-long-term"),plot = panel.getByRole("img", { name: /price chart$/ }); await plot.scrollIntoViewIfNeeded(); const box = (await plot.boundingBox())!; let inspected = false;
 for (const x of [.15,.3,.45,.6]) { await page.mouse.move(box.x+box.width*x,box.y+box.height*.45); const text = await page.getByTestId("mta-close-long-term").innerText(); if (text !== "135.50" && text !== "Unavailable") { inspected = true; break; } }
 expect(inspected,"Real chart hover must inspect an older candle").toBe(true); await expect(panel.getByText("Inspected close", { exact: true })).toBeVisible(); await page.mouse.move(box.x-4,box.y-4); await expect(page.getByTestId("mta-close-long-term")).toHaveText("135.50"); await expect(panel.getByText("Latest close", { exact: true })).toBeVisible(); await page.getByRole("checkbox", { name: "Crosshair sync",exact: true }).uncheck(); await bounded(page);
});
test("@smoke MTA real plots and observation tables reflow at native 200% Chrome zoom", async ({ playwright,baseURL },info) => {
 const profile = await mkdtemp(join(tmpdir(),"mta-review-zoom-")); await mkdir(join(profile,"Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile,"Default","Preferences"),JSON.stringify({ partition: { default_zoom_level: { x: zoom } },profile: { default_zoom_level: zoom } }));
 const context = await playwright.chromium.launchPersistentContext(profile,{ channel: "chromium",headless: true,viewport: null,deviceScaleFactor: undefined,isMobile: undefined,executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,args: ["--window-size=1440,1000","--disable-gpu"],reducedMotion: "reduce" });
 try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "mta-review",email: "zoom@example.test",exp: Math.floor(Date.now()/1000)+3600,role: "trader" }))}.y`; localStorage.setItem("ot-access-token",jwt); localStorage.setItem("ot-refresh-token",jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/mta`); await ready(page); await drawn(page); await bounded(page);
 const metrics = await page.evaluate(() => ({ cssWidth: innerWidth,browserWidth: outerWidth,visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics",{ body: JSON.stringify(metrics),contentType: "application/json" }); const dismiss = page.getByRole("button",{ name: "Dismiss",exact: true }); if (await dismiss.isVisible()) await dismiss.click();
 const first = page.getByTestId("mta-panel-long-term"); await first.locator("summary").filter({ hasText: "Chart controls" }).click(); await first.getByRole("combobox",{ name: "EMA overlay",exact: true }).selectOption("200"); await first.locator("summary").filter({ hasText: "Exact observations" }).click(); const table = first.getByRole("region",{ name: "Long-term exact observations",exact: true }); await table.focus(); await table.press("ArrowRight"); await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); await table.press("ArrowDown"); await expect.poll(() => table.evaluate(el => el.scrollTop)).toBeGreaterThan(0); await table.evaluate(el => el.scrollTo({ top: 0,left: 0,behavior: "instant" })); await bounded(page); await table.getByRole("rowheader").first().scrollIntoViewIfNeeded(); const cdp = await context.newCDPSession(page),capture = await cdp.send("Page.captureScreenshot",{ format: "png",captureBeyondViewport: false }); await writeFile(info.outputPath("mta-zoom.png"),Buffer.from(capture.data,"base64"));
 } finally { await context.close(); }
});
