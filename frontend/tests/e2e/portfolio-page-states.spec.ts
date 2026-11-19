import { expect, test } from "@playwright/test";
import { portfolioCatalog, portfolioReportFixture } from "./portfolio-fixtures";

for (const width of [1440, 390]) {
  test(`@smoke Portfolio distinguishes pending, failed, partial and empty scope at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let release: (() => void) | undefined;
    let mode: "initial" | "failed" | "empty" | "partial" = "initial";
    const requests: string[] = [];
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/portfolios") return route.fulfill({ json: { items: portfolioCatalog } });
      if (url.pathname === "/api/portfolios/report") {
        const scope = url.searchParams.get("portfolio_id") || "all", currency = url.searchParams.get("reporting_currency") || "USD";
        requests.push(scope);
        if (scope === "p2" && mode === "initial") { await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ status: 503, json: { detail: "unavailable" } }); }
        if (scope === "p2" && mode === "failed") return route.fulfill({ status: 503, json: { detail: "unavailable" } });
        const report = portfolioReportFixture(scope, currency);
        if (scope === "p2") {
          report.positions = [];
          for (const metric of Object.values(report.metrics)) Object.assign(metric, { value: 0, known_value: 0 });
          report.portfolios.forEach(p => { p.accounting.allocation_by_sector = []; });
          if (mode === "partial") { report.status = "partial"; Object.assign(report.metrics.net_liquidation_value, { value: null, status: "unavailable" }); }
        }
        return route.fulfill({ json: report });
      }
      if (url.pathname.includes("/analytics")) return route.fulfill({ status: 503, json: { detail: "Synthetic unavailable analysis" } });
      return route.fulfill({ json: { items: [], results: [] } });
    });
    await page.goto("/equity/portfolio?reporting_currency=USD");
    const scope = page.getByRole("region", { name: "Portfolio scope", exact: true });
    await expect(scope).toContainText("All owned portfolios");
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toContainText("$1,000.00");
    await page.getByText("Choose portfolio scope", { exact: true }).click();
    await page.getByRole("button", { name: "Europe", exact: true }).click();
    await expect(scope).toContainText("Europe");
    await expect(page.getByRole("status", { name: "Loading portfolio report" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Holdings value", exact: true })).toHaveCount(0);
    await expect.poll(() => !!release).toBe(true); mode = "failed"; release!();
    await expect(page.getByRole("alert", { name: "Portfolio report unavailable", exact: true })).toContainText("No previous figures");
    await expect(page.getByRole("status", { name: "No open positions" })).toHaveCount(0);
    mode = "empty"; await page.getByRole("button", { name: "Retry report", exact: true }).click();
    await expect(page.getByRole("status", { name: "No open positions" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cash", exact: true })).toContainText("€0.00");
    mode = "partial"; await page.getByRole("button", { name: "Refresh report" }).click();
    await expect(page.getByRole("status", { name: "Portfolio report is incomplete" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Net value", exact: true })).toContainText("Unavailable");
    expect(requests.slice(1).every(id => id === "p2")).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Mutual Funds", exact: true }).click();
    await expect(page).toHaveURL(/mode=mutual_funds/); await page.reload();
    await expect(page.getByRole("button", { name: "Mutual Funds", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Portfolio", level: 1, exact: true })).toHaveCount(1);
  });
}
