import { expect, test } from "@playwright/test";
import { portfolioReportFixture } from "./portfolio-fixtures";

for (const width of [1440, 390]) {
  test(`@smoke consolidated holdings, scope currency, lot sale and safe retry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
    const reports: string[] = [], writes: Record<string, any>[] = [];
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/portfolios/report") {
        reports.push(url.search);
        return route.fulfill({ json: portfolioReportFixture(url.searchParams.get("portfolio_id") || "all", url.searchParams.get("reporting_currency") || "USD") });
      }
      if (url.pathname.endsWith("/transactions") && route.request().method() === "POST") {
        expect(url.pathname).toBe("/api/portfolios/p2/transactions");
        writes.push(route.request().postDataJSON());
        if (writes.length === 1) return route.abort("failed");
        return route.fulfill({ json: { id: writes[1].operation_id, status: "created" } });
      }
      return route.fulfill({ json: { items: [], quotes: [], results: [] } });
    });
    await page.goto("/equity/portfolio?reporting_currency=USD");
    const holdings = page.getByRole("region", { name: "Consolidated holdings", exact: true });
    await expect(holdings).toContainText("5 units");
    await expect(holdings).toContainText("2 accounts");
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toContainText("$1,000.00");
    await expect(page.getByRole("textbox", { name: "Portfolio thesis", exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Add holding", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("consolidated-positions.png"), fullPage: true });
    await holdings.locator("summary").click();
    await expect(page.getByRole("region", { name: "AAPL lot in Core" })).toContainText("lot-p1");
    await page.getByRole("button", { name: "Sell AAPL in Europe" }).click();
    const dialog = page.getByRole("dialog", { name: "Record operation", exact: true });
    await expect(dialog.getByLabel("Target portfolio")).toHaveValue("p2");
    await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("3");
    await expect(dialog.getByLabel("Operation type")).toHaveValue("sell");
    await dialog.getByRole("button", { name: "Review operation" }).click();
    expect(writes).toHaveLength(0);
    await expect(dialog).toContainText("Sale targets the selected lot");
    await dialog.getByRole("button", { name: "Confirm operation" }).dblclick();
    await expect(dialog.getByRole("alert")).toContainText("not confirmed");
    expect(writes).toHaveLength(1);
    await dialog.getByRole("button", { name: "Retry same operation" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].operation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(writes[0]).toMatchObject({ type: "sell", shares: 3, lot_id: "lot-p2" });
    await expect(holdings).toBeVisible();
    await page.getByText("Choose portfolio scope", { exact: true }).click();
    await page.getByRole("button", { name: "Europe", exact: true }).click();
    await expect(page).toHaveURL(/portfolio=p2/);
    await expect(page.getByRole("combobox", { name: "Reporting currency" })).toHaveValue("EUR");
    await expect(holdings).toContainText("3 units");
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toContainText("€540.00");
    expect(reports.some(query => query.includes("portfolio_id=p2") && query.includes("reporting_currency=EUR"))).toBe(true);
    await page.reload(); await expect(holdings).toContainText("3 units");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`@smoke existing position is a reviewed non-cash opening at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: Record<string, any>[] = [];
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/portfolios/report") return route.fulfill({ json: portfolioReportFixture() });
      if (url.pathname.endsWith("/transactions") && route.request().method() === "POST") { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { id: writes[0].operation_id, status: "created" } }); }
      return route.fulfill({ json: { items: [], results: [] } });
    });
    await page.goto("/equity/portfolio");
    await page.getByRole("button", { name: "Add existing position", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add an existing position", exact: true });
    await dialog.getByLabel("Target portfolio").selectOption("p1");
    await dialog.getByLabel("Symbol", { exact: true }).fill("MSFT");
    await dialog.getByLabel("Quantity", { exact: true }).fill("2");
    await dialog.getByLabel("Documented cost per unit").fill("100");
    await dialog.getByLabel("Present in portfolio as of").fill("2026-11-10");
    await dialog.getByLabel("Documented acquisition date").fill("2026-01-02");
    await dialog.getByLabel("Acquisition source / provenance").fill("Broker statement");
    await dialog.getByLabel("Total contribution value at entry (optional)").fill("500");
    await page.screenshot({ path: testInfo.outputPath("opening-position-modal.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Review operation" }).click();
    await expect(dialog).toContainText("cash movement: 0");
    expect(writes).toHaveLength(0);
    await dialog.getByRole("button", { name: "Confirm operation" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ type: "opening", symbol: "MSFT", shares: 2, price: 100, fees: 0, date: "2026-11-10", opening: { acquisition_date: "2026-01-02", provenance: "Broker statement", contribution_value: 500 } });
  });
}

