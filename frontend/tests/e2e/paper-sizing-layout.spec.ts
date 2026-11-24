import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const accountName = "Long-term worldwide research and independent simulated capital account";
async function fixture(page: Page) {
  const state = { accounts: [{ id: "one", name: accountName, initial_capital: 100000, current_cash: 90000 }, { id: "two", name: "Independent paper research account", initial_capital: 20000, current_cash: 15000 }], writes: [] as any[], creates: [] as any[], orders: [] as any[], failOrders: false, failPositions: false, failPerformance: false, failWrite: false, deferFirst: false, releaseFirst: null as null | (() => void) };
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname, method = route.request().method();
    const failed = () => route.fulfill({ status: 503, json: { detail: "PRIVATE_UPSTREAM_CONTEXT" } });
    if (p === "/api/paper/portfolios") {
      if (method === "GET") return route.fulfill({ json: { items: state.accounts } });
      const payload = route.request().postDataJSON(); state.creates.push(payload); if (state.failWrite) return failed();
      const account = { id: "new", ...payload, current_cash: payload.initial_capital }; state.accounts.push(account); return route.fulfill({ json: account });
    }
    if (p === "/api/paper/orders" && method === "POST") {
      const payload = route.request().postDataJSON(); state.writes.push(payload); if (state.failWrite) return failed();
      const order = { ...payload, id: `order-${state.writes.length}`, status: payload.order_type === "market" ? "filled" : "pending", fill_price: payload.order_type === "market" ? 200 : null, fill_time: "2026-11-24T12:00:00Z" }; state.orders.unshift(order); return route.fulfill({ json: order });
    }
    const scope = p.includes("/two/") ? "two" : "one";
    if (/\/paper\/portfolios\/[^/]+\/positions$/.test(p)) {
      if (state.deferFirst && scope === "one") await new Promise<void>(resolve => { state.releaseFirst = resolve; });
      if (state.failPositions) return failed();
      return route.fulfill({ json: { items: [{ id: `position-${scope}`, symbol: scope === "one" ? "NASDAQ:AAPL" : "MSFT", quantity: 10.5, avg_entry_price: 180, mark_price: 200, unrealized_pnl: 210 }] } });
    }
    if (/\/paper\/portfolios\/[^/]+\/orders$/.test(p)) return state.failOrders ? failed() : route.fulfill({ json: { items: state.orders.filter(row => row.portfolio_id === scope) } });
    if (/\/paper\/portfolios\/[^/]+\/trades$/.test(p)) return route.fulfill({ json: { items: [{ id: `trade-${scope}`, order_id: "prior", symbol: scope === "one" ? "AAPL" : "MSFT", side: "buy", quantity: 2.5, price: 190, timestamp: "2026-11-24T12:00:00Z", pnl_realized: null }] } });
    if (/\/paper\/portfolios\/[^/]+\/performance$/.test(p)) return state.failPerformance ? failed() : route.fulfill({ json: { portfolio_id: scope, equity: scope === "one" ? 92100 : 17100, pnl: 2100, cumulative_return: .021, daily_pnl_curve: [], sharpe_ratio: 1.2, max_drawdown: .01 } });
    if (p.includes("depth")) return route.fulfill({ json: { symbol: "AAPL", last_price: 200, bids: [{ price: 199.9, quantity: 10 }], asks: [{ price: 200.1, quantity: 10 }] } });
    if (p.includes("quote")) return route.fulfill({ json: { ticker: "AAPL", symbol: "AAPL", company_name: "Research fixture", current_price: 200, change_pct: 1, currency: "USD" } });
    if (p.endsWith("/alerts")) return route.fulfill({ json: { alerts: [] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('main[aria-label="Paper trading"] section:visible, main[aria-label="Paper trading"] article:visible, main[aria-label="Position sizer"] section:visible, [role="dialog"]').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.getByRole("dialog").evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Paper account, labelled order drafts and all sizing methods at ${width}px`, async ({ page }, testInfo) => {
    if (width === 1440) { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); await page.goto("/equity/paper");
    const main = page.getByRole("main", { name: "Paper trading", exact: true });
    await expect(main.getByRole("article", { name: "NASDAQ:AAPL paper position", exact: true })).toBeVisible(); await expect(main.locator("p").filter({ hasText: accountName })).toBeVisible(); await expect(main.getByRole("combobox", { name: "Paper portfolio", exact: true })).toHaveCSS("font-size", "14px");
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("paper-overview.png"), fullPage: true, animations: "disabled" });
    await main.getByRole("button", { name: "Place paper order", exact: true }).click(); const order = page.getByRole("dialog", { name: "Place paper order", exact: true });
    await expect(order.getByRole("button", { name: "Close modal", exact: true })).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(order.getByRole("button", { name: "Submit paper order", exact: true })).toBeFocused();
    await order.getByRole("combobox", { name: "Order type", exact: true }).selectOption("limit"); await order.getByRole("spinbutton", { name: "Quantity (asset units)", exact: true }).fill("2.5"); await order.getByRole("spinbutton", { name: "Limit price (quote units)", exact: true }).fill("123.125");
    state.failWrite = true; await order.getByRole("button", { name: "Submit paper order", exact: true }).click(); await expect(order.getByRole("alert")).toContainText("Your draft is kept"); await expect(order.getByRole("alert")).not.toContainText("PRIVATE_UPSTREAM_CONTEXT"); await expect(order.getByRole("spinbutton", { name: "Limit price (quote units)", exact: true })).toHaveValue("123.125"); expect(state.writes).toHaveLength(1); await bounded(page); await page.screenshot({ path: testInfo.outputPath("paper-order.png"), fullPage: true, animations: "disabled" });
    state.failWrite = false; state.failOrders = true; await order.getByRole("button", { name: "Submit paper order", exact: true }).click(); await expect(order).toHaveCount(0); await expect(main.getByRole("article", { name: "AAPL paper order", exact: true })).toBeVisible(); await expect(main.getByText(/Could not refresh orders/)).toBeVisible(); expect(state.writes[1]).toEqual({ portfolio_id: "one", symbol: "AAPL", side: "buy", order_type: "limit", quantity: 2.5, limit_price: 123.125 }); await expect(main.getByRole("status").filter({ hasText: "Paper order received" })).toBeFocused();
    state.failOrders = false; await main.getByRole("combobox", { name: "Paper portfolio", exact: true }).selectOption("two"); await main.getByRole("tab", { name: "Positions", exact: true }).click(); await expect(main.getByRole("article", { name: "MSFT paper position", exact: true })).toBeVisible(); await expect(main.getByRole("article", { name: "NASDAQ:AAPL paper position", exact: true })).toHaveCount(0);
    await main.getByText("Hotkey trading", { exact: true, selector: "summary" }).click(); const hotkey = main.getByRole("region", { name: "Paper hotkey trading", exact: true }); await expect(hotkey.getByText("Independent paper research account", { exact: true })).toBeVisible(); await hotkey.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("3"); await hotkey.getByRole("spinbutton", { name: "Quantity", exact: true }).press("b"); expect(state.writes).toHaveLength(2); await hotkey.focus(); await page.keyboard.press("b"); await expect.poll(() => state.writes.length).toBe(3); expect(state.writes[2]).toMatchObject({ portfolio_id: "two", side: "buy", order_type: "market", quantity: 3 }); await bounded(page);
    await main.getByRole("button", { name: "New paper portfolio", exact: true }).click(); const create = page.getByRole("dialog", { name: "New paper portfolio", exact: true }); await create.getByRole("textbox", { name: "Portfolio name", exact: true }).fill("Another research account"); await create.getByRole("spinbutton", { name: "Initial capital (account units)", exact: true }).fill("1234.56"); await create.getByRole("button", { name: "Create paper portfolio", exact: true }).click(); await expect(create).toHaveCount(0); await expect(main.getByRole("combobox", { name: "Paper portfolio", exact: true })).toHaveValue("new"); expect(state.creates).toEqual([{ name: "Another research account", initial_capital: 1234.56 }]);
    await page.goto("/equity/position-sizer"); const sizer = page.getByRole("main", { name: "Position sizer", exact: true }); const method = sizer.getByRole("combobox", { name: "Position sizing method", exact: true });
    await expect(sizer.getByTestId("position-sizer-shares")).toHaveText("200"); await expect(sizer.getByLabel("Calculated position size", { exact: true })).toContainText("200 asset units"); await expect(sizer.getByText("Account Size", { exact: true })).toHaveCSS("font-size", "12px"); await bounded(page); await page.screenshot({ path: testInfo.outputPath("sizing-inputs.png"), fullPage: true, animations: "disabled" });
    await method.selectOption("kelly"); await expect(sizer.getByTestId("position-sizer-shares")).toHaveText("6,500"); await method.selectOption("atr"); await sizer.getByRole("spinbutton", { name: "ATR Value", exact: true }).fill("25"); await expect(sizer.getByTestId("position-sizer-shares")).toHaveText("200"); await expect(sizer.getByRole("spinbutton", { name: "Stop Loss Price", exact: true })).toBeDisabled();
    await method.selectOption("volatility"); await expect(sizer.getByTestId("position-sizer-shares")).toHaveText("240"); await method.selectOption("fixed_fractional"); await sizer.getByRole("spinbutton", { name: "Stop Loss Price", exact: true }).fill("2500"); await expect(sizer.getByRole("alert")).toContainText("Stop loss must differ from entry"); await sizer.getByRole("spinbutton", { name: "Stop Loss Price", exact: true }).fill("2450"); await expect(sizer.getByRole("alert")).toHaveCount(0);
    await sizer.getByRole("link", { name: "View sizing results", exact: true }).click(); await expect(sizer.getByRole("region", { name: "Sizing results", exact: true })).toBeFocused(); await bounded(page); await page.screenshot({ path: testInfo.outputPath("sizing-results.png"), fullPage: true, animations: "disabled" });
  });
}
test("@smoke Paper ignores late account data and preserves independent unavailable states", async ({ page }) => {
  const state = await fixture(page); state.deferFirst = true; state.failPerformance = true; await page.goto("/equity/paper"); const main = page.getByRole("main", { name: "Paper trading", exact: true }); await expect(main.getByRole("combobox", { name: "Paper portfolio", exact: true })).toHaveValue("one");
  await expect.poll(() => Boolean(state.releaseFirst)).toBe(true); await main.getByRole("combobox", { name: "Paper portfolio", exact: true }).selectOption("two"); await expect(main.getByRole("article", { name: "MSFT paper position", exact: true })).toBeVisible(); state.releaseFirst?.(); await expect(main.getByRole("article", { name: "NASDAQ:AAPL paper position", exact: true })).toHaveCount(0); await expect(main.getByText(/Could not refresh performance/)).toBeVisible(); await expect(main.getByText("Equity (account units)", { exact: true }).locator("..")).toContainText("Unavailable");
  state.failPositions = true; await main.getByRole("button", { name: "Refresh activity", exact: true }).click(); await expect(main.getByText(/Could not refresh positions/)).toBeVisible(); await expect(main.getByRole("article", { name: "MSFT paper position", exact: true })).toBeVisible();
});
test("@smoke Paper order and position sizing reflow at native 200% Chrome zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "paper-sizing-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2); await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "paper-sizing-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/paper`); await page.getByRole("button", { name: "Place paper order", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("spinbutton", { name: "Quantity (asset units)", exact: true })).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("paper-sizing-native-zoom.png"), Buffer.from(shot.data, "base64"));
    await page.keyboard.press("Escape"); await page.goto(`${baseURL}/equity/position-sizer`); await page.getByRole("combobox", { name: "Position sizing method", exact: true }).selectOption("atr"); await page.getByRole("spinbutton", { name: "ATR Value", exact: true }).fill("25"); await bounded(page); await expect(page.getByTestId("position-sizer-shares")).toHaveText("200");
  } finally { await context.close(); }
});

