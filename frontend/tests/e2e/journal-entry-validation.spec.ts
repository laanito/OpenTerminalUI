import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test(`@smoke Journal cash entry derives fractional units, explains 422 and edits decimals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const entries: any[] = []; let posts = 0, updates = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method();
      if (path === "/api/journal" && method === "POST") {
        posts++; const payload = route.request().postDataJSON();
        expect(payload).toMatchObject({ symbol: "BTC-EUR", entry_price: 20000, exit_price: 21000, quantity: 0.0050125, fees: 0.125 });
        expect(payload.tradeAmount).toBeUndefined();
        if (posts === 1) return route.fulfill({ status: 422, json: { detail: [{ loc: ["body", "quantity"], msg: "Input should be a valid number", input: "DO NOT ECHO" }] } });
        const entry = { ...payload, id: 1, pnl: 4.8875, pnl_pct: 4.875 }; entries.push(entry);
        return route.fulfill({ json: { entry, status: "created" } });
      }
      if (path === "/api/journal/1" && method === "PUT") {
        updates++; const payload = route.request().postDataJSON(); expect(payload).toMatchObject({ quantity: 1e-8, fees: 1e-6, clear_exit: false });
        Object.assign(entries[0], payload); return route.fulfill({ json: { entry: entries[0], status: "updated" } });
      }
      if (path === "/api/journal") return route.fulfill({ json: { entries } });
      if (path.endsWith("/journal/stats")) return route.fulfill({ json: { total_trades: entries.length, by_strategy: [], by_day_of_week: [] } });
      return route.fulfill({ json: { items: [], points: [], days: [], results: [] } });
    });
    await page.goto("/equity/journal"); await page.getByRole("button", { name: "Add Trade", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Add Trade", exact: true });
    await form.getByRole("textbox", { name: "Symbol", exact: true }).fill("BTC-EUR");
    await expect(form).toContainText("Currency: EUR (from symbol)");
    await expect(form.getByRole("combobox", { name: "Trade size input", exact: true })).toHaveValue("cash");
    await form.getByLabel("Entry Date", { exact: true }).fill("2026-11-22T12:00");
    await form.getByRole("spinbutton", { name: /^Entry Price/ }).fill("20000");
    await form.getByRole("spinbutton", { name: /^Trade amount/ }).fill("100.25");
    await form.getByRole("spinbutton", { name: /^Fees \(EUR\)/ }).fill("0.125");
    expect(await form.getByRole("spinbutton", { name: /^Fees/ }).evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
    await expect(form.getByRole("status")).toContainText("0.0050125 asset units");
    await form.getByRole("spinbutton", { name: /^Exit Price/ }).fill("21000"); await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Provide both exit date and exit price"); expect(posts).toBe(0);
    await form.getByLabel("Exit Date", { exact: true }).fill("2026-11-22T14:00");
    await form.getByRole("button", { name: "Save", exact: true }).click(); await expect(form.getByRole("alert")).toContainText("Quantity: Input should be a valid number");
    await expect(form.getByRole("alert")).not.toContainText("DO NOT ECHO"); await expect(form.getByRole("spinbutton", { name: /^Trade amount/ })).toHaveValue("100.25");
    await form.getByRole("button", { name: "Save", exact: true }).click(); await expect(form).toHaveCount(0); expect(posts).toBe(2);
    const card = page.getByRole("article", { name: "BTC-EUR journal entry", exact: true }); await expect(card).toContainText("0.0050125");
    await card.getByRole("button", { name: "Review BTC-EUR entry", exact: true }).click(); await card.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit BTC-EUR", exact: true }); await expect(editor.getByRole("combobox", { name: "Trade size input", exact: true })).toHaveValue("units");
    await editor.getByRole("spinbutton", { name: /^Quantity/ }).fill("0.00000001"); await editor.getByRole("spinbutton", { name: /^Fees/ }).fill("0.000001");
    expect(await editor.getByRole("spinbutton", { name: /^Quantity/ }).evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click(); await expect(editor).toHaveCount(0); expect(updates).toBe(1);
  });
}
