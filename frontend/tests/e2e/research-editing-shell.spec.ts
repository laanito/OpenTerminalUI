import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test(`@smoke Notes and Journal editing survive shared-shell shortcuts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let body = "Dated private research from a recorded source.";
    const entry = { id: 1, symbol: "AAPL", direction: "LONG", entry_date: "2026-11-01T12:00:00Z", entry_price: 100, quantity: 2,
      exit_price: null, exit_date: null, pnl: null, pnl_pct: null, fees: 0, strategy: "Long term", setup: "Review", emotion: "neutral", notes: "Journal rationale", tags: [], rating: 0 };
    let noteWrites = 0, journalWrites = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      if (path === "/api/notes/n1" && method === "PUT") { noteWrites++; body = route.request().postDataJSON().body; return route.fulfill({ json: { id: "n1", body, context: "general", tags: [] } }); }
      if (path === "/api/notes") return route.fulfill({ json: [{ id: "n1", body, context: "general", symbol: "AAPL", effective_at: "2026-11-01T12:00:00Z", created_at: "2026-11-02T12:00:00Z", updated_at: "2026-11-02T12:00:00Z", tags: [] }] });
      if (path === "/api/journal/1" && method === "PUT") { journalWrites++; Object.assign(entry, route.request().postDataJSON()); return route.fulfill({ json: { entry, status: "updated" } }); }
      if (path === "/api/journal") return route.fulfill({ json: { entries: [entry] } });
      if (path.endsWith("/journal/stats")) return route.fulfill({ json: { total_trades: 1, open_trades: 1, closed_trades: 0, win_rate: 0, avg_win_pct: 0, avg_loss_pct: 0, profit_factor: null, largest_win: 0, largest_loss: 0, expectancy: 0, current_streak: 0, best_streak: 0, worst_streak: 0, total_pnl: 0, avg_pnl: 0, by_strategy: [], by_day_of_week: [], by_emotion: [] } });
      return route.fulfill({ json: { items: [], results: [], quotes: [], points: [], days: [] } });
    });
    await page.goto("/equity/notes");
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.locator("textarea").last();
    await editor.fill("Updated dated private research."); await page.keyboard.type("m");
    await expect(editor).toBeFocused(); await expect(page).toHaveURL(/\/equity\/notes$/);
    // Explicit GO remains available outside a modal; inline draft text survives.
    await page.keyboard.press("Control+g");
    await expect(page.getByRole("combobox", { name: "Command bar", exact: true })).toBeFocused();
    await expect(editor).toHaveValue("Updated dated private research.m");
    await editor.fill("Updated dated private research.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Updated dated private research.", { exact: true })).toBeVisible(); expect(noteWrites).toBe(1);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("dialog", { name: "Navigate", exact: true }).getByRole("link", { name: "Journal", exact: true }).click();
    const card = page.getByTestId("journal-card");
    await card.focus(); await page.keyboard.press("Enter");
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit AAPL", exact: true });
    await dialog.locator("textarea").last().fill("Revised journal rationale.");
    await page.keyboard.press("Control+g"); await expect(dialog.locator("textarea").last()).toBeFocused();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(card).toContainText("Revised journal rationale."); expect(journalWrites).toBe(1);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog.locator("textarea").last().fill("Cancelled draft"); await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0); await expect(card.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    expect(journalWrites).toBe(1);
  });
}
