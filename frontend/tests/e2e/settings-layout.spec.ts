import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const keyName = "Daily research agent for worldwide market notes and long-term portfolio evidence";
const secret = `otui_fixture_${"a".repeat(90)}`;
const initialKey = { id: 1, name: keyName, prefix: "otui_fixture", permissions: "read_write", is_active: 1, created_at: "2026-11-24T09:00:00Z", last_used_at: null };
const initialReport = { id: "report-1", report_type: "long_term_portfolio_research_and_market_review", frequency: "weekly", email: "daily-research-and-portfolio-review@example.test", data_type: "screening_results", enabled: true };
async function fixture(page: Page) {
  const state = { failKeys: false, failAlerts: false, failReports: false, failWrites: false, failCatalog: false, failExport: false, keys: [initialKey], reports: [initialReport], alerts: [{ id: "alert-1", ticker: "SAP.DE", symbol: "SAP.DE", alert_type: "price", condition: "above", threshold: 170.125, note: "Review this dated thesis before acting; a price threshold is a reminder, not an instruction to trade." }], keyWrites: [] as any[], reportWrites: [] as any[], alertWrites: [] as any[], exports: [] as string[], deletes: [] as string[] };
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } }); });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const failed = () => route.fulfill({ status: 503, json: { detail: "PRIVATE_PROVIDER_CONTEXT" } });
    if (url.pathname === "/api/settings/api-keys") {
      if (method === "GET") return state.failKeys ? failed() : route.fulfill({ json: state.keys });
      const payload = request.postDataJSON(); state.keyWrites.push(payload);
      if (state.failWrites) return failed();
      const metadata = { ...initialKey, ...payload, id: 2 }; state.keys.push(metadata);
      return route.fulfill({ json: { ...metadata, key: secret } });
    }
    if (url.pathname === "/api/reports/scheduled") {
      if (method === "GET") return state.failReports ? failed() : route.fulfill({ json: { items: state.reports } });
      const payload = request.postDataJSON(); state.reportWrites.push(payload);
      if (state.failWrites) return failed();
      const report = { ...payload, id: "report-2", enabled: true }; state.reports.push(report); return route.fulfill({ json: report });
    }
    if (url.pathname === "/api/alerts") {
      if (method === "GET") return state.failAlerts ? failed() : route.fulfill({ json: { alerts: state.alerts } });
      const payload = request.postDataJSON(); state.alertWrites.push(payload);
      if (state.failWrites) return failed();
      const alert = { ...payload, id: "alert-2", symbol: payload.ticker }; state.alerts.push(alert); return route.fulfill({ json: { status: "created", alert } });
    }
    if (method === "DELETE") {
      state.deletes.push(url.pathname); if (state.failWrites) return failed();
      state.keys = state.keys.filter(row => !url.pathname.endsWith(`/${row.id}`)); state.reports = state.reports.filter(row => !url.pathname.endsWith(`/${row.id}`)); state.alerts = state.alerts.filter(row => !url.pathname.endsWith(`/${row.id}`));
      return route.fulfill({ json: { status: "deleted" } });
    }
    if (url.pathname === "/api/v1/backtest/data/catalog") return state.failCatalog ? failed() : route.fulfill({ json: { items: [{ name: `${"worldwide-research-".repeat(5)}2026-11.csv`, bytes: 123456, updated_at: 0 }] } });
    if (url.pathname.startsWith("/api/export/")) { state.exports.push(`${url.pathname}${url.search}`); return state.failExport ? failed() : route.fulfill({ contentType: "text/csv", body: "symbol,quantity\nSAP.DE,1.25\n" }); }
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('main[aria-label="Settings console"] article:visible, main[aria-label="Settings console"] section:visible, [role="dialog"]').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Settings labelled preferences, automation, key dialog and data tools at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); await page.goto("/equity/settings");
    const main = page.getByRole("main", { name: "Settings console", exact: true });
    await main.getByRole("combobox", { name: "Market context", exact: true }).selectOption("EU"); await expect(main.getByRole("combobox", { name: "Exchange", exact: true })).toHaveValue("EU"); await expect(main.getByRole("combobox", { name: "Display currency", exact: true })).toHaveValue("EUR");
    await expect(main.getByRole("combobox", { name: "Market context", exact: true })).toHaveCSS("font-size", "14px"); await bounded(page); await page.screenshot({ path: testInfo.outputPath("settings-preferences.png"), fullPage: true, animations: "disabled" });
    await main.getByRole("tab", { name: "Preferences", exact: true }).focus(); await page.keyboard.press("ArrowRight"); await expect(main.getByRole("tab", { name: "Automation", exact: true })).toBeFocused();
    const keys = main.getByRole("region", { name: "Automation API keys", exact: true }); await expect(keys.getByRole("article", { name: `${keyName} API key`, exact: true })).toBeVisible();
    await keys.getByRole("textbox", { name: "Key name", exact: true }).fill("Hermes test agent"); await keys.getByRole("combobox", { name: "Key permissions", exact: true }).selectOption("read_write"); await keys.getByRole("button", { name: "Generate New Key", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New API Key Generated", exact: true }); await expect(dialog.getByRole("button", { name: "Close modal", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "I have saved it", exact: true })).toBeFocused(); await dialog.getByRole("button", { name: "Copy", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("Could not copy");
    expect(state.keyWrites).toEqual([{ name: "Hermes test agent", permissions: "read_write" }]); await bounded(page); await page.screenshot({ path: testInfo.outputPath("settings-key-dialog.png"), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByText(secret, { exact: true })).toHaveCount(0); await expect(keys.getByRole("status").filter({ hasText: "API key created" })).toBeFocused();
    await main.getByText("Add report schedule", { exact: true, selector: "summary" }).click(); await main.getByRole("textbox", { name: "Email (optional)", exact: true }).fill("hermes@example.test"); await main.getByRole("combobox", { name: "Frequency", exact: true }).selectOption("weekly");
    await main.getByRole("button", { name: "Save schedule", exact: true }).click(); await expect.poll(() => state.reportWrites.length).toBe(1); expect(state.reportWrites[0]).toEqual({ report_type: "portfolio_summary", frequency: "weekly", email: "hermes@example.test", data_type: "positions" });
    await main.getByText("Add quick alert", { exact: true, selector: "summary" }).click(); await main.getByRole("textbox", { name: "Alert ticker", exact: true }).fill("BTC-EUR"); await main.getByRole("spinbutton", { name: "Threshold (quoted units)", exact: true }).fill("60123.125"); await main.getByRole("button", { name: "Add Alert", exact: true }).click(); await expect.poll(() => state.alertWrites.length).toBe(1); expect(state.alertWrites[0]).toMatchObject({ ticker: "BTC-EUR", threshold: 60123.125 });
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("settings-automation.png"), fullPage: true, animations: "disabled" });
    const keyCard = keys.getByRole("article", { name: "Hermes test agent API key", exact: true }); page.once("dialog", dialog => dialog.accept()); await keyCard.getByRole("button", { name: "Revoke", exact: true }).click(); await expect(keyCard).toHaveCount(0); expect(state.deletes).toContain("/api/settings/api-keys/2");
    await main.getByRole("tab", { name: "Data", exact: true }).click();
    const downloadPromise = page.waitForEvent("download"); await main.getByRole("article", { name: "positions exports", exact: true }).getByRole("button", { name: "CSV", exact: true }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe("positions.csv"); expect(state.exports).toContain("/api/export/positions?format=csv");
    await main.getByRole("button", { name: "Refresh datasets", exact: true }).click(); await expect(main.getByRole("region", { name: "Stored dataset files", exact: true })).toContainText("2026-11.csv"); await bounded(page); await page.screenshot({ path: testInfo.outputPath("settings-data.png"), fullPage: true, animations: "disabled" });
    await main.getByRole("tab", { name: "Host setup", exact: true }).click(); await expect(main.getByRole("tab", { name: "Host setup", exact: true })).toHaveAttribute("aria-selected", "true"); await main.getByText("OPENTERMINALUI_NSE_PUBLIC_ENABLED", { exact: true }).scrollIntoViewIfNeeded(); await bounded(page); await page.screenshot({ path: testInfo.outputPath("settings-host.png"), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(value => JSON.stringify(localStorage).includes(value), secret)).toBe(false);
  });
}
test("@smoke Settings retains failed drafts and separates independent reads from confirmed writes", async ({ page }) => {
  const state = await fixture(page); state.failKeys = true; state.failAlerts = true; await page.goto("/equity/settings"); const main = page.getByRole("main", { name: "Settings console", exact: true }); await main.getByRole("tab", { name: "Automation", exact: true }).click();
  const keys = main.getByRole("region", { name: "Automation API keys", exact: true }); await expect(keys.getByRole("alert")).toContainText("Could not refresh API keys"); await expect(main.getByRole("article", { name: `${initialReport.report_type} schedule`, exact: true })).toBeVisible(); await expect(main.getByText("No alert rules configured.", { exact: true })).toHaveCount(0);
  await keys.getByRole("textbox", { name: "Key name", exact: true }).fill("Retained draft"); state.failWrites = true; await keys.getByRole("button", { name: "Generate New Key", exact: true }).click(); await expect(keys.getByRole("alert").filter({ hasText: "Could not confirm key creation" })).toBeVisible(); await expect(keys.getByRole("textbox", { name: "Key name", exact: true })).toHaveValue("Retained draft"); expect(state.keyWrites).toHaveLength(1); await expect(main).not.toContainText("PRIVATE_PROVIDER_CONTEXT");
  state.failWrites = false; await keys.getByRole("button", { name: "Generate New Key", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText(secret); await page.getByRole("button", { name: "I have saved it", exact: true }).click(); await expect(keys.getByRole("article", { name: "Retained draft API key", exact: true })).toBeVisible(); expect(state.keyWrites).toHaveLength(2);
  await main.getByText("Add report schedule", { exact: true, selector: "summary" }).click(); state.failReports = true; await main.getByRole("button", { name: "Save schedule", exact: true }).click(); await expect(main.getByText("Report schedule saved.", { exact: true })).toBeVisible(); await expect(main.getByRole("article", { name: "portfolio_summary schedule", exact: true })).toBeVisible(); await expect(main.getByText(/Could not refresh schedules/)).toBeVisible(); expect(state.reportWrites).toHaveLength(1);
  await main.getByRole("tab", { name: "Data", exact: true }).click(); await main.getByRole("button", { name: "Refresh datasets", exact: true }).click(); await expect(main.getByRole("region", { name: "Stored dataset files", exact: true })).toBeVisible(); state.failCatalog = true; await main.getByRole("button", { name: "Refresh datasets", exact: true }).click(); await expect(main.getByText(/Could not refresh datasets/)).toBeVisible(); await expect(main.getByRole("region", { name: "Stored dataset files", exact: true })).toBeVisible();
  state.failExport = true; await main.getByRole("article", { name: "positions exports", exact: true }).getByRole("button", { name: "PDF", exact: true }).click(); await expect(main.getByRole("alert").filter({ hasText: "Could not download" })).toBeVisible();
});
test("@smoke Settings key creation and host labels reflow at native 200% Chrome zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "settings-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "settings-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/settings`); const main = page.getByRole("main", { name: "Settings console", exact: true }); await main.getByRole("tab", { name: "Host setup", exact: true }).click(); await expect(main.getByText("OPENTERMINALUI_NSE_PUBLIC_ENABLED", { exact: true })).toBeVisible(); await bounded(page);
    await main.getByRole("tab", { name: "Automation", exact: true }).click(); await main.getByRole("textbox", { name: "Key name", exact: true }).fill("Zoom agent"); await main.getByRole("button", { name: "Generate New Key", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText(secret); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("settings-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
