export function portfolioReportFixture(scope = "all", currency = "USD") {
  const factor = currency === "EUR" ? .9 : 1;
  const metric = (value: number, unit = "lot") => ({ value, known_value: value, complete_items: scope === "all" ? 2 : 1, total_items: scope === "all" ? 2 : 1, unit, status: "complete" });
  const portfolios = [{ portfolio_id: "p1", name: "Core", portfolio_currency: "USD" }, { portfolio_id: "p2", name: "Europe", portfolio_currency: "EUR" }].filter(p => scope === "all" || p.portfolio_id === scope);
  const lots = portfolios.map(p => {
    const shares = p.portfolio_id === "p1" ? 2 : 3;
    const accounting = { id: `h-${p.portfolio_id}`, symbol: "AAPL", cost_basis_native: { amount: 150 * shares, currency: "USD" }, cost_basis_base: 150 * shares * factor, cost_basis_method: "holding_record", market_value_native: { amount: 200 * shares, currency: "USD" }, market_value_base: 200 * shares * factor, unrealized_pnl_base: 50 * shares * factor };
    return { portfolio_id: p.portfolio_id, portfolio_name: p.name, holding_id: accounting.id, lot_id: `lot-${p.portfolio_id}`, symbol: "AAPL", shares, purchase_date: "2026-01-02", cost_basis_per_share: 150, cost_basis_currency: "USD", notes: "Dated private thesis", exchange: "NASDAQ", quote_unit: "USD", current_price: 200, accounting };
  });
  const shares = lots.reduce((n, lot) => n + lot.shares, 0);
  const metrics = { market_value: metric(200 * shares * factor), cost_basis: metric(150 * shares * factor), unrealized_pnl: metric(50 * shares * factor), cash_balance: metric(300 * factor, "portfolio"), net_liquidation_value: metric((200 * shares + 300) * factor, "portfolio"), realized_pnl: metric(0, "portfolio"), fees: metric(0, "portfolio"), dividend_income_ytd: metric(0, "portfolio") };
  return {
    scope: scope === "all" ? "all_owned" : "selected", portfolio_ids: portfolios.map(p => p.portfolio_id), reporting_currency: currency, method: "native_dated_fx_by_portfolio_v1", as_of: "2026-11-19T10:00:00Z", status: "complete", assumptions: ["Quotes are retrieval observations.", "Starting cash uses its creation-date recording boundary."], degraded_reasons: [], metrics,
    positions: [{ symbol: "AAPL", exchange: "NASDAQ", quote_unit: "USD", identity_status: "exact_symbol_exchange_unit", identity_reason: null, shares, current_price: 200, portfolio_ids: portfolios.map(p => p.portfolio_id), metrics: { market_value: metrics.market_value, cost_basis: metrics.cost_basis, unrealized_pnl: metrics.unrealized_pnl }, lots }],
    portfolios: portfolios.map(p => ({ ...p, accounting: { base_currency: currency, status: "complete", as_of: "2026-11-19T10:00:00Z", issues: [], degraded_reasons: [], fx_rates: [], known_totals: {}, holdings: [], transactions: [] } })),
  };
}
