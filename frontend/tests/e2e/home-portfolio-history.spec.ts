import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke Home shows honest primary open-holdings history and clears failed refreshes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    // Pause before the app registers timers, so host speed cannot add polls.
    await page.clock.install({ time: new Date("2026-11-15T16:29:00Z") });
    await page.clock.pauseAt(new Date("2026-11-15T16:30:00Z"));
    let mode: "valid" | "failed" | "partial" | "old" = "valid";
    const requested: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/portfolios/primary")) {
        await route.fulfill({ json: { portfolio_id: "primary-real-id", portfolio_name: "Long term", portfolio_currency: "USD",
          items: [{ symbol: "BTC-USD", ticker: "BTC-USD", quantity: 2, current_value: 999999, currency: "USD" }],
          summary: { net_liquidation_value: 999999, total_cost: 800000, overall_pnl: 199999, day_change: 1, day_change_pct: 0.01 },
          accounting: { base_currency: "USD", status: "complete", issues: [], degraded_reasons: [], fx_rates: [] } } }); return;
      }
      if (path.includes("/analytics/benchmark-overlay")) {
        requested.push(path);
        if (mode === "failed") { await route.fulfill({ status: 503, json: { detail: "History unavailable" } }); return; }
        await route.fulfill({ json: { benchmark: "SPY", base_currency: "USD", status: mode === "partial" ? "partial" : "complete",
          methodology: "current_open_holdings_constant_quantity", issues: mode === "partial" ? [{ code: "fx_history_unavailable", symbol: "SAP.DE" }] : [],
          degraded_reasons: [], equity_curve: mode === "old"
            ? [{ date: "2025-01-01", portfolio: 1, benchmark: 1 }, { date: "2025-01-02", portfolio: 2, benchmark: 3 }]
            : [{ date: "2026-10-01", portfolio: 0.5, benchmark: 0.5 }, { date: "2026-10-17", portfolio: 1, benchmark: 2 }, { date: "2026-11-15", portfolio: 1.1, benchmark: 2.4 }],
          alpha: 0, tracking_error: 0 } }); return;
      }
      if (path.endsWith("/watchlists") || path.includes("/backtest/v1/presets")) { await route.fulfill({ json: [] }); return; }
      await route.fulfill({ json: { items: [], quotes: [], data: [], spot_price: null } });
    });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Primary portfolio historical comparison", exact: true });
    await expect(panel).toContainText("History available");
    await expect(panel).toContainText("Primary portfolio · Long term");
    await expect(panel).toContainText("excludes cash, closed positions and transaction-ledger returns");
    await expect(panel).toContainText("Open holdings 110.00 index"); await expect(panel).toContainText("Benchmark (SPY) 120.00 index");
    await expect(panel).toContainText("2026-10-17 to 2026-11-15"); await expect(panel).not.toContainText("999999");
    expect(requested).toEqual(["/api/portfolios/primary-real-id/analytics/benchmark-overlay"]);
    const chart = panel.getByRole("group", { name: "Primary open-holdings indexed comparison", exact: true });
    await chart.getByLabel("Primary open-holdings indexed comparison interaction surface").focus();
    await page.keyboard.press("ArrowLeft"); await expect(chart.locator(".ot-home-widget-chart-tooltip-value")).toHaveText("100.00 index");
    const poll = async (nextMode: typeof mode) => {
      const previous = requested.length;
      mode = nextMode;
      // One interval callback is enough; do not replay every clock/animation tick.
      await page.clock.fastForward(30001);
      await expect.poll(() => requested.length).toBe(previous + 1);
    };
    await poll("failed");
    await expect(panel).toContainText("History unavailable"); await expect(panel).toContainText("No previous curve is shown");
    await expect(chart).toHaveCount(0); await expect(panel.locator("svg")).toHaveCount(0);
    await poll("partial");
    await expect(panel).toContainText("Historical FX unavailable (SAP.DE)"); await expect(chart).toHaveCount(0);
    await poll("old");
    await expect(panel).toContainText("At least two shared observations"); await expect(chart).toHaveCount(0);
    await poll("valid");
    await expect(panel).toContainText("History available"); await expect(panel).toContainText("Open holdings 110.00 index");
    expect(requested).toHaveLength(5);
    await expect(panel).not.toContainText("Synced");
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}
