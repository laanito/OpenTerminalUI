from __future__ import annotations

from backend.api.routes import portfolio


def test_portfolio_module_serves_watchlist_items_only() -> None:
    # The legacy global portfolio endpoints were removed in v1.1 (part C); this
    # module now only serves the watchlist-items feed. Per-user portfolios live
    # under /api/portfolios.
    paths = {route.path for route in portfolio.router.routes}
    assert "/watchlists/items" in paths
    assert all("/portfolio/holdings" not in p for p in paths)
    assert all("/portfolio/tax-lots" not in p for p in paths)
    assert all("/backtests" not in p for p in paths)


def test_portfolio_module_not_coupled_to_backtest_jobs() -> None:
    names = set(dir(portfolio))
    assert "get_backtest_job_service" not in names
