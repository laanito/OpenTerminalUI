import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`@smoke Home shows honest reconstructed ledger history and clears failed refreshes at ${width}px`, async ({ page }) => {
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
      if (path.includes("/analytics/history")) {
        requested.push(path);
        if (mode === "failed") { await route.fulfill({ status: 503, json: { detail: "History unavailable" } }); return; }
        await route.fulfill({ json: { benchmark: "SPY", base_currency: "USD", status: mode === "partial" ? "partial" : "complete",
          methodology: "daily_ledger_reconstruction", issues: mode === "partial" ? [{ code: "ledger_price_or_fx_unavailable", symbol: "SAP.DE" }] : [],
          excluded_transactions: [{ id: "legacy-sale", symbol: "BTC-USD", date: "2026-07-27", shares: 2, reason: "legacy_unmatched_sale" }],
          opening_position_adjustments: [{ symbol: "BTC-USD", date: "2026-10-17", ledger_quantity: 1, opening_quantity: 2, quantity_delta: 1,
            basis: "current_holdings_minus_window_trades" }],
          degraded_reasons: [], equity_curve: mode === "old"
            ? [{ date: "2025-01-01", portfolio: 100, benchmark: 200, net_liquidation_value: 1000 }, { date: "2025-01-02", portfolio: 110, benchmark: 240, net_liquidation_value: 1500 }]
            : Array.from({ length: 30 }, (_, i) => ({
              date: new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10),
              portfolio: 100 + i * 10 / 29, benchmark: 200 + i * 40 / 29,
              benchmark_as_of: i >= 28 ? "2026-11-13" : new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10),
              net_liquidation_value: 1000 + i * 500 / 29, cash_balance: 500, holdings_value: 500 + i * 500 / 29,
              external_flow: i === 28 ? 400 : 0, price_dates: { "BTC-USD": new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10) },
            })),
          alpha: 0, tracking_error: 0 } }); return;
      }
      if (path.endsWith("/watchlists") || path.includes("/backtest/v1/presets")) { await route.fulfill({ json: [] }); return; }
      await route.fulfill({ json: { items: [], quotes: [], data: [], spot_price: null } });
    });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Primary portfolio historical comparison", exact: true });
    await expect(panel).toContainText("Approximate history");
    await expect(panel).toContainText("Primary portfolio · Long term");
    await expect(panel).toContainText("Includes closed positions while they were held");
    await expect(panel).toContainText("Portfolio (flow-adjusted) 110.00 index"); await expect(panel).toContainText("Benchmark (SPY) 120.00 index");
    await expect(panel).toContainText("Benchmark close used: 2026-11-13");
    await expect(panel).toContainText("Excluded legacy sale: BTC-USD · 2026-07-27 · 2 shares · transaction legacy-sale.");
    await expect(panel).toContainText("Estimated opening position: BTC-USD · 2026-10-17 · 2 shares (ledger: 1; adjustment: 1). No cash movement inferred.");
    await expect(panel).toContainText("2026-10-17 to 2026-11-15"); await expect(panel).not.toContainText("999999");
    const valueHistory = page.getByRole("img", { name: "Reconstructed daily portfolio value", exact: true });
    await expect(valueHistory).toBeVisible();
    await panel.getByText("Inspect reconstructed daily values", { exact: true }).click();
    const values = panel.getByRole("table", { name: "Reconstructed daily portfolio values" });
    await expect(values.getByRole("row")).toHaveCount(31);
    await expect(values).toContainText("2026-11-14");
    await expect(values).toContainText("BTC-USD: 2026-11-15");
    expect(requested).toEqual(["/api/portfolios/primary-real-id/analytics/history"]);
    const chart = panel.getByRole("group", { name: "Primary portfolio flow-adjusted comparison", exact: true });
    await chart.getByLabel("Primary portfolio flow-adjusted comparison interaction surface").focus();
    await page.keyboard.press("ArrowLeft"); await expect(chart.locator(".ot-home-widget-chart-tooltip-value")).toHaveText("109.66 index");
    await page.keyboard.press("ArrowRight"); await expect(chart.locator(".ot-home-widget-chart-tooltip-value")).toHaveText("110.00 index");
    const poll = async (nextMode: typeof mode) => {
      const previous = requested.length;
      mode = nextMode;
      // One interval callback is enough; do not replay every clock/animation tick.
      await page.clock.fastForward(30001);
      await expect.poll(() => requested.length).toBe(previous + 1);
    };
    await poll("failed");
    await expect(panel).toContainText("History unavailable"); await expect(panel).toContainText("No previous curve is shown");
    await expect(chart).toHaveCount(0); await expect(panel.locator("svg")).toHaveCount(0); await expect(valueHistory).toHaveCount(0);
    await poll("partial");
    await expect(panel).toContainText("Historical price or FX unavailable (SAP.DE)"); await expect(chart).toHaveCount(0);
    await poll("old");
    await expect(panel).toContainText("At least two daily observations"); await expect(chart).toHaveCount(0);
    await poll("valid");
    await expect(panel).toContainText("Approximate history"); await expect(panel).toContainText("Portfolio (flow-adjusted) 110.00 index");
    expect(requested).toHaveLength(5);
    await expect(panel).not.toContainText("Synced");
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}
