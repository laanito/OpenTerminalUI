import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const symbol = "GLOBAL-INFRASTRUCTURE.RESEARCH";
const note = "A dated research reminder with a long source description. Conditions and delivery stay readable, while this optional explanation can be inspected without pushing the primary rules down the page.";
async function fixture(page: Page) {
  const state = { failRules: false, failHistory: false, failWrite: false, failTest: false, writes: [] as any[], tests: [] as string[], rules: [{ id: "r1", symbol, ticker: symbol, status: "active", conditions: [{ field: "price", operator: "above", value: 170.125, params: {} }, { field: "volume", operator: "spike", value: 100, params: { multiplier: 2.5 } }, { field: "ema_cross", operator: "cross_above", value: 0, params: { fast_period: 9, slow_period: 21 } }], logic: "AND", delivery_channels: ["in_app", "webhook"], delivery_config: { webhook_url: "https://example.test/research/alerts" }, cooldown_minutes: 5, max_triggers: 4, trigger_count: 1, expiry_date: "2027-02-03T12:30:30.000Z", note }] as any[] };
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/alerts" && request.method() === "GET") return state.failRules ? route.fulfill({ status: 503, json: { detail: "Unavailable" } }) : route.fulfill({ json: { alerts: state.rules } });
    if (url.pathname === "/api/alerts/history") {
      if (state.failHistory) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      const page = Number(url.searchParams.get("page") || 1);
      return route.fulfill({ json: { page, page_size: 10, total: 12, history: [{ id: `event-${page}`, symbol, condition_type: `price_above_page_${page}`, triggered_value: 171, triggered_at: "2026-11-23T12:00:00Z" }] } });
    }
    if (url.pathname === "/api/alerts" && request.method() === "POST") {
      const payload = request.postDataJSON(); state.writes.push(payload);
      if (state.failWrite) return route.fulfill({ status: 503, json: { detail: "PRIVATE_DELIVERY_CONTEXT" } });
      const alert = { ...payload, id: "created", status: "active", trigger_count: 0 }; state.rules.push(alert); return route.fulfill({ json: { status: "created", alert } });
    }
    if (url.pathname.startsWith("/api/alerts/") && request.method() === "PATCH") {
      const payload = request.postDataJSON(); state.writes.push(payload);
      if (state.failWrite) return route.fulfill({ status: 503, json: { detail: "PRIVATE_DELIVERY_CONTEXT" } });
      const alert = state.rules.find(rule => url.pathname.endsWith(`/${rule.id}`)); Object.assign(alert, payload); return route.fulfill({ json: { status: "updated", alert } });
    }
    if (url.pathname.endsWith("/test")) { state.tests.push(url.pathname); return state.failTest ? route.fulfill({ status: 503, json: { detail: "PRIVATE_DELIVERY_CONTEXT" } }) : route.fulfill({ json: { status: "ok", channels: ["in_app", "webhook"] } }); }
    if (url.pathname.startsWith("/api/alerts/") && request.method() === "DELETE") { state.rules = state.rules.filter(rule => !url.pathname.endsWith(`/${rule.id}`)); return route.fulfill({ json: { status: "deleted" } }); }
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.getByRole("article").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.getByRole("dialog").evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Alerts readable rules, retained editor, history and delivery settings at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); await page.goto("/equity/alerts");
    const main = page.getByRole("main", { name: "Alerts console", exact: true });
    const card = main.getByRole("article", { name: `${symbol} alert`, exact: true }); await expect(card).toBeVisible();
    await expect(card).toContainText("Price above 170.125"); await expect(card.getByRole("heading", { name: symbol, exact: true })).toHaveCSS("font-size", "14px");
    await card.getByText("Rule note", { exact: true }).click(); await expect(card).toContainText(note); await bounded(page);
    await page.screenshot({ path: testInfo.outputPath("alerts-rules.png"), fullPage: true });
    const edit = card.getByRole("button", { name: "Edit", exact: true }); await edit.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit Alert", exact: true }); await expect(dialog.getByRole("button", { name: "Close modal", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeFocused(); await page.keyboard.press("Escape"); await expect(edit).toBeFocused(); await edit.click();
    await dialog.getByRole("spinbutton", { name: "Condition value 1", exact: true }).fill("171.375");
    await expect(dialog.getByRole("combobox", { name: "Condition field 3", exact: true })).toHaveValue("ema_cross");
    await expect(dialog.getByRole("spinbutton", { name: "EMA fast 3", exact: true })).toHaveValue("9");
    await expect(dialog.getByRole("spinbutton", { name: "Volume multiplier 2", exact: true })).toHaveValue("2.5"); await bounded(page);
    state.failWrite = true; await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("Your draft is still here"); expect(state.writes).toHaveLength(1);
    await expect(dialog.getByRole("alert")).not.toContainText("PRIVATE_DELIVERY_CONTEXT"); await expect(dialog.getByRole("spinbutton", { name: "Condition value 1", exact: true })).toHaveValue("171.375");
    await page.screenshot({ path: testInfo.outputPath("alerts-editor.png"), fullPage: true });
    state.failWrite = false; await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(state.writes[1]).toMatchObject({ symbol, conditions: [{ field: "price", operator: "above", value: 171.375, params: {} }, { field: "volume", operator: "spike", value: 100, params: { multiplier: 2.5 } }, { field: "ema_cross", operator: "cross_above", value: 0, params: { fast_period: 9, slow_period: 21 } }], expiry_date: "2027-02-03T12:30:30.000Z" });
    await expect(main.getByRole("status").filter({ hasText: "Alert updated." })).toBeFocused();
    await card.getByRole("button", { name: "Pause", exact: true }).click(); await expect(card.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Test delivery", exact: true }).click(); await expect.poll(() => state.tests.length).toBe(1);
    await main.getByRole("tab", { name: /Alert History/ }).click(); await expect(main.getByRole("article", { name: `${symbol} event`, exact: true })).toContainText("page 1");
    await main.getByRole("button", { name: "Next", exact: true }).click(); await expect(main.getByRole("article", { name: `${symbol} event`, exact: true })).toContainText("page 2");
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("alerts-history.png"), fullPage: true });
    await main.getByRole("tab", { name: "Delivery Settings", exact: true }).click();
    const defaults = main.getByRole("form", { name: "Default delivery settings", exact: true });
    await defaults.getByRole("textbox", { name: "Default Webhook URL", exact: true }).fill("https://example.test/new-default"); await defaults.getByLabel("Default Telegram Bot Token", { exact: true }).fill("fixture-token");
    await expect(defaults.getByLabel("Default Telegram Bot Token", { exact: true })).toHaveAttribute("type", "password");
    await defaults.getByRole("button", { name: "Save Delivery Defaults", exact: true }).click(); await expect(defaults.getByRole("status")).toHaveText("Delivery defaults saved in this browser.");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ot.alert.delivery.defaults") || "{}").webhook_url)).toBe("https://example.test/new-default");
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("alerts-delivery.png"), fullPage: true });
    await main.getByRole("button", { name: "Create New Alert", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create Alert", exact: true }); await create.getByRole("checkbox", { name: "Webhook", exact: true }).check(); await expect(create.getByRole("textbox", { name: "Webhook URL", exact: true })).toHaveValue("https://example.test/new-default");
    await page.keyboard.press("Escape");
  });
}
test("@smoke Alerts distinguishes read failures and empty filters, preserves confirmed writes and reports action failures", async ({ page }) => {
  const state = await fixture(page); state.failRules = true; await page.goto("/equity/alerts?symbol=SAP.DE");
  const main = page.getByRole("main", { name: "Alerts console", exact: true }); await expect(main.getByRole("alert")).toContainText("Could not refresh alert rules"); await expect(main.getByText("No alerts configured.", { exact: true })).toHaveCount(0);
  state.failRules = false; await main.getByRole("button", { name: "Refresh rules", exact: true }).click(); await expect(main.getByText("No alerts match this ticker filter.", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Create New Alert", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Create Alert", exact: true }); await expect(dialog.getByRole("textbox", { name: "Symbol", exact: true })).toHaveValue("SAP.DE");
  state.failRules = true; await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(main.getByRole("article", { name: "SAP.DE alert", exact: true })).toBeVisible(); await expect(main.getByRole("alert")).toContainText("Could not refresh alert rules"); expect(state.writes).toHaveLength(1);
  await main.getByRole("button", { name: "Clear ticker filter", exact: true }).click(); state.failTest = true;
  await main.getByRole("article", { name: `${symbol} alert`, exact: true }).getByRole("button", { name: "Test delivery", exact: true }).click(); await expect(main.getByRole("alert").filter({ hasText: "Could not confirm" })).toBeVisible();
  await main.getByRole("tab", { name: /Alert History/ }).click(); state.failHistory = true; await main.getByRole("button", { name: "Refresh history", exact: true }).click(); await expect(main.getByRole("alert").filter({ hasText: "Could not refresh alert history" })).toBeVisible(); await expect(main.getByRole("article", { name: `${symbol} event`, exact: true })).toBeVisible();
});
test("@smoke Alert rule editor and limits reflow at actual 200% Chrome zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "alerts-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "alerts-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/alerts`); await page.getByRole("article", { name: `${symbol} alert`, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Alert", exact: true }); await dialog.getByText("Trigger limits and expiry", { exact: true }).click(); await expect(dialog.getByLabel("Expiry Date", { exact: true })).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("alerts-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
