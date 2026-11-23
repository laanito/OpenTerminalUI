import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const longName = "Global infrastructure and long-term semiconductor research workspace with dated comparison context";
async function fixture(page: Page) {
  const state = { failRead: false, failWrite: false, creates: [] as any[], renamed: [] as any[], scopes: [] as (string | null)[], removed: [] as string[], items: [
    { id: "portfolio", user_id: "fixture", name: longName, description: "Keep the full saved name, destination and description readable when returning to research across multiple markets and accounts.", scope: "portfolio", page: "/equity/portfolio", payload: { page: "/equity/portfolio", search: "?reporting_currency=EUR", selectedTicker: "SAP.DE", shellPreset: "quant", filters: { scope: "all" }, storage: { "ot:portfolio:view:v1": { scope: "all" } } }, created_at: "2026-11-23T10:00:00Z", updated_at: "2026-11-23T12:00:00Z" },
    { id: "screen", user_id: "fixture", name: "Quality and cash-flow screen", description: "A separate workflow scope remains accessible from the same library.", scope: "screener", page: "/equity/screener", payload: { page: "/equity/screener", filters: { query: "ROE > 20" } }, created_at: "2026-11-23T10:00:00Z", updated_at: "2026-11-23T12:00:00Z" },
  ] as any[] };
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/saved-views" && request.method() === "GET") {
      const scope = url.searchParams.get("scope"); state.scopes.push(scope);
      return state.failRead ? route.fulfill({ status: 503, json: { detail: "Unavailable" } }) : route.fulfill({ json: { items: state.items.filter(item => !scope || item.scope === scope) } });
    }
    if (url.pathname === "/api/saved-views" && request.method() === "POST") {
      state.creates.push(request.postDataJSON()); if (state.failWrite) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      const item = { ...state.items[0], ...request.postDataJSON(), id: "created", updated_at: "2026-11-23T13:00:00Z" }; state.items.push(item); return route.fulfill({ json: item });
    }
    if (url.pathname.startsWith("/api/saved-views/") && request.method() === "PATCH") {
      state.renamed.push(request.postDataJSON()); if (state.failWrite) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      const item = state.items.find(item => url.pathname.endsWith(`/${item.id}`)); Object.assign(item, request.postDataJSON()); return route.fulfill({ json: item });
    }
    if (url.pathname.startsWith("/api/saved-views/") && request.method() === "DELETE") { const id = url.pathname.split("/").pop()!; state.removed.push(id); state.items = state.items.filter(item => item.id !== id); return route.fulfill({ json: { status: "deleted" } }); }
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.getByRole("article").evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Saved Views shows readable scopes, retains drafts and restores captured state at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
    await page.goto("/equity/saved-views");
    const main = page.getByRole("main", { name: "Saved workspace views", exact: true });
    const card = main.getByRole("article", { name: longName, exact: true }); await expect(card).toBeVisible(); expect(state.scopes).toContain(null);
    await expect(main.getByRole("article", { name: "Quality and cash-flow screen", exact: true })).toBeVisible();
    await expect(card.getByRole("heading")).toHaveCSS("font-size", "14px"); await expect(card.locator("time")).toHaveAttribute("datetime", "2026-11-23T12:00:00Z");
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("saved-views-library.png"), fullPage: true });
    const rename = card.getByRole("button", { name: "Rename", exact: true }); await rename.focus(); await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Rename saved view", exact: true }); await expect(editor.getByRole("button", { name: "Close modal", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(editor.getByRole("button", { name: "Save name", exact: true })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(rename).toBeFocused(); await rename.click();
    await editor.getByRole("textbox", { name: "View name", exact: true }).fill("Revisited infrastructure thesis workspace");
    state.failWrite = true; await editor.getByRole("button", { name: "Save name", exact: true }).click(); await expect(editor.getByRole("alert")).toContainText("Your draft is still here"); expect(state.renamed).toHaveLength(1);
    await expect(editor.getByRole("textbox")).toHaveValue("Revisited infrastructure thesis workspace"); await page.screenshot({ path: testInfo.outputPath("saved-views-editor.png"), fullPage: true });
    state.failWrite = false; await editor.getByRole("button", { name: "Save name", exact: true }).click(); await expect(editor).toHaveCount(0);
    await expect(main.getByRole("region", { name: "Saved view library", exact: true })).toBeFocused();
    await expect(main.getByRole("article", { name: "Revisited infrastructure thesis workspace", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Save view", exact: true }).click();
    const save = page.getByRole("dialog", { name: "Save view", exact: true }); await save.getByRole("textbox", { name: "View name", exact: true }).fill("Current workspace setup"); await save.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(save).toHaveCount(0); expect(state.creates[0]).toMatchObject({ scope: "workspace", page: "/equity/saved-views", payload: { page: "/equity/saved-views" } });
    const saved = main.getByRole("article", { name: "Current workspace setup", exact: true }); await expect(saved).toBeVisible();
    page.once("dialog", dialog => dialog.accept()); await saved.getByRole("button", { name: "Delete", exact: true }).click(); await expect(saved).toHaveCount(0); expect(state.removed).toEqual(["created"]);
    await page.goto("/equity/screener"); await page.getByRole("button", { name: "Saved views", exact: true }).click();
    const shared = page.getByRole("dialog", { name: "Screener saved views", exact: true });
    const sharedRename = shared.getByRole("button", { name: "Rename", exact: true }); await sharedRename.click();
    await expect(page.getByRole("dialog", { name: "Rename saved view", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(sharedRename).toBeFocused(); await expect(shared).toBeVisible(); await bounded(page);
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Saved views", exact: true })).toBeFocused();
    await page.goto("/equity/saved-views");
    const restore = main.getByRole("article", { name: "Revisited infrastructure thesis workspace", exact: true });
    // Capture restoration just before the existing apply navigation/reload.
    await page.evaluate(() => window.addEventListener("ot:saved-view:apply", event => sessionStorage.setItem("saved-view-restored", JSON.stringify((event as CustomEvent).detail))));
    await restore.getByRole("button", { name: "Apply", exact: true }).click(); await expect(page).toHaveURL(/\/equity\/portfolio\?reporting_currency=EUR/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ot:saved-view:pending") || sessionStorage.getItem("saved-view-restored") || "{}"))).toMatchObject({ selectedTicker: "SAP.DE", filters: { scope: "all" } });
  });
}
test("@smoke Saved View retrieval failures remain distinct from empty and shared controls use a bounded dialog", async ({ page }) => {
  const state = await fixture(page); state.failRead = true; await page.goto("/equity/saved-views");
  const main = page.getByRole("main", { name: "Saved workspace views", exact: true }); await expect(main.getByRole("alert")).toContainText("Could not refresh saved views"); await expect(main.getByText(/^No saved views yet/)).toHaveCount(0);
  state.failRead = false; state.items = []; await main.getByRole("button", { name: "Refresh views", exact: true }).click(); await expect(main.getByText(/^No saved views yet/)).toBeVisible();
  state.items.push({ id: "screen", name: longName, scope: "screener", page: "/equity/screener", payload: { page: "/equity/screener" }, updated_at: "2026-11-23T12:00:00Z" });
  await page.goto("/equity/screener"); await page.getByRole("button", { name: "Saved views", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Screener saved views", exact: true }); await expect(modal.getByRole("article", { name: longName, exact: true })).toBeVisible(); expect(state.scopes).toContain("screener");
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Saved views", exact: true })).toBeFocused();
});
test("@smoke Saved View library and name editor reflow at actual 200% Chrome zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "views-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "views-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/saved-views`); await expect(page.getByRole("article", { name: longName, exact: true })).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    await page.getByRole("article", { name: longName, exact: true }).getByRole("button", { name: "Rename", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Rename saved view", exact: true }); await expect(editor.getByRole("textbox")).toBeVisible(); expect(await editor.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("saved-views-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
