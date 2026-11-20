import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { longAccount, longSymbol, portfolioAcceptanceRoutes, portfolioContrast } from "./portfolio-acceptance-fixtures";

async function bounded(page: Page, selector: string) {
  const checks = await page.locator(selector).evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    const rect = element.getBoundingClientRect();
    return { label: element.getAttribute("aria-label"), left: rect.left, right: rect.right, viewport: innerWidth, scroll: element.scrollWidth, client: element.clientWidth,
      valid: rect.left >= -1 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 2 };
  }));
  return checks.every(item => item.valid);
}
async function keyboardReview(page: Page) {
  const record = page.getByRole("button", { name: "Record operation", exact: true });
  await record.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record operation", exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close modal" });
  await expect(close).toBeFocused(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await dialog.getByLabel("Target portfolio").selectOption("p1");
  await dialog.getByLabel("Symbol", { exact: true }).fill("AAPL");
  await dialog.getByLabel("Quantity", { exact: true }).fill("0.000001");
  await dialog.getByLabel("Unit price", { exact: true }).fill("120");
  await dialog.getByRole("button", { name: "Review operation" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("region", { name: "Operation review" })).toContainText(longAccount);
  expect(await dialog.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; })).toBe(true);
  await page.keyboard.press("Escape"); await expect(record).toBeFocused();
}
for (const width of [1440, 1024, 390]) {
  test(`@smoke populated Portfolio keyboard, long content, scrolling and theme coverage at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await portfolioAcceptanceRoutes(page);
    await page.goto("/equity/portfolio?reporting_currency=USD");
    const holdings = page.getByRole("region", { name: "Consolidated holdings", exact: true });
    await expect(holdings).toContainText(longSymbol);
    expect(await bounded(page, '[aria-label="Portfolio scope"], [aria-label="Consolidated holdings"], [aria-label="Holdings allocation"]')).toBe(true);
    const chooser = page.getByText("Choose portfolio scope", { exact: true });
    await chooser.focus(); await page.keyboard.press("Enter");
    const account = page.getByRole("button", { name: longAccount, exact: true });
    expect(await account.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
    await page.keyboard.press("Escape"); await expect(chooser).toBeFocused();
    if (width === 1440) {
      await page.getByRole("button", { name: "Show Context Rail", exact: true }).click();
      await expect.poll(() => bounded(page, '[aria-label="Portfolio scope"], [aria-label="Consolidated holdings"]')).toBe(true);
      await page.getByRole("button", { name: "Hide Context Rail", exact: true }).click();
    }
    await keyboardReview(page);
    await holdings.locator("summary").first().focus(); await page.keyboard.press("Enter");
    const table = page.getByRole("grid", { name: "AAPL original lots" });
    await expect(table).toBeVisible();
    await table.focus(); await page.keyboard.press("End");
    const selected = table.getByRole("row", { selected: true });
    await expect(selected).toBeFocused(); await expect(selected).toContainText("lot-79");
    expect(await selected.evaluate(element => { const grid = element.closest('[role="grid"]')!; const r = element.getBoundingClientRect(), host = grid.getBoundingClientRect(); return r.top >= host.top && r.bottom <= host.bottom + 1 && r.height >= 44; })).toBe(true);
    const sell = selected.getByRole("button", { name: /^Sell AAPL/ });
    await sell.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByLabel("Quantity", { exact: true })).toHaveValue("0.0008");
    await page.keyboard.press("Escape"); await expect(sell).toBeFocused();
    await table.focus(); await page.keyboard.press("Home");
    await expect(table.getByRole("row", { selected: true })).toContainText("lot-0");
    await table.getByRole("button", { name: "Column menu for Quantity" }).click();
    await page.keyboard.press("Escape"); await expect(table.getByRole("button", { name: "Column menu for Quantity" })).toBeFocused();
    await page.getByRole("region", { name: "AAPL lots", exact: true }).getByRole("button", { name: /^Show Hidden/ }).click();
    await expect(table.getByRole("columnheader", { name: /Recorded position research/ })).toHaveCount(1);
    const darkContrast = await portfolioContrast(page);
    expect(darkContrast.filter(item => item.ratio < 4.5)).toEqual([]);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("region", { name: "AAPL lots", exact: true }).getByRole("button", { name: "CSV", exact: true }).click();
    const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv).toContain('"Recorded position research"'); expect(csv).toContain("https://example.test/");
    expect(csv.split("\n")).toHaveLength(81);
    await page.getByText("All movements", { exact: true }).click();
    const movements = page.getByRole("grid", { name: "Selected portfolio movements" });
    await movements.focus(); await page.keyboard.press("End"); await expect(movements.getByRole("row", { selected: true })).toBeFocused();
    await page.evaluate(() => document.documentElement.dataset.otTheme = "light-desk");
    expect(await table.evaluate(element => { const bg = getComputedStyle(element.querySelector('[role="row"]')!).backgroundColor; return bg !== 'rgb(26, 35, 50)'; })).toBe(true);
    expect(await bounded(page, '[aria-label="Portfolio scope"], [aria-label="All movements table"]')).toBe(true);
    const lightContrast = await portfolioContrast(page);
    expect(lightContrast.filter(item => item.ratio < 4.5)).toEqual([]);
    await writeFile(testInfo.outputPath("measured-label-contrast.json"), JSON.stringify({ dark_min: Math.min(...darkContrast.map(item => item.ratio)), light_min: Math.min(...lightContrast.map(item => item.ratio)), samples: { dark: darkContrast.length, light: lightContrast.length } }, null, 2));
    expect(await page.locator(".ot-app-shell").evaluate(element => [...element.querySelectorAll("*")].filter(node => getComputedStyle(node).animationName !== "none").every(node => parseFloat(getComputedStyle(node).animationDuration) <= .01))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("portfolio-acceptance-light.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => document.documentElement.dataset.otTheme = "classic-bloomberg");
    expect((await portfolioContrast(page)).filter(item => item.ratio < 4.5)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("@smoke Portfolio reflows under actual 200% Chrome browser zoom", async ({ playwright, baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "portfolio-zoom-"));
  await mkdir(join(profile, "Default"));
  // Chromium's native browser zoom preference, not CSS zoom or pinch emulation.
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } }, profile: { default_zoom_level: Math.log(2) / Math.log(1.2) } }));
  // Native profile zoom needs the full browser. Playwright's default headless
  // shell (used in CI without an executable override) does not apply this pref.
  // https://playwright.dev/docs/browsers#chromium-new-headless-mode
  const context = await playwright.chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ["--window-size=1440,1000", "--disable-gpu"], reducedMotion: "reduce" });
  try {
    await context.addInitScript(() => { const jwt = `x.${btoa(JSON.stringify({ sub: "zoom-audit", email: "zoom@example.test", exp: 4102444800, role: "trader" }))}.y`; localStorage.setItem("ot-access-token", jwt); localStorage.setItem("ot-refresh-token", jwt); });
    const page = await context.newPage(); await portfolioAcceptanceRoutes(page);
    await page.goto(`${baseURL}/equity/portfolio?reporting_currency=USD`);
    await expect(page.getByRole("region", { name: "Consolidated holdings", exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, browserWidth: outerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }));
    await testInfo.attach("native-zoom-observation", { body: JSON.stringify({ ...metrics, browserVersion: context.browser()?.version() }), contentType: "application/json" });
    expect(metrics.browserWidth / metrics.cssWidth).toBeCloseTo(2, 1); expect(metrics.visualScale).toBe(1);
    expect(await bounded(page, '[aria-label="Portfolio scope"], [aria-label="Consolidated holdings"]')).toBe(true);
    await keyboardReview(page);
    // Playwright's fullPage clip uses CSS dimensions at native zoom. Capture
    // the actual Chrome surface so the artifact does not crop the zoomed frame.
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(testInfo.outputPath("portfolio-browser-zoom-200.png"), Buffer.from(screenshot.data, "base64"));
    await writeFile(testInfo.outputPath("browser-zoom-metrics.json"), JSON.stringify(metrics, null, 2));
  } finally { await context.close(); }
});
