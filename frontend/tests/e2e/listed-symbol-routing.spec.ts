import { expect, test } from "@playwright/test";

test("@smoke EUR-listed chart keeps its identity and authenticates under a stale crypto selection", async ({ page }) => {
  const charts: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("stock-state", JSON.stringify({ state: { ticker: "MWRE.DE", interval: "1m", range: "1mo" }, version: 0 }));
    localStorage.setItem("ui-settings", JSON.stringify({ state: { selectedCountry: "CRYPTO", selectedMarket: "CRYPTO", displayCurrency: "EUR" }, version: 0 }));
  });
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/chart/MWRE.DE") {
      charts.push(url.search);
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      expect(url.searchParams.get("market")).not.toBe("CRYPTO");
      const normalized = url.searchParams.get("normalized") === "true";
      return route.fulfill({ json: { symbol: "MWRE.DE", ticker: "MWRE.DE", currency: "EUR", interval: "1m", count: 90, data: Array.from({ length: 90 }, (_, index) => ({ t: (1795000000 + index * 60) * (normalized ? 1000 : 1), o: 10, h: 12, l: 9, c: 11, v: 25 })) } });
    }
    expect(url.pathname).not.toContain("MWRE.DE-USD");
    if (url.pathname === "/api/stocks/MWRE.DE") { expect(url.searchParams.get("market")).toBe("CRYPTO"); return route.fulfill({ json: { symbol: "MWRE.DE", ticker: "MWRE.DE", company_name: "EUR listing fixture", currency: "EUR", current_price: 11, country_code: "DE", exchange: "XETRA" } }); }
    if (url.pathname.endsWith("/stocks/MWRE.DE/scores")) return route.fulfill({ json: { piotroski_f_score: 7, altman_z_score: 4, graham_number: 10, peg_ratio: 2, magic_formula_rank: 10, fcf_yield_pct: 5, cash_conversion_cycle: 30, dupont_analysis: { profit_margin: .2, asset_turnover: 1, equity_multiplier: 2, roe: .4 }, cagr: { revenue_3y_pct: 5, profit_3y_pct: 6 }, dvm_score: { durability: 7, valuation: 6, momentum: 5, overall: 6, band: "Neutral" } } });
    if (url.pathname.endsWith("/performance")) return route.fulfill({ json: { period_changes_pct: { "1D": 1 }, day_range: { low: 9, high: 12 }, range_52w: { low: 8, high: 14 } } });
    if (url.pathname.endsWith("/quotes")) return route.fulfill({ json: { quotes: [{ symbol: "MWRE.DE", last: 11, change: 1, changePct: 10 }] } });
    return route.fulfill({ json: { items: [], results: [], quotes: [] } });
  });
  await page.goto("/equity/stocks");
  await expect(page.getByRole("region", { name: "MWRE.DE price chart", exact: true }).locator("canvas").first()).toBeVisible();
  await expect.poll(() => charts.length).toBeGreaterThan(0);
  expect(charts.some(query => new URLSearchParams(query).get("normalized") === "true")).toBe(true);
  // Explicit pagination keeps the legacy endpoint contract; it is not auth fallback.
  expect(charts.every(query => { const params = new URLSearchParams(query); return params.get("normalized") === "true" || params.has("limit") || params.has("cursor"); })).toBe(true);
});
