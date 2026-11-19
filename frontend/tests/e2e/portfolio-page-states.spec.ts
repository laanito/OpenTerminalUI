import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke Portfolio distinguishes pending, failed, partial and empty scope at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const portfolios = [{ id: "p1", name: "Core · long-term multi-market research", currency: "USD", benchmark_symbol: "SPY" }, { id: "p2", name: "Europe · separately recorded positions", currency: "EUR", benchmark_symbol: "SPY" }];
    let pendingRelease: (() => void) | undefined;
    let mode: "initial" | "failed" | "empty" | "partial" = "initial";
    const p2Requests: string[] = [];
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/portfolios") return route.fulfill({ json: { items: portfolios } });
      if (path.endsWith("/holdings")) {
        if (path.includes("/p2/")) {
          p2Requests.push(path);
          if (mode === "initial") { await new Promise<void>(resolve => { pendingRelease = resolve; }); return route.fulfill({ status: 503, json: { detail: "Selected portfolio holdings unavailable" } }); }
          if (mode === "failed") return route.fulfill({ status: 503, json: { detail: "Selected portfolio holdings unavailable" } });
          return route.fulfill({ json: { items: [] } });
        }
        return route.fulfill({ json: { items: [{ id: "h1", symbol: "AAPL", shares: 2, current_price: 200, currency: "USD", cost_basis_per_share: 180, cost_basis_currency: "USD", purchase_date: "2026-10-01" }] } });
      }
      if (path.endsWith("/analytics")) return route.fulfill({ json: { total_value: 0, net_liquidation_value: mode === "partial" ? null : 0, cash_balance: 0, unrealized_pnl: 0, realized_pnl: 0, allocation_by_sector: [], accounting: { status: mode === "partial" ? "partial" : "complete", base_currency: path.includes("/p2/") ? "EUR" : "USD", holdings: [], transactions: [], issues: [], degraded_reasons: mode === "partial" ? ["Historical FX is unavailable"] : [] } } });
      if (path.includes("/analytics/") || path.endsWith("/attribution")) return route.fulfill({ status: 503, json: { detail: "Synthetic unavailable optional analytics" } });
      await route.fulfill({ json: { items: [], quotes: [], results: [] } });
    });
    await page.goto("/equity/portfolio");
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected portfolio details", exact: true })).toBeVisible();
    const scope = page.getByRole("region", { name: "Portfolio scope", exact: true });
    await expect(scope).toContainText("Core"); await expect(scope).toContainText("USD");
    await page.getByRole("button", { name: /^Europe ·/ }).click();
    await expect(scope).toContainText("Europe");
    await expect(page.getByRole("status", { name: "Loading portfolio", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected portfolio details", exact: true })).toHaveCount(0);
    await expect.poll(() => !!pendingRelease).toBe(true);
    mode = "failed"; pendingRelease!();
    await expect(page.getByRole("alert", { name: "Portfolio unavailable", exact: true })).toContainText("No previous figures are shown");
    await expect(page.getByText("Net Liquidation", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status", { name: "No holdings in this portfolio", exact: true })).toHaveCount(0);
    mode = "empty";
    await page.getByRole("button", { name: "Retry portfolio load", exact: true }).click();
    const details = page.getByRole("region", { name: "Selected portfolio details", exact: true });
    await expect(details).toBeVisible(); await expect(scope).toContainText("EUR");
    await expect(page.getByRole("status", { name: "No holdings in this portfolio", exact: true })).toContainText("cash and transactions can still exist");
    const cash = details.getByText("Cash", { exact: true }).locator("..");
    await expect(cash).toContainText("0"); await expect(cash).not.toContainText("Needs FX");
    mode = "partial";
    await page.getByRole("button", { name: "Refresh portfolios", exact: true }).click();
    await expect(page.getByRole("status", { name: "Portfolio accounting incomplete", exact: true })).toContainText("Historical FX is unavailable");
    await expect(details.getByText("Net Liquidation", { exact: true }).locator("..")).toContainText("Needs FX");
    expect(p2Requests).toHaveLength(3);
    await expect(page.getByRole("button", { name: "Add Portfolio", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("group", { name: "Portfolio view", exact: true }).getByRole("button", { name: "Mutual Funds", exact: true }).click();
    await expect(page).toHaveURL(/mode=mutual_funds/);
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true, level: 1 })).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("group", { name: "Portfolio view", exact: true }).getByRole("button", { name: "Mutual Funds", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
}