test("@smoke Standalone paper hotkeys keep account scope, input focus and viewport bounds", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 }); const state = await fixture(page);
  await page.addInitScript(() => localStorage.setItem("ot:hotkey-panel:position:v1", JSON.stringify({ x: 1800, y: 1200 })));
  await page.goto("/equity/paper"); await expect(page.getByRole("article", { name: "NASDAQ:AAPL paper position", exact: true })).toBeVisible(); await page.keyboard.press("Control+t");
  const widget = page.getByTestId("hotkey-panel-float"); await expect(widget).toBeVisible();
  const box = (await widget.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(700);
  await widget.getByRole("combobox", { name: "Hotkey paper portfolio", exact: true }).selectOption("two");
  const quantity = widget.getByRole("spinbutton", { name: "Quantity", exact: true }); await quantity.fill("4"); await quantity.press("b"); await expect(quantity).toBeFocused(); expect(state.writes).toHaveLength(0);
  await widget.getByRole("region", { name: "Paper hotkey trading", exact: true }).focus(); await page.keyboard.press("b"); await expect.poll(() => state.writes.length).toBe(1); expect(state.writes[0]).toMatchObject({ portfolio_id: "two", side: "buy", quantity: 4, order_type: "market" });
  await widget.getByRole("button", { name: "Minimize hotkey panel", exact: true }).click(); await widget.getByRole("button", { name: "Expand hotkey panel", exact: true }).click(); await expect(widget.getByRole("spinbutton", { name: "Quantity", exact: true })).toHaveValue("4");
  expect(await widget.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); await widget.getByRole("button", { name: "Close hotkey panel", exact: true }).click(); await expect(widget).toHaveCount(0);
});
