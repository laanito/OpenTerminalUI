"""Portfolio APIs expose one shared base-currency accounting result."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.routes import portfolios as portfolio_routes
from backend.main import app


def _auth_headers(client: TestClient) -> dict[str, str]:
    password = "pw-accounting-routes-12345"
    email = f"accounting-{uuid4().hex[:10]}@example.com"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _install_market_contract(monkeypatch: pytest.MonkeyPatch, *, degraded: bool = False) -> None:
    async def quote(symbol: str) -> dict:
        assert symbol == "SAP.DE"
        return {
            "current_price": 120,
            "currency": "EUR",
            "change_pct": 2,
            "sector": "Technology",
            "exchange": "XETRA",
        }

    async def rate(source: str, target: str, requested_date: date | None = None) -> dict:
        assert target == "USD"
        rates = {
            ("EUR", date(2026, 1, 2)): 1.1,
            ("EUR", None): 1.2,
            ("GBP", date(2026, 1, 3)): 1.3,
        }
        selected = rates[(source, requested_date)]
        return {
            "base_currency": source,
            "quote_currency": target,
            "rate": selected,
            "rate_at": datetime(2026, 1, 3, tzinfo=timezone.utc),
            "requested_date": requested_date,
            "source": "test",
            "source_symbol": f"{source}{target}",
            "freshness": "stale" if degraded else "historical" if requested_date else "current",
            "cache_status": "stale" if degraded else "fresh",
            "degraded": degraded,
            "degraded_reason": "test stale cache" if degraded else None,
        }

    monkeypatch.setattr(portfolio_routes, "fetch_stock_snapshot_coalesced", quote)
    monkeypatch.setattr(portfolio_routes.forex_service, "get_valuation_rate", rate)


def test_list_detail_and_analytics_share_converted_totals(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_market_contract(monkeypatch)
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = client.post(
        "/api/portfolios",
        headers=headers,
        json={"name": "Mixed", "currency": "USD", "starting_cash": 1000},
    ).json()["id"]
    holding = client.post(
        f"/api/portfolios/{portfolio_id}/holdings",
        headers=headers,
        json={
            "symbol": "SAP.DE",
            "shares": 2,
            "cost_basis_per_share": 100,
            "currency": "EUR",
            "purchase_date": "2026-01-02",
        },
    )
    assert holding.status_code == 200, holding.text
    deposit = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=headers,
        json={"type": "deposit", "price": 500, "currency": "GBP", "date": "2026-01-03"},
    )
    assert deposit.status_code == 200, deposit.text

    detail = client.get(f"/api/portfolios/{portfolio_id}", headers=headers).json()
    listing = next(row for row in client.get("/api/portfolios", headers=headers).json()["items"] if row["id"] == portfolio_id)
    analytics = client.get(f"/api/portfolios/{portfolio_id}/analytics", headers=headers).json()

    expected = {
        "total_value": 288,
        "cash_balance": 1430,
        "net_liquidation_value": 1718,
    }
    for payload in (detail, listing, analytics):
        for key, value in expected.items():
            assert payload[key] == pytest.approx(value)
    assert detail["total_cost"] == pytest.approx(220)
    assert analytics["unrealized_pnl"] == pytest.approx(68)
    assert analytics["accounting"]["status"] == "complete"
    assert analytics["accounting"]["base_currency"] == "USD"
    assert analytics["accounting"]["holdings"][0]["market_value_native"] == {
        "amount": 240,
        "currency": "EUR",
    }
    assert listing["accounting"]["status"] == "complete"


def test_unknown_legacy_currency_is_partial_not_assumed_base(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_market_contract(monkeypatch)
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = client.post(
        "/api/portfolios",
        headers=headers,
        json={"name": "Legacy", "currency": "USD", "starting_cash": 1000},
    ).json()["id"]
    client.post(
        f"/api/portfolios/{portfolio_id}/holdings",
        headers=headers,
        json={"symbol": "SAP.DE", "shares": 1, "cost_basis_per_share": 100, "purchase_date": "2026-01-02"},
    )

    detail = client.get(f"/api/portfolios/{portfolio_id}", headers=headers).json()
    assert detail["accounting"]["status"] == "partial"
    assert detail["total_value"] == pytest.approx(144)
    assert detail["total_cost"] is None
    assert detail["cash_balance"] is None
    assert detail["net_liquidation_value"] is None
    assert {row["code"] for row in detail["accounting"]["issues"]} == {"currency_unknown"}


def test_stale_rates_keep_traceable_values_with_degraded_status(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_market_contract(monkeypatch, degraded=True)
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = client.post(
        "/api/portfolios",
        headers=headers,
        json={"name": "Stale", "currency": "USD", "starting_cash": 1000},
    ).json()["id"]
    client.post(
        f"/api/portfolios/{portfolio_id}/holdings",
        headers=headers,
        json={"symbol": "SAP.DE", "shares": 1, "cost_basis_per_share": 100, "currency": "EUR", "purchase_date": "2026-01-02"},
    )

    detail = client.get(f"/api/portfolios/{portfolio_id}", headers=headers).json()
    assert detail["accounting"]["status"] == "degraded"
    assert detail["total_value"] == pytest.approx(144)
    assert detail["accounting"]["issues"] == []
    assert detail["accounting"]["degraded_reasons"] == ["test stale cache"]