for (const width of [1440, 390]) {
  test(`@smoke incomplete totals, failed currency refresh and confirmed-result recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let failed = true, savedId = "", writes = 0;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/portfolios/report") {
        const currency = url.searchParams.get("reporting_currency") || "USD";
        if (currency === "EUR" && failed) return route.fulfill({ status: 503, json: { detail: "unavailable" } });
        const report = portfolioReportFixture("all", currency);
        if (currency === "USD") Object.assign(report.metrics.net_liquidation_value, { value: null, known_value: 333, complete_items: 1, total_items: 2, status: "partial" });
        return route.fulfill({ json: report });
      }
      if (url.pathname.endsWith("/transactions") && route.request().method() === "POST") {
        writes++; savedId = route.request().postDataJSON().operation_id; return route.abort("failed");
      }
      if (url.pathname.includes("/operations/")) { expect(url.pathname).toBe(`/api/portfolios/p1/operations/${savedId}`); return route.fulfill({ json: { id: savedId, status: "created", portfolio_id: "p1", type: "buy" } }); }
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto("/equity/portfolio?reporting_currency=USD");
    await expect(page.getByRole("region", { name: "Net value", exact: true })).toContainText("Unavailable");
    await expect(page.getByRole("region", { name: "Net value", exact: true })).toContainText("Known subtotal $333.00");
    await page.getByRole("combobox", { name: "Reporting currency" }).selectOption("EUR");
    await expect(page.getByRole("alert", { name: "Portfolio report unavailable" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Consolidated holdings", exact: true })).toHaveCount(0);
    failed = false;
    await page.getByRole("button", { name: "Retry report" }).click();
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toContainText("€900.00");
    await page.getByRole("button", { name: "Record operation", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Record operation", exact: true });
    await dialog.getByLabel("Target portfolio").selectOption("p1");
    await dialog.getByLabel("Symbol", { exact: true }).fill("AAPL");
    await dialog.getByLabel("Quantity", { exact: true }).fill("0.0000000001");
    await dialog.getByLabel("Unit price").fill("200");
    await dialog.getByRole("button", { name: "Review operation" }).click();
    await dialog.getByRole("button", { name: "Confirm operation" }).click();
    await expect(dialog.getByRole("alert")).toContainText("not confirmed");
    await dialog.getByRole("button", { name: "Check recorded result" }).click();
    await expect(dialog).toHaveCount(0); expect(writes).toBe(1);
  });
}

for (const width of [1440, 390]) {
  test(`@smoke unsupported quote units cannot silently become execution currency at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let writes = 0;
    await page.route("**/api/**", async route => {
      if (new URL(route.request().url()).pathname === "/api/portfolios/report") {
        const report = portfolioReportFixture("p1");
        report.positions[0].symbol = "VOD.L"; report.positions[0].quote_unit = "GBp";
        report.positions[0].lots[0].symbol = "VOD.L"; report.positions[0].lots[0].quote_unit = "GBp";
        return route.fulfill({ json: report });
      }
      if (route.request().method() === "POST") writes++;
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto("/equity/portfolio");
    const holdings = page.getByRole("region", { name: "Consolidated holdings", exact: true });
    await holdings.locator("summary").click();
    await page.getByRole("button", { name: "Sell VOD.L in Core" }).click();
    const dialog = page.getByRole("dialog", { name: "Record operation", exact: true });
    await expect(dialog).toContainText("Source quote unit: GBp");
    await expect(dialog.getByLabel("Price / amount currency")).toHaveValue("");
    await expect(dialog.getByLabel("Unit price")).toHaveValue("");
    await dialog.getByRole("button", { name: "Review operation" }).click();
    await expect(dialog.getByRole("region", { name: "Operation review" })).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
