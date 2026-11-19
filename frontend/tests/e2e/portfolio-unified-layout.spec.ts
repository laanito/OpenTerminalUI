import { expect, test } from "@playwright/test";
import { portfolioCatalog, portfolioReportFixture } from "./portfolio-fixtures";

for (const width of [1440, 390]) {
  test(`@smoke unified portfolio bar, allocation, movements and analysis at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const catalog = portfolioCatalog.map(p => ({ ...p }));
    const movementReads: string[] = [], reports: string[] = [], writes: string[] = [];
    let newPortfolio = false;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (path === "/api/portfolios" && route.request().method() === "POST") {
        writes.push(path);
        expect(route.request().postDataJSON()).toMatchObject({ name: "Macro", starting_cash: 0, description: "Long horizon mandate" });
        newPortfolio = true;
        return route.fulfill({ json: { id: "p3", name: "Macro" } });
      }
      if (path === "/api/portfolios") return route.fulfill({ json: { items: newPortfolio ? [...catalog, { id: "p3", name: "Macro", currency: "CHF" }] : catalog } });
      if (path === "/api/portfolios/report") {
        const id = url.searchParams.get("portfolio_id") || "all";
        reports.push(id);
        const result = portfolioReportFixture(id, url.searchParams.get("reporting_currency") || "USD");
        for (const member of result.portfolios) Object.assign(member.accounting, { transactions: [{ id: `tx-${member.portfolio_id}`, cash_delta_base: member.portfolio_id === "p1" ? 0 : -450 }] });
        return route.fulfill({ json: result });
      }
      if (path.endsWith("/transactions") && route.request().method() === "GET") {
        const id = path.includes("/p1/") ? "p1" : "p2"; movementReads.push(id);
        return route.fulfill({ json: { items: [{ id: `tx-${id}`, type: id === "p1" ? "opening" : "buy", symbol: "AAPL", shares: id === "p1" ? 2 : 3, price: 150, currency: "USD", fees: 0, date: "2026-11-10", notes: `Rationale ${id}` }] } });
      }
      if (path.endsWith("/holdings")) return route.fulfill({ json: { items: [{ id: "h1", symbol: "AAPL", shares: 2, cost_basis_per_share: 150, currency: "USD", cost_basis_currency: "USD" }] } });
      if (path.endsWith("/analytics")) return route.fulfill({ json: { allocation_by_sector: [], annualized_return: null } });
      if (path.includes("/analytics/") || path.endsWith("/attribution")) return route.fulfill({ status: 503, json: { detail: "Synthetic unavailable optional analytics" } });
      if (route.request().method() === "POST") writes.push(path);
      return route.fulfill({ json: { items: [], results: [] } });
    });
    await page.goto("/equity/portfolio?reporting_currency=USD");
    const scope = page.getByRole("region", { name: "Portfolio scope", exact: true });
    await expect(scope).toHaveCount(1);
    await expect(scope.getByRole("button", { name: "New portfolio", exact: true })).toBeEnabled();
    const allocations = page.getByRole("region", { name: "Holdings allocation" });
    await expect(allocations).toContainText("excludes cash");
    await expect(page.getByRole("region", { name: "Allocation by sector", exact: true })).toContainText("Technology");
    await expect(page.getByRole("region", { name: "Holdings by current value", exact: true })).toContainText("$1,000.00 · 100.0%");
    await expect(allocations.locator(".recharts-pie-sector")).toHaveCount(2);
    expect(movementReads).toHaveLength(0);
    await expect(page.getByRole("region", { name: "All movements table" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("unified-overview.png"), fullPage: true });
    await page.getByText("All movements", { exact: true }).click();
    const movements = page.getByRole("region", { name: "All movements table" });
    await expect(movements).toContainText("Rationale p1");
    await expect(movements).toContainText("Rationale p2");
    expect(movementReads.sort()).toEqual(["p1", "p2"]);
    await page.getByText("All movements", { exact: true }).click();
    await page.getByText("Choose portfolio scope", { exact: true }).click();
    await page.getByRole("button", { name: "Europe", exact: true }).click();
    await expect(scope).toContainText("Europe");
    await expect(page.getByRole("heading", { name: "Analysis · Europe", exact: true })).toBeVisible();
    await expect(page.getByText("AI Risk Assessment", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Holdings by current value", exact: true })).toContainText("€540.00");
    expect(movementReads).toHaveLength(2); // analysis did not open activity
    await scope.getByRole("button", { name: "New portfolio", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create portfolio", exact: true });
    await create.getByLabel("Portfolio name").fill("Macro");
    await create.getByLabel("Portfolio thesis").fill("Long horizon mandate");
    await expect(create.getByLabel("Starting cash")).toHaveValue("0");
    await create.getByRole("button", { name: "Create portfolio", exact: true }).click();
    await expect(create).toHaveCount(0);
    await expect(scope).toContainText("Europe");
    await expect(page).toHaveURL(/portfolio=p2/);
    await page.getByText("Choose portfolio scope", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Macro", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Core", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Analysis · Core", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/portfolio=p1/);
    await expect(page.getByText("Choose portfolio scope", { exact: true })).toBeFocused();
    expect(reports.at(-1)).toBe("p1");
    expect(writes).toEqual(["/api/portfolios"]); // showing analysis never generated AI
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("scoped-analysis.png"), fullPage: true });
  });
}
