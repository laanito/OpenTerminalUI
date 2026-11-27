import { expect,test,type Page } from "@playwright/test";
import { mkdtemp,mkdir,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const provider = "Synthetic international order-book provider used only for readable fixture coverage";
const degraded = { reason: "no_live_source",source: "none",detail: "No configured live source is available for this symbol and market." };
async function fixture(page: Page) {
 const state = { failed: [] as string[],emptyDepth: false,emptyTape: false,holdSymbol: "",release: null as null | (() => void),requests: [] as { kind: string;symbol: string;market: string;levels: number;limit: number }[] };
 await page.context().routeWebSocket("**/*",socket => socket.close());
 await page.context().route("**/api/**",async route => {
  const url = new URL(route.request().url()),path = url.pathname;
  let kind = "",symbol = "";
  if (path.includes("/depth/")) { kind = "depth"; symbol = decodeURIComponent(path.split("/").pop()!); }
  else if (path.includes("/tape/")) { kind = path.endsWith("/summary") ? "summary" : "recent"; symbol = decodeURIComponent(path.split("/").slice(-2)[0]); }
  else if (path.includes("/stocks/")) { kind = "quote"; symbol = decodeURIComponent(path.split("/").pop()!); }
  else return route.fulfill({ json: { items: [],results: [],alerts: [] } });
  const levels = Number(url.searchParams.get("levels") || 20); state.requests.push({ kind,symbol,levels,market: url.searchParams.get("market") || "",limit: Number(url.searchParams.get("limit") || 0) });
  const fail = state.failed.includes(kind),emptyDepth = state.emptyDepth,emptyTape = state.emptyTape;
  if (kind === "depth" && symbol === state.holdSymbol) await new Promise<void>(resolve => { state.release = resolve; });
  if (fail) return route.fulfill({ status: 503,json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
  if (kind === "quote") return route.fulfill({ json: { ticker: symbol,symbol,current_price: symbol === "NVDA" ? 500 : 100,change_pct: 0 } });
  if (kind === "depth") {
   const side = (sign: number) => { let cumulative = 0; return Array.from({ length: levels },(_,i) => { const quantity = sign === -1 ? i === 0 ? 120.25 : i === 1 ? 170.25 : 50+i : i === 0 ? 110 : 50+i; cumulative += quantity; return { price: Number((100+sign*(i+1)*.05).toFixed(2)),quantity,size: quantity,orders: i+1,cumulative_qty: cumulative }; }); };
   const bids = emptyDepth ? [] : side(-1),asks = emptyDepth ? [] : side(1),totalBid = bids.at(-1)?.cumulative_qty || 0,totalAsk = asks.at(-1)?.cumulative_qty || 0;
   return route.fulfill({ json: { symbol,market: "US",provider_key: provider,as_of: "2026-11-27T10:00:00Z",last_price: emptyDepth ? 0 : 100,mid_price: emptyDepth ? 0 : 100,last_qty: 0,spread: emptyDepth ? 0 : .1,spread_pct: .1,tick_size: emptyDepth ? 0 : .05,levels,total_bid_qty: totalBid,total_ask_qty: totalAsk,total_bid_quantity: totalBid,total_ask_quantity: totalAsk,imbalance: .1,bids,asks,degraded: emptyDepth ? degraded : null } });
  }
  if (kind === "summary") return route.fulfill({ json: { total_volume: emptyTape ? 0 : 1079,buy_volume: emptyTape ? 0 : 1039,sell_volume: emptyTape ? 0 : 40,buy_pct: emptyTape ? 0 : 96.29,large_trade_count: emptyTape ? 0 : 1,avg_trade_size: 13.5,trades_per_min: 60,degraded: emptyTape ? degraded : undefined } });
  return route.fulfill({ json: { trades: emptyTape ? [] : Array.from({ length: 80 },(_,i) => ({ timestamp: new Date(Date.UTC(2026,10,27,10,0,0)+i*1000).toISOString(),price: 100+i,quantity: i === 0 ? 1000 : 1,value: i === 0 ? 100000 : 100+i,side: i%2 ? "sell" : "buy" })),degraded: emptyTape ? degraded : undefined } });
 }); return state;
}
async function ready(page: Page) { await expect(page.getByRole("region",{ name: "Depth ladder values",exact: true })).toBeVisible(); await expect(page.getByRole("region",{ name: "Time and sales trades",exact: true })).toBeVisible(); }
async function bounded(page: Page) {
  const metrics = await page.getByRole("main", { name: "Depth of Market workspace", exact: true }).evaluate(main => {
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

for (const width of [1440,1024,390]) test(`@smoke DOM readable book, local inspection and virtual tape at ${width}px`,async ({ page },info) => {
 await page.setViewportSize({ width,height: 1000 }); const state = await fixture(page),errors: string[] = []; page.on("pageerror",error => errors.push(error.message)); if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate",{ rate: 4 }); }
 await page.goto("/equity/dom"); await ready(page); const main = page.getByRole("main",{ name: "Depth of Market workspace",exact: true }),depth = main.getByRole("region",{ name: "Depth workspace",exact: true }),tape = main.getByRole("region",{ name: "Time and sales workspace",exact: true }),ladder = depth.getByRole("region",{ name: "Depth ladder values",exact: true }),trades = tape.getByRole("region",{ name: "Time and sales trades",exact: true });
 await expect(main.getByRole("heading",{ name: "Depth of Market",exact: true })).toHaveCSS("font-size","18px"); await expect(depth.getByText(new RegExp(provider))).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("dom-overview.png"),fullPage: true,animations: "disabled" });
 const pageScroll = await main.evaluate(el => { for (let p=el.parentElement;p;p=p.parentElement) if (p.scrollHeight>p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p.scrollTop; return scrollY; }); await expect.poll(() => ladder.evaluate(el => el.scrollTop)).toBeGreaterThan(0); expect(await main.evaluate(el => { for (let p=el.parentElement;p;p=p.parentElement) if (p.scrollHeight>p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p.scrollTop; return scrollY; })).toBe(pageScroll);
 await depth.getByRole("button",{ name: "Cumulative",exact: true }).click(); await expect(depth.locator('[data-price="99.9"]').getByTestId("dom-bid-qty")).toHaveText("290.5"); await depth.getByRole("combobox",{ name: "Depth levels",exact: true }).selectOption("40"); await expect(depth.getByTestId("dom-row")).toHaveCount(81); await depth.getByRole("combobox",{ name: "Depth refresh",exact: true }).selectOption("5000"); await depth.getByRole("button",{ name: "Auto-center",exact: true }).click(); await ladder.focus(); await expect(ladder).toBeFocused(); await ladder.press("ArrowDown"); if (await ladder.evaluate(el => el.scrollWidth>el.clientWidth+1)) { await ladder.press("ArrowRight"); await expect.poll(() => ladder.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); await page.screenshot({ path: info.outputPath("dom-ladder.png"),fullPage: true,animations: "disabled" });
 await depth.locator("summary").filter({ hasText: "Returned bid / ask levels" }).click(); const raw = depth.getByRole("region",{ name: "Returned depth levels",exact: true }); await expect(raw.getByRole("row")).toHaveCount(81); await raw.focus(); await raw.press("ArrowDown"); await expect.poll(() => raw.evaluate(el => el.scrollTop)).toBeGreaterThan(0); await bounded(page); await page.screenshot({ path: info.outputPath("dom-returned.png"),fullPage: true,animations: "disabled" }); await depth.locator("summary").filter({ hasText: "Returned bid / ask levels" }).click();
 await tape.getByRole("button",{ name: "Auto-follow",exact: true }).click(); await trades.focus(); await trades.evaluate(el => { el.scrollTop = 1200; }); await expect.poll(() => trades.locator('tr[data-side]').first().getAttribute("aria-rowindex")).not.toBe("2"); await tape.getByRole("combobox",{ name: "Trade filter",exact: true }).selectOption("large"); await expect(tape.getByRole("table",{ name: "Time and sales values",exact: true })).toHaveAttribute("aria-rowcount","2"); await expect(trades.locator('tr[data-side]')).toHaveCount(1); await tape.getByRole("spinbutton",{ name: "Minimum size (whole units)",exact: true }).fill("1500"); await expect(tape.getByText("No trades match the current filter.",{ exact: true })).toBeVisible(); await tape.getByRole("spinbutton",{ name: "Minimum size (whole units)",exact: true }).fill("0"); await tape.getByRole("combobox",{ name: "Trade filter",exact: true }).selectOption("all"); await trades.focus(); if (await trades.evaluate(el => el.scrollWidth>el.clientWidth+1)) { await trades.press("ArrowRight"); await expect.poll(() => trades.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); await page.screenshot({ path: info.outputPath("dom-tape.png"),fullPage: true,animations: "disabled" }); await tape.locator("summary").filter({ hasText: "Tape summary" }).click(); await expect(tape.getByText("1,079",{ exact: true })).toBeVisible(); await bounded(page); await page.screenshot({ path: info.outputPath("dom-summary.png"),fullPage: true,animations: "disabled" });
 expect(state.requests.some(row => row.kind === "depth" && row.levels === 40 && row.market === "US")).toBe(true); expect(state.requests.filter(row => row.kind === "recent").every(row => row.limit === 500)).toBe(true); expect(errors).toEqual([]);
});
test("@smoke DOM ignores old symbols, separates failed panels and hides previous reads",async ({ page }) => {
 const state = await fixture(page); await page.goto("/equity/dom"); await ready(page); const main = page.getByRole("main",{ name: "Depth of Market workspace",exact: true }),depth = main.getByRole("region",{ name: "Depth workspace",exact: true }),tape = main.getByRole("region",{ name: "Time and sales workspace",exact: true });
 state.failed = ["depth","summary"]; await depth.getByRole("button",{ name: "Refresh depth",exact: true }).click(); await expect(depth.getByRole("alert")).toContainText("no previous book"); await expect(depth.getByTestId("dom-row")).toHaveCount(0); await tape.getByRole("button",{ name: "Refresh tape",exact: true }).click(); await tape.locator("summary").filter({ hasText: "Tape summary" }).click(); await expect(tape.getByRole("alert")).toContainText("no previous summary"); await expect(tape.getByRole("region",{ name: "Time and sales trades",exact: true })).toBeVisible(); state.failed = ["recent"]; await tape.getByRole("button",{ name: "Refresh tape",exact: true }).click(); await expect(tape.getByRole("alert")).toContainText("no previous trades"); await expect(tape.getByRole("table",{ name: "Time and sales values",exact: true })).toHaveCount(0); state.failed = [];
 state.holdSymbol = "SLOW"; const input = main.getByRole("textbox",{ name: "DOM symbol",exact: true }); await input.fill(" slow "); await input.press("Enter"); await expect.poll(() => Boolean(state.release)).toBe(true); await input.fill("NVDA"); await input.press("Enter"); await ready(page); state.release?.(); await expect(depth.getByText(/Reported symbol: NVDA/)).toBeVisible(); await expect(main.getByText(/PRIVATE_/)).toHaveCount(0); await bounded(page);
});
test("@smoke DOM degraded empty responses show compact coverage instead of invented zero rows",async ({ page },info) => {
 const state = await fixture(page); state.emptyDepth = true; state.emptyTape = true; await page.goto("/equity/dom"); const main = page.getByRole("main",{ name: "Depth of Market workspace",exact: true }); await expect(main.getByText(/No depth available/)).toBeVisible(); await expect(main.getByText("No tape available for this symbol.",{ exact: true })).toBeVisible(); await expect(main.getByTestId("dom-row")).toHaveCount(0); await expect(main.getByRole("table",{ name: "Time and sales values",exact: true })).toHaveCount(0); await main.getByRole("region",{ name: "Time and sales workspace",exact: true }).locator("summary").filter({ hasText: "Tape summary" }).click(); await expect(main.getByText("Unavailable",{ exact: true })).toHaveCount(6); await bounded(page); await main.getByRole("region",{ name: "Time and sales workspace",exact: true }).locator("summary").filter({ hasText: "Tape summary" }).click(); await main.getByRole("region",{ name: "DOM instrument scope",exact: true }).hover(); await page.mouse.wheel(0,-10000); await expect(main.getByRole("heading",{ name: "Depth of Market",exact: true })).toBeInViewport(); await page.screenshot({ path: info.outputPath("dom-unavailable.png"),fullPage: true,animations: "disabled" });
});
test("@smoke DOM depth and virtual tape reflow at native 200% Chrome zoom",async ({ playwright,baseURL },info) => {
 const profile = await mkdtemp(join(tmpdir(),"dom-review-zoom-")); await mkdir(join(profile,"Default")); const zoom = Math.log(2)/Math.log(1.2); await writeFile(join(profile,"Default","Preferences"),JSON.stringify({ partition: { default_zoom_level: { x: zoom } },profile: { default_zoom_level: zoom } }));
 const context = await playwright.chromium.launchPersistentContext(profile,{ channel: "chromium",headless: true,viewport: null,deviceScaleFactor: undefined,isMobile: undefined,executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,args: ["--window-size=1440,1000","--disable-gpu"],reducedMotion: "reduce" });
 try { await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "dom-review",email: "zoom@example.test",exp: Math.floor(Date.now()/1000)+3600,role: "trader" }))}.y`; localStorage.setItem("ot-access-token",jwt); localStorage.setItem("ot-refresh-token",jwt); }); const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/dom`); await ready(page); await bounded(page); const metrics = await page.evaluate(() => ({ cssWidth: innerWidth,browserWidth: outerWidth,visualScale: visualViewport?.scale })); expect(metrics.browserWidth/metrics.cssWidth).toBeCloseTo(2,1); expect(metrics.visualScale).toBe(1); await info.attach("native-zoom-metrics",{ body: JSON.stringify(metrics),contentType: "application/json" }); const dismiss = page.getByRole("button",{ name: "Dismiss",exact: true }); if (await dismiss.isVisible()) await dismiss.click(); const ladder = page.getByRole("region",{ name: "Depth ladder values",exact: true }); await ladder.focus(); await ladder.press("ArrowDown"); if (await ladder.evaluate(el => el.scrollWidth>el.clientWidth+1)) { await ladder.press("ArrowRight"); await expect.poll(() => ladder.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } const trades = page.getByRole("region",{ name: "Time and sales trades",exact: true }); await trades.focus(); await trades.press("ArrowDown"); await expect.poll(() => trades.evaluate(el => el.scrollTop)).toBeGreaterThan(0); if (await trades.evaluate(el => el.scrollWidth>el.clientWidth+1)) { await trades.press("ArrowRight"); await expect.poll(() => trades.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); } await bounded(page); await trades.evaluate(el => el.scrollTo({ top: 0,left: 0,behavior: "instant" })); await trades.locator('tr[data-side]').first().scrollIntoViewIfNeeded(); const cdp = await context.newCDPSession(page),capture = await cdp.send("Page.captureScreenshot",{ format: "png",captureBeyondViewport: false }); await writeFile(info.outputPath("dom-zoom.png"),Buffer.from(capture.data,"base64"));
 } finally { await context.close(); }
});
