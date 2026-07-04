"""Deep analytics ported onto the per-user Manager portfolio.

The retired global `/api/portfolio/analytics/*` endpoints had richer analytics
(correlation, benchmark overlay, extended risk metrics, upcoming dividends) than
the Manager. These re-expose them per-user under `/api/portfolios/{id}/analytics/*`.
Offline (no market data) the service returns well-formed empty/zero structures,
which is what we assert here — plus that they're scoped to the owner.
"""
from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.api.routes.portfolios import _manager_holdings_as_legacy
from backend.main import app


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-analytics-12345"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _make_portfolio_with_holding(client: TestClient, headers: dict[str, str]) -> str:
    pid = client.post(
        "/api/portfolios", headers=headers, json={"name": "Analytics", "starting_cash": 10_000}
    ).json()["id"]
    client.post(
        f"/api/portfolios/{pid}/holdings",
        headers=headers,
        json={"symbol": "AAPL", "shares": 10, "cost_basis_per_share": 100, "purchase_date": "2025-01-02"},
    )
    return pid


def test_adapter_aggregates_lots_per_symbol_without_overwrite() -> None:
    # Two lots of one symbol must collapse into a single row with summed shares
    # and weighted-average cost -- NOT the last lot silently winning (the bug the
    # per-symbol aggregation exists to prevent for _portfolio_returns/overlay).
    holdings = [
        SimpleNamespace(symbol="AAPL", shares=10, cost_basis_per_share=100, purchase_date="2025-03-01"),
        SimpleNamespace(symbol="AAPL", shares=30, cost_basis_per_share=200, purchase_date="2025-01-15"),
        SimpleNamespace(symbol="msft", shares=5, cost_basis_per_share=50, purchase_date=""),
    ]
    adapted = {h.ticker: h for h in _manager_holdings_as_legacy(holdings)}
    assert set(adapted) == {"AAPL", "MSFT"}
    aapl = adapted["AAPL"]
    assert aapl.quantity == 40
    assert aapl.avg_buy_price == 175.0  # (10*100 + 30*200)/40
    assert aapl.buy_date == "2025-01-15"  # earliest lot


def test_analytics_endpoints_return_wellformed_shapes() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "analytics-shapes@example.com")
    pid = _make_portfolio_with_holding(client, headers)

    sector = client.get(f"/api/portfolios/{pid}/analytics/sector-allocation", headers=headers)
    assert sector.status_code == 200, sector.text
    assert set(sector.json()) >= {"total_value", "sectors", "industries"}

    risk = client.get(f"/api/portfolios/{pid}/analytics/risk-metrics", headers=headers)
    assert risk.status_code == 200, risk.text
    assert set(risk.json()) >= {
        "sharpe_ratio", "sortino_ratio", "max_drawdown", "beta", "alpha", "information_ratio",
    }

    corr = client.get(f"/api/portfolios/{pid}/analytics/correlation", headers=headers)
    assert corr.status_code == 200, corr.text
    assert set(corr.json()) >= {"symbols", "matrix", "rolling"}

    div = client.get(f"/api/portfolios/{pid}/analytics/dividends", headers=headers)
    assert div.status_code == 200, div.text
    assert set(div.json()) >= {"upcoming", "annual_income_projection"}

    overlay = client.get(f"/api/portfolios/{pid}/analytics/benchmark-overlay", headers=headers)
    assert overlay.status_code == 200, overlay.text
    assert set(overlay.json()) >= {"equity_curve", "alpha", "tracking_error", "benchmark"}


def test_primary_alias_resolves_for_analytics() -> None:
    # `/portfolios/primary/analytics/*` falls through to the {portfolio_id} routes
    # with the sentinel and resolves the caller's primary -- the id-free path the
    # dashboards use. Works even before the user has explicitly made a portfolio.
    client = TestClient(app)
    headers = _auth_headers(client, "analytics-primary@example.com")
    for suffix, keys in (
        ("risk-metrics", {"sharpe_ratio", "sortino_ratio"}),
        ("sector-allocation", {"total_value", "sectors"}),
        ("benchmark-overlay", {"equity_curve", "benchmark"}),
    ):
        resp = client.get(f"/api/portfolios/primary/analytics/{suffix}", headers=headers)
        assert resp.status_code == 200, f"{suffix}: {resp.status_code} {resp.text}"
        assert set(resp.json()) >= keys


def test_analytics_are_owner_scoped() -> None:
    client = TestClient(app)
    a = _auth_headers(client, "analytics-owner-a@example.com")
    b = _auth_headers(client, "analytics-owner-b@example.com")
    pid = _make_portfolio_with_holding(client, a)

    # User B cannot read user A's portfolio analytics.
    for suffix in ("sector-allocation", "risk-metrics", "correlation", "dividends", "benchmark-overlay"):
        resp = client.get(f"/api/portfolios/{pid}/analytics/{suffix}", headers=b)
        assert resp.status_code == 404, f"{suffix}: {resp.status_code} {resp.text}"
