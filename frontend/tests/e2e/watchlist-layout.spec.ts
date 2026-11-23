import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const listName = "Long-term infrastructure and global technology research candidates";
const company = "International Automotive Infrastructure and Renewable Energy Research Holdings";
async function fixture(page: Page) {
  const state = { failed: false, failCreate: false, failAdd: false, creates: 0, adds: [] as unknown[], lists: [
    { id: "core", name: listName, symbols: ["AAPL", "MSFT", "MISSING"] },
    { id: "crypto", name: "Digital assets and alternative research", symbols: ["BTC-USD"] },
  ] };
  await page.routeWebSocket("**/api/ws/**", socket => socket.onMessage(message => {
    const request = JSON.parse(String(message)); if (request.op !== "subscribe") return;
    for (const token of request.symbols || []) if (!token.endsWith(":MISSING")) socket.send(JSON.stringify({ type: "tick", symbol: token, ltp: 125.25, change: 1.25, change_pct: 1.01, volume: 12345, ts: new Date().toISOString() }));
  }));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/watchlists" && request.method() === "GET") return state.failed ? route.fulfill({ status: 503, json: { detail: "Provider unavailable" } }) : route.fulfill({ json: state.lists });
    if (path === "/api/watchlists" && request.method() === "POST") {
      state.creates++; if (state.failCreate) return route.fulfill({ status: 400, json: { detail: "Name rejected" } });
      const list = { id: "new-list", name: request.postDataJSON().name, symbols: [] }; state.lists.push(list); return route.fulfill({ json: list });
    }
    if (path === "/api/watchlists/core/symbols" && request.method() === "POST") {
      state.adds.push(request.postDataJSON()); if (state.failAdd) return route.fulfill({ status: 503, json: { detail: "Write failed" } }); state.lists[0].symbols.push(...request.postDataJSON()); return route.fulfill({ json: state.lists[0] });
    }
    if (path === "/api/instruments/search") return route.fulfill({ json: { results: [{ display_symbol: "TSLA", name: company, exchange: "NASDAQ" }] } });
    if (path === "/api/notes") return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  const main = page.getByRole("main", { name: "Watchlist research", exact: true });
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await main.locator("input, select, textarea").evaluateAll(els => els.filter(el => el.getClientRects().length).every(el => el.getBoundingClientRect().right <= innerWidth + 1 && parseFloat(getComputedStyle(el).fontSize) >= 14))).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Watchlist readable scope, search, notes and responsive heatmap at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/equity/watchlist?name=${encodeURIComponent(listName)}`);
    const main = page.getByRole("main", { name: "Watchlist research", exact: true });
    const table = main.getByRole("region", { name: "Watchlist quotes", exact: true });
    await expect(table.getByText("AAPL", { exact: true })).toBeVisible(); await expect(table.getByText("125.25").first()).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "MISSING" })).not.toContainText("+0.00%");
    expect((await table.boundingBox())!.y).toBeLessThan(950); await bounded(page);
    await page.screenshot({ path: testInfo.outputPath("watchlist-quotes.png"), fullPage: true });
    await main.getByRole("combobox", { name: "Selected watchlist", exact: true }).selectOption("crypto");
    await expect(table.getByText("BTC-USD", { exact: true })).toBeVisible(); expect(new URL(page.url()).searchParams.has("name")).toBe(false);
    await main.getByRole("combobox", { name: "Selected watchlist", exact: true }).selectOption("core");
    await main.getByRole("button", { name: "Add to Watchlist", exact: true }).click();
    const search = main.getByRole("combobox", { name: "Find a symbol to add", exact: true }); await expect(search).toBeFocused(); await search.fill("TSLA");
    await expect(main.getByRole("listbox").getByText(company, { exact: true })).toBeVisible(); await bounded(page);
    if (width === 1440) {
      state.failAdd = true; await main.getByRole("listbox").getByRole("option").click();
      await expect(main.getByRole("alert")).toContainText("Check the list before retrying manually"); await expect(search).toHaveValue("TSLA"); expect(state.adds).toHaveLength(1);
      state.failAdd = false; await search.focus(); await page.keyboard.press("Enter");
      await expect.poll(() => state.adds.length).toBe(2);
    } else { await main.getByRole("listbox").getByRole("option").click(); await expect.poll(() => state.adds.length).toBe(1); }
    expect(state.adds[0]).toEqual(["TSLA"]);
    await expect(table.getByText("TSLA", { exact: true })).toBeVisible();
    const notes = main.getByRole("button", { name: "Notes for AAPL", exact: true }); await notes.focus(); await page.keyboard.press("Enter");
    const research = main.getByRole("region", { name: "Research notes for AAPL", exact: true }); await expect(research).toBeFocused();
    await expect(research.getByRole("textbox").first()).toBeVisible(); await bounded(page);
    await page.screenshot({ path: testInfo.outputPath("watchlist-notes.png"), fullPage: true });
    await main.getByRole("button", { name: "Close research notes", exact: true }).click(); await expect(notes).toBeFocused();
    await main.getByRole("combobox", { name: "Watchlist view", exact: true }).selectOption("heatmap");
    await expect(main.getByText("3 / 4 symbols with received quotes.", { exact: false })).toBeVisible();
    const heatmap = main.locator('[aria-label="Watchlist heatmap"]'); await expect(heatmap.getByRole("link")).toHaveCount(3); await bounded(page);
    expect(await heatmap.evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    await heatmap.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("watchlist-heatmap.png"), fullPage: true });
    await heatmap.getByRole("link", { name: "Open AAPL chart · 1.01%", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/equity\/stocks\?ticker=AAPL/); expect(errors).toEqual([]);
  });
}
test("@smoke Watchlist distinguishes failed reads and preserves a failed create draft for manual retry", async ({ page }) => {
  const state = await fixture(page); state.failed = true; await page.goto("/equity/watchlist");
  const main = page.getByRole("main", { name: "Watchlist research", exact: true }); await expect(main.getByRole("alert")).toContainText("Could not refresh watchlists");
  state.failed = false; await main.getByRole("button", { name: "Retry loading lists", exact: true }).click();
  await expect(main.getByRole("region", { name: "Watchlist quotes", exact: true }).getByText("AAPL", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Create watchlist", exact: true }).click(); await main.getByRole("textbox", { name: "Watchlist name", exact: true }).fill("New research list");
  state.failCreate = true; await main.getByRole("button", { name: "Save watchlist", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("draft is retained"); await expect(main.getByRole("textbox", { name: "Watchlist name", exact: true })).toHaveValue("New research list"); expect(state.creates).toBe(1);
  state.failCreate = false; await main.getByRole("button", { name: "Save watchlist", exact: true }).click();
  await expect(main.getByRole("combobox", { name: "Selected watchlist", exact: true })).toHaveValue("new-list");
  await expect(main.getByText("This watchlist has no symbols. Search above to add one.", { exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "Watchlist view", exact: true }).selectOption("heatmap"); await expect(main.getByText("No live quotes received for this list yet.", { exact: true })).toBeVisible();
});
test("@smoke Watchlist scope and heatmap reflow at actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "watchlist-zoom-")); await mkdir(join(profile, "Default")); const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "watchlist-zoom", email: "zoom@example.test", exp: Math.floor(Date.now() / 1000) + 3600, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/watchlist`);
    const main = page.getByRole("main", { name: "Watchlist research", exact: true }); await expect(main.getByRole("region", { name: "Watchlist quotes", exact: true }).getByText("AAPL", { exact: true })).toBeVisible();
    await main.getByRole("combobox", { name: "Watchlist view", exact: true }).selectOption("heatmap");
    await expect(main.locator('[aria-label="Watchlist heatmap"]').getByRole("link")).toHaveCount(2); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, visualScale: visualViewport?.scale })); expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(testInfo.outputPath("watchlist-native-zoom.png"), Buffer.from(shot.data, "base64"));
  } finally { await context.close(); }
});
