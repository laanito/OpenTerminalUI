import { expect, test } from "@playwright/test";

for (const [width, height] of [[1920, 1000], [1440, 1000], [1024, 768], [390, 800], [320, 700], [720, 500]]) {
  test(`@smoke shell controls, navigation and status remain reachable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ json: path.endsWith("/notes") || path.endsWith("/brain/memos") ? [] : { items: [], quotes: [], results: [], nyseStatus: "OPEN" } });
    });
    await page.goto("/equity/stocks/about");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();
    const withinViewport = async (selector: string) => page.locator(selector).evaluateAll(elements => elements.filter(element => element.getClientRects().length).every(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 2;
    }));
    expect(await withinViewport('[aria-label="Instrument toolbar"], [aria-label="Workspace controls"], [aria-label="Terminal status"]')).toBe(true);
    await menu.click();
    const navigation = page.getByRole("dialog", { name: "Navigate", exact: true });
    await expect(navigation).toBeVisible();
    expect(await navigation.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    await navigation.getByRole("link", { name: "Notes", exact: true }).focus();
    await page.keyboard.press("Control+g");
    expect(await navigation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Control+k");
    expect(await navigation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("m");
    await expect(page).toHaveURL(/\/equity\/stocks\/about$/);
    await page.keyboard.press("Escape");
    await expect(navigation).toHaveCount(0); await expect(menu).toBeFocused();
    await menu.click(); await navigation.getByRole("link", { name: "Notes", exact: true }).click();
    await expect(page).toHaveURL(/\/equity\/notes$/); await expect(navigation).toHaveCount(0);
    if (width < 1280) await page.getByRole("button", { name: /^Market controls/ }).click();
    const region = page.getByRole("combobox", { name: "Market region", exact: true });
    await expect(region).toBeVisible();
    await region.selectOption("EU"); await expect(page.getByRole("combobox", { name: "Exchange", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Display currency", exact: true }).selectOption("EUR");
    expect(await withinViewport('#shell-market-controls')).toBe(true);
    if (width < 1280) await page.getByRole("button", { name: /^Market controls/ }).click();
    if (width < 1280) await page.getByRole("button", { name: /^Workspace settings/ }).click();
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light-desk");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("light-desk");
    if (width < 1280) await page.getByRole("button", { name: /^Workspace settings/ }).click();
    if (width >= 1280) {
      await page.getByRole("button", { name: "Show Context Rail", exact: true }).click();
      await expect(page.getByRole("button", { name: "Hide Context Rail", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Hide Context Rail", exact: true }).click();
    }
    const statusButton = page.getByRole("button", { name: "Status details", exact: true });
    await statusButton.click();
    const status = page.getByRole("dialog", { name: "Terminal status details", exact: true });
    await expect(status).toContainText("NYSE"); await expect(status).toContainText("OPEN");
    await expect(status).toContainText("local browser diagnostics");
    await page.keyboard.press("Escape"); await expect(statusButton).toBeFocused();
    await page.keyboard.press("Control+g"); await expect(page.getByRole("combobox", { name: "Command bar", exact: true })).toBeFocused();
    await page.getByRole("combobox", { name: "Command bar", exact: true }).fill("WL"); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/equity\/watchlist$/);
    expect(await withinViewport('[aria-label="Instrument toolbar"], [aria-label="Workspace controls"], [aria-label="Terminal status"]')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
