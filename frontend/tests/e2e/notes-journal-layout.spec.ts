import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const strategy = "Long-term infrastructure demand with staged entries and a quarterly evidence review";
const rationale = "The thesis depends on dated guidance rather than today's price alone.\nReview allocation, valuation and contradictory evidence before changing exposure.";
async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  await page.routeWebSocket("**/*", socket => socket.close());
  const state = { noteWrites: 0, journalWrites: 0, failSave: false, failed: false, reviewCalls: 0 };
  const notes = [{ id: "n1", body: rationale, symbol: "AAPL", context: "brain_memo", ref_id: "saved-research", tags: [], effective_at: "2026-11-01T12:00:00Z", created_at: "2026-11-02T12:00:00Z", updated_at: "2026-11-02T12:00:00Z" }];
  const entries = [{ id: 1, symbol: "AAPL", direction: "LONG", entry_date: "2026-11-01T12:00:00Z", entry_price: 100, exit_price: 120, exit_date: "2026-11-20T12:00:00Z", quantity: 2, fees: 0, pnl: 40, pnl_pct: 20, strategy, setup: "Staged entry following guidance", emotion: "neutral", notes: rationale, tags: ["quarterly research and allocation review"], rating: 4 }];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (state.failed && (path === "/api/notes" || path.startsWith("/api/journal"))) return route.fulfill({ status: 503, json: { detail: "Research service unavailable" } });
    if (path === "/api/notes" && method === "POST") {
      const payload = route.request().postDataJSON(); state.noteWrites++;
      expect(payload).toMatchObject({ symbol: "BTC-USD", context: "general", body: "New dated research", effective_at: new Date("2026-11-19T12:30").toISOString() });
      const note = { ...notes[0], ...payload, id: "n2", ref_id: null }; notes.push(note); return route.fulfill({ json: note });
    }
    if (path === "/api/notes/n1" && method === "PUT") {
      const payload = route.request().postDataJSON(); state.noteWrites++;
      expect(payload).toEqual({ body: "Updated dated research", effective_at: null }); Object.assign(notes[0], payload); return route.fulfill({ json: notes[0] });
    }
    if (path === "/api/notes") return route.fulfill({ json: notes });
    if (path === "/api/journal/1" && method === "PUT") {
      state.journalWrites++;
      if (state.failSave) return route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } });
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({ symbol: "AAPL", direction: "LONG", quantity: 2, entry_price: 100, exit_price: 120, fees: 0, notes: "Revised journal rationale", rating: 5, clear_exit: false });
      Object.assign(entries[0], payload); return route.fulfill({ json: { entry: entries[0], status: "updated" } });
    }
    if (path === "/api/journal/gaps") { state.reviewCalls++; return route.fulfill({ json: { entries_needing_review: 0, total_entries: 1, complete_entries: 1, items: [] } }); }
    if (path === "/api/journal") return route.fulfill({ json: { entries } });
    if (path === "/api/journal/stats") return route.fulfill({ json: { total_trades: 1, win_rate: 100, total_pnl: 40, avg_pnl: 40, by_strategy: [{ strategy, count: 1, avg_pnl: 40 }], by_day_of_week: [{ day: "Fri", avg_pnl: 40 }] } });
    if (path === "/api/journal/equity-curve") return route.fulfill({ json: { points: [{ date: "2026-11-19", cumulative_pnl: 0 }, { date: "2026-11-20", cumulative_pnl: 40 }] } });
    if (path === "/api/journal/calendar") return route.fulfill({ json: { days: [{ date: "2026-11-20", pnl: 40, trade_count: 1 }] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  return state;
}
async function bounded(page: Page) {
  expect(await page.locator("main").last().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke Dated notes and journal review stay readable and editable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("/equity/notes");
    const notes = page.getByRole("main", { name: "Private notes", exact: true });
    const note = notes.getByRole("article").first();
    await expect(note.getByRole("link", { name: "Source memo" })).toHaveAttribute("href", "/equity/brain?memo=saved-research#brain-log");
    await expect(note).toContainText("Effective");
    expect(await notes.getByRole("textbox", { name: "New note", exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    await expect(page.getByRole("button", { name: "Load", exact: true })).toHaveCount(0);
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("notes.png"), fullPage: true });
    await notes.getByLabel("Symbol (optional)", { exact: true }).fill("btc-usd");
    await notes.getByLabel("New note", { exact: true }).fill("New dated research");
    await notes.getByLabel(/Effective date and time/).first().fill("2026-11-19T12:30");
    await notes.getByLabel("New note", { exact: true }).press("Control+Enter");
    await expect(notes.getByRole("status")).toContainText("indexing was queued");
    await note.getByRole("button", { name: "Edit", exact: true }).click();
    await note.getByLabel("Edit note").fill("Cancelled draft"); await note.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(state.noteWrites).toBe(1); await expect(note).toContainText("dated guidance");
    await note.getByRole("button", { name: "Edit", exact: true }).click();
    await note.getByLabel("Edit note").fill("Updated dated research"); await note.getByLabel(/Effective date and time/).fill("");
    await note.getByRole("button", { name: "Save", exact: true }).click(); await expect(note).toContainText("Updated dated research");
    await page.goto("/equity/journal");
    const main = page.getByRole("main", { name: "Trade Journal", exact: true });
    await expect(main.getByRole("button", { name: "Add Trade", exact: true })).toBeVisible();
    await expect(main.getByLabel("Through date", { exact: true })).toBeVisible();
    const card = main.getByRole("article", { name: "AAPL journal entry" });
    await card.getByRole("button", { name: "Review AAPL entry", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(card).toContainText(rationale.split("\n")[1]);
    expect(state.reviewCalls).toBe(0); await bounded(page);
    expect(await card.locator("span, button").evaluateAll(els => els.filter(el => el.getClientRects().length && el.textContent?.trim()).every(el => parseFloat(getComputedStyle(el).fontSize) >= 12 && el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("journal.png"), fullPage: true });
    await card.getByRole("button", { name: "Edit", exact: true }).focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit AAPL", exact: true });
    await dialog.getByLabel("Notes", { exact: true }).fill("Revised journal rationale");
    await dialog.getByRole("button", { name: "Rate 5 of 5", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "LONG", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("combobox", { name: "Strategy", exact: true })).toHaveValue(strategy);
    await expect(dialog.getByRole("textbox", { name: "Or enter a strategy", exact: true })).toHaveValue(strategy);
    await page.screenshot({ path: testInfo.outputPath("journal-editor.png"), fullPage: true });
    state.failSave = true; await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Your draft is still here");
    await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Revised journal rationale");
    state.failSave = false; await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(card.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await expect(card).toContainText("Revised journal rationale"); expect(state.journalWrites).toBe(2);
    await main.getByText("Journal completeness review", { exact: true }).click(); await main.getByRole("button", { name: "Review journal gaps" }).click();
    await expect(main).toContainText("No documentation gaps found."); expect(state.reviewCalls).toBe(1);
    await main.getByRole("tab", { name: "Analytics", exact: true }).click();
    await expect(main.getByRole("region", { name: "Daily journal results" })).toBeVisible(); await expect(main.getByText(strategy, { exact: true })).toBeVisible();
    await main.getByRole("region", { name: "Daily journal results" }).evaluate(el => el.scrollIntoView({ block: "center" }));
    await expect(main.getByRole("region", { name: "Daily journal results" }).getByLabel("2026-11-20: 1 trades, 40 PnL", { exact: true })).toBeInViewport();
    await main.getByText("Performance by Strategy", { exact: true }).evaluate(el => el.scrollIntoView({ block: "center" }));
    await bounded(page); await page.screenshot({ path: testInfo.outputPath("journal-analytics.png"), fullPage: true });
    await main.getByRole("tab", { name: "Tags", exact: true }).click();
    await expect(main.getByRole("combobox", { name: "Trade to tag", exact: true })).toBeVisible();
    await expect(main.getByRole("textbox", { name: "Rename tag quarterly research and allocation review", exact: true })).toBeVisible();
    await bounded(page); expect(errors).toEqual([]);
  });
}

test("@smoke Notes and Journal service failures remain explicit rather than empty or zero", async ({ page }) => {
  const state = await fixture(page); state.failed = true;
  await page.goto("/equity/notes"); await expect(page.getByRole("alert")).toContainText("Research service unavailable"); await expect(page.getByText("No notes yet.")).toHaveCount(0);
  state.failed = false; await page.getByRole("button", { name: "Retry", exact: true }).click(); await expect(page.getByRole("article")).toContainText("dated guidance");
  state.failed = true; await page.goto("/equity/journal");
  const main = page.getByRole("main", { name: "Trade Journal", exact: true });
  await expect(main.getByRole("alert")).toContainText("Journal entries unavailable"); await expect(main.getByText("No trades match the current filters.")).toHaveCount(0);
  await main.getByRole("tab", { name: "Analytics", exact: true }).click(); await expect(main).toContainText("Journal statistics unavailable");
  await expect(main.getByText("Total Trades", { exact: true })).toHaveCount(0); await expect(main).toContainText("Calendar unavailable"); await expect(main).toContainText("Equity history unavailable");
});

test("@smoke Notes and Journal reflow under actual 200% browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "notes-journal-zoom-")); await mkdir(join(profile, "Default"));
  const zoom = Math.log(2) / Math.log(1.2);
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: zoom } }, profile: { default_zoom_level: zoom } }));
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "notes-zoom", email: "zoom@example.test", exp: Date.parse("2026-11-22T12:00:00Z") / 1000, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await fixture(page); await page.goto(`${baseURL}/equity/notes`);
    await expect(page.getByLabel("New note", { exact: true })).toBeVisible(); await bounded(page);
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify(metrics), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    await page.goto(`${baseURL}/equity/journal`); await page.getByRole("button", { name: "Review AAPL entry", exact: true }).click();
    await bounded(page); await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit AAPL", exact: true }); await expect(dialog.getByLabel(/^Entry Price \(/)).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    const cdp = await context.newCDPSession(page), shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("notes-journal-native-zoom.png"), Buffer.from(shot.data, "base64"));
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  } finally { await context.close(); }
});
