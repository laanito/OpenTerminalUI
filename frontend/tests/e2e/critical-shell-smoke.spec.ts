import { expect, test } from "@playwright/test";

test("@smoke authenticated shell exposes primary navigation and keyboard routing", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.goto("/equity/stocks/about", { waitUntil: "domcontentloaded" });

  const rail = page.getByRole("complementary", { name: "Primary icon rail" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link", { name: "Portfolio" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Journal" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Notes" })).toBeVisible();

  const goBar = page.getByPlaceholder(/Type ticker, command, or search/i);
  await expect(goBar).toBeVisible();
  await page.locator("body").click();
  await page.keyboard.press("Control+g");
  await expect(goBar).toBeFocused();
  await goBar.fill("WL");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/equity\/watchlist$/);
});
