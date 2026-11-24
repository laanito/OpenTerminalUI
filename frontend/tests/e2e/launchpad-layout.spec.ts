import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const layoutName = "Worldwide research with dated sources and independently linked market panels";
const newsTitle = "Current headlines and long source names for a dated investment research review";
const headline = "Global infrastructure companies review investment plans as markets reassess longer-term financing conditions";
const source = "Worldwide infrastructure and economic research publication";
const panels = [
  { id: "chart", type: "chart", title: "AAPL daily chart with independent technical studies", symbol: "AAPL", x: 0, y: 0, w: 7, h: 6 },
  { id: "news", type: "news-feed", title: newsTitle, symbol: "AAPL", x: 7, y: 0, w: 5, h: 6 },
  { id: "watch", type: "watchlist", title: "Owned research watchlists with long descriptive names", x: 0, y: 6, w: 4, h: 5 },
  { id: "slot", type: "economics", title: "Historical economics template slot without embedded implementation", x: 4, y: 6, w: 4, h: 5 },
  { id: "research", type: "ai-research", title: "Ask a research question using this panel context", symbol: "AAPL", x: 8, y: 6, w: 4, h: 5 },
].map(panel => ({ ...panel, linkGroup: "red", linked: true, poppedOut: false }));
async function fixture(page: Page) {
  const writes: any[] = [];
  await page.addInitScript(({ panels, layoutName }) => {
    localStorage.setItem("ot:launchpad:layouts:v1", JSON.stringify([{ id: "review", name: layoutName, panels }]));
    localStorage.setItem("ot:launchpad:active:v1", "review");
  }, { panels, layoutName });
  await page.context().routeWebSocket("**/*", socket => socket.close());
  await page.context().route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/user/layouts") {
      if (route.request().method() === "GET") return route.fulfill({ json: { items: [{ id: "review", name: layoutName, panels }] } });
      writes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } });
    }
    if (path.startsWith("/api/chart/") || path.startsWith("/api/v3/chart/")) return route.fulfill({ json: { ticker: "AAPL", interval: "1d", currency: "USD", data: Array.from({ length: 80 }, (_, i) => ({ t: Date.parse("2026-08-01T12:00:00Z") + i * 86400000, o: 100 + i, h: 104 + i, l: 98 + i, c: 102 + i, v: 1000 })) } });
    if (path.startsWith("/api/news/by-ticker/")) return route.fulfill({ json: { items: [{ id: "headline", title: headline, source, url: "https://example.test/research", published_at: "2026-11-24T12:00:00Z" }] } });
    if (path === "/api/watchlists") return route.fulfill({ json: [{ id: "watchlist", name: "Long-term infrastructure and worldwide research evidence", symbols: ["AAPL", "MSFT"] }] });
    if (path.includes("quote")) return route.fulfill({ json: { ticker: "AAPL", symbol: "AAPL", company_name: "Apple research fixture", current_price: 180, currency: "USD", change_pct: 1 } });
    if (path.endsWith("/ai/query")) return route.fulfill({ json: { explanation: "A fixture answer for testing readable research prose without a model call.", model_profile: "fast", model: "fixture-model" } });
    if (path.endsWith("/alerts")) return route.fulfill({ json: { alerts: [] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return writes;
}
async function geometry(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("ot:launchpad:layouts:v1") || "[]").find((layout: any) => layout.id === "review").panels.map(({ id, x, y, w, h }: any) => ({ id, x, y, w, h })));
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.getByTestId("launchpad-panel-frame").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.getByRole("dialog").evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Launchpad readable populated panels, editing, picker and templates at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await fixture(page); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await page.goto("/equity/launchpad");
    const main = page.getByRole("main", { name: "Launchpad workspace", exact: true }); const chart = main.locator('[data-launchpad-panel-id="chart"]'), news = main.locator('[data-launchpad-panel-id="news"]');
    await chart.scrollIntoViewIfNeeded(); await expect(chart.locator("canvas").first()).toBeVisible(); await news.scrollIntoViewIfNeeded(); await expect(main.getByRole("button", { name: /^Drag / })).toHaveCount(width < 1050 ? 0 : 5); await expect(news.getByText(headline, { exact: true })).toBeVisible(); await expect(news.getByText(source, { exact: true })).toBeVisible();
    await expect(news.getByRole("heading", { name: newsTitle, exact: true })).toHaveCSS("font-size", "14px"); await bounded(page); await chart.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("launchpad-panels.png"), fullPage: true, animations: "disabled" });
    await news.getByRole("button", { name: "Panel settings", exact: true }).click(); const editor = page.getByRole("dialog", { name: "Panel settings", exact: true });
    await expect(editor.getByRole("button", { name: "Close modal", exact: true })).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(editor.getByRole("button", { name: "Save panel settings", exact: true })).toBeFocused();
    await editor.getByRole("textbox", { name: "Panel title", exact: true }).fill(`${newsTitle} · edited`); await editor.getByRole("combobox", { name: "Symbol link group", exact: true }).selectOption("blue"); await bounded(page); await page.screenshot({ path: testInfo.outputPath("launchpad-editor.png"), fullPage: true, animations: "disabled" });
    await editor.getByRole("button", { name: "Save panel settings", exact: true }).click(); await expect(editor).toHaveCount(0); await expect(news.getByRole("heading", { name: `${newsTitle} · edited`, exact: true })).toBeVisible();
    await chart.focus(); await page.keyboard.press("Control+2"); await expect(news).toBeFocused();
    const popupPromise = page.waitForEvent("popup"); await news.getByRole("button", { name: "Pop out to new window", exact: true }).click(); const popup = await popupPromise; await popup.waitForURL("**/equity/launchpad/popout?**"); expect(new URL(popup.url()).searchParams.get("type")).toBe("news-feed"); expect(new URL(popup.url()).searchParams.get("linkGroup")).toBe("blue"); await expect(popup.getByText(`${newsTitle} · edited`, { exact: true })).toBeVisible(); await popup.close();
    await main.getByRole("button", { name: "Add panel", exact: true }).click(); const picker = page.getByRole("dialog", { name: "Add Launchpad panel", exact: true }); await picker.getByRole("textbox", { name: "Find a panel", exact: true }).fill("no-such-panel"); await expect(picker.getByText("No matching panels.", { exact: true })).toBeVisible(); await picker.getByRole("textbox", { name: "Find a panel", exact: true }).fill("watchlist heatmap"); await bounded(page); await page.screenshot({ path: testInfo.outputPath("launchpad-picker.png"), fullPage: true, animations: "disabled" }); await picker.getByRole("button", { name: "watchlist heatmap", exact: true }).click(); await expect(main.getByTestId("launchpad-panel-frame")).toHaveCount(6); const heatmap = main.locator('[data-launchpad-panel-type="watchlist-heatmap"]'); await heatmap.scrollIntoViewIfNeeded(); await expect(heatmap.getByRole("combobox", { name: "Heatmap watchlist", exact: true })).toHaveValue("watchlist"); await expect.poll(async () => Number(await heatmap.locator("svg.block[width]").first().getAttribute("width"))).toBeGreaterThan(100); await bounded(page);
    await main.getByRole("button", { name: "Templates", exact: true }).click(); const gallery = page.getByRole("dialog", { name: "Workspace Templates", exact: true }); await gallery.getByTestId("workspace-template-save-current").click(); await gallery.getByTestId("workspace-template-name-input").fill(layoutName); await gallery.getByTestId("workspace-template-description-input").fill("A long reusable description of independently linked panels and dated research sources."); await gallery.getByTestId("workspace-template-save-submit").click(); await expect(gallery.getByText(layoutName, { exact: true })).toBeVisible(); await bounded(page); await page.screenshot({ path: testInfo.outputPath("launchpad-templates.png"), fullPage: true, animations: "disabled" }); await page.keyboard.press("Escape");
    await main.getByText("Layout controls and linking", { exact: true, selector: "summary" }).click(); await main.getByRole("textbox", { name: "Layout name", exact: true }).fill("Reviewed workspace"); await main.getByRole("button", { name: "Rename layout", exact: true }).click(); await expect(main.getByRole("combobox", { name: "Launchpad layout", exact: true })).toContainText("Reviewed workspace"); expect(errors).toEqual([]);
  });
}
test("@smoke Launchpad preserves saved geometry across viewport changes and saves only an actual resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 }); const writes = await fixture(page); await page.goto("/equity/launchpad"); await expect(page.getByTestId("launchpad-panel-frame")).toHaveCount(5); const before = await geometry(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(page.locator('[data-launchpad-grid-mode="arrange"]')).toBeVisible(); expect(await geometry(page)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 1000 }); await expect(page.locator('[data-launchpad-grid-mode="stacked"]')).toBeVisible(); expect(await geometry(page)).toEqual(before); await expect.poll(() => writes.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(page.locator('[data-launchpad-grid-mode="arrange"]')).toBeVisible();
  const handle = page.locator('.react-grid-item').first().locator('.react-resizable-handle').first(); await handle.evaluate(el => el.scrollIntoView({ block: "center" })); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => geometry(page)).not.toEqual(before);
});
test("@smoke Launchpad stacked plots and panel editor remain usable at native 200% Chrome zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "launchpad-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "launchpad-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/launchpad`); const first = page.getByTestId("launchpad-panel-frame").first(); await first.scrollIntoViewIfNeeded(); await expect(first.locator("canvas").first()).toBeVisible(); await first.getByRole("button", { name: "Panel settings", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("textbox", { name: "Panel title", exact: true })).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1); await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("launchpad-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
