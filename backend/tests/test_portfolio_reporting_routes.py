"""The consolidated read contract is authenticated, owner-scoped and non-mutating."""
from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.routes import portfolios as routes
from backend.main import app
from backend.models import PortfolioHoldingORM, PortfolioORM, PortfolioTransactionORM
from backend.shared.db import SessionLocal
from backend.tests.test_portfolio_accounting_routes import _auth_headers


@pytest.fixture
def market(monkeypatch):
    calls = []

    async def quote(symbol):
        calls.append(symbol)
        return {"current_price": 120, "currency": "EUR", "exchange": "XETRA"}

    async def rate(source, target, requested_date=None):
        return {"base_currency": source, "quote_currency": target,
                "rate": 1.1 if requested_date else 1.3,
                "rate_at": datetime(2026, 1, 2, tzinfo=timezone.utc),
                "requested_date": requested_date, "source": "test",
                "source_symbol": source + target,
                "freshness": "historical" if requested_date else "current",
                "cache_status": "fresh", "degraded": False, "degraded_reason": None}

    monkeypatch.setattr(routes, "fetch_stock_snapshot_coalesced", quote)
    monkeypatch.setattr(routes.forex_service, "get_valuation_rate", rate)
    return calls


def create(client, headers, name="Scope", currency="USD", cash=0):
    response = client.post("/api/portfolios", headers=headers, json={"name": name, "currency": currency, "starting_cash": cash})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def add(client, headers, portfolio, *, shares=1, symbol="SAP.DE", lot=""):
    response = client.post(f"/api/portfolios/{portfolio}/holdings", headers=headers, json={
        "symbol": symbol, "shares": shares, "cost_basis_per_share": 100,
        "currency": "EUR", "purchase_date": "2026-01-02", "lot_id": lot,
        "notes": "Original private lot research",
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_report_owner_scope_repeated_selection_and_no_writes(market):
    client = TestClient(app)
    owner, other = _auth_headers(client), _auth_headers(client)
    a = create(client, owner, "A", cash=1000)
    b = create(client, owner, "B", "EUR", cash=1000)
    foreign = create(client, other, "Secret")
    add(client, owner, a)
    add(client, owner, b, shares=2, lot="b-lot")
    add(client, other, foreign, symbol="SECRET")
    with SessionLocal() as db:
        before = (db.query(PortfolioORM).count(), db.query(PortfolioHoldingORM).count(), db.query(PortfolioTransactionORM).count())
    result = client.get("/api/portfolios/report?reporting_currency=USD", headers=owner)
    assert result.status_code == 200, result.text
    report = result.json()
    assert report["scope"] == "all_owned"
    assert set(report["portfolio_ids"]) == {a, b}
    assert report["reporting_currency"] == "USD"
    assert report["metrics"]["cost_basis"]["value"] == pytest.approx(330)
    assert report["metrics"]["market_value"]["value"] == pytest.approx(468)
    assert report["metrics"]["unrealized_pnl"]["value"] == pytest.approx(138)
    position, = report["positions"]
    assert set(position["portfolio_ids"]) == {a, b}
    assert len(position["lots"]) == 2
    assert all(lot["notes"] == "Original private lot research" for lot in position["lots"])
    assert market == ["SAP.DE"]  # one shared quote, never touch foreign symbols
    selected = client.get("/api/portfolios/report", headers=owner, params=[("reporting_currency", "EUR"), ("portfolio_id", a), ("portfolio_id", a)])
    assert selected.status_code == 200, selected.text
    assert selected.json()["scope"] == "selected"
    assert selected.json()["portfolio_ids"] == [a]
    assert selected.json()["metrics"]["unrealized_pnl"]["value"] == 20
    # Requesting another currency neither patches portfolio bases nor mutates lots/ledger.
    with SessionLocal() as db:
        assert before == (db.query(PortfolioORM).count(), db.query(PortfolioHoldingORM).count(), db.query(PortfolioTransactionORM).count())
        assert db.get(PortfolioORM, a).currency == "USD"
        assert db.get(PortfolioORM, b).currency == "EUR"
        assert db.query(PortfolioHoldingORM).filter_by(portfolio_id=a).one().cost_basis_currency == "EUR"


def test_foreign_missing_mixed_and_empty_ids_fail_before_market_reads(market):
    client = TestClient(app)
    owner, other = _auth_headers(client), _auth_headers(client)
    mine, foreign = create(client, owner), create(client, other)
    add(client, owner, mine)
    for requested in ([foreign], [str(uuid4())], [mine, foreign], [""]):
        response = client.get("/api/portfolios/report", headers=owner, params=[("reporting_currency", "USD"), *[("portfolio_id", id) for id in requested]])
        assert response.status_code == 404, response.text
        assert response.json() == {"detail": "Portfolio not found"}
    assert market == []


def test_auth_currency_validation_and_empty_owner_does_not_autocreate(market):
    client = TestClient(app)
    assert client.get("/api/portfolios/report?reporting_currency=USD").status_code == 401
    headers = _auth_headers(client)
    for params in ({}, {"reporting_currency": "usd"}, {"reporting_currency": "ZZZ"}, {"reporting_currency": "GBp"}):
        assert client.get("/api/portfolios/report", params=params, headers=headers).status_code == 422
    assert client.get("/api/portfolios/report", headers=headers, params=[("reporting_currency", "USD"), *[("portfolio_id", str(i)) for i in range(101)]]).status_code == 422
    body = client.get("/api/portfolios/report?reporting_currency=USD", headers=headers).json()
    assert body["portfolios"] == body["positions"] == body["portfolio_ids"] == []
    assert body["metrics"]["market_value"]["value"] == 0
    assert client.get("/api/portfolios", headers=headers).json()["items"] == []
    assert market == []


def test_provider_failure_produces_partial_report_instead_of_http_failure(market, monkeypatch):
    client = TestClient(app)
    headers = _auth_headers(client)
    id = create(client, headers, cash=1000)
    add(client, headers, id)

    async def failed(symbol):
        raise RuntimeError("upstream failed")

    monkeypatch.setattr(routes, "fetch_stock_snapshot_coalesced", failed)
    result = client.get("/api/portfolios/report?reporting_currency=USD", headers=headers)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["status"] == "partial"
    assert body["metrics"]["market_value"]["value"] is None
    assert body["metrics"]["cost_basis"]["value"] == pytest.approx(110)
    assert body["metrics"]["cash_balance"]["value"] == pytest.approx(890)
    assert body["metrics"]["net_liquidation_value"]["value"] is None
    assert body["portfolios"][0]["accounting"]["issues"][0]["code"] == "quote_unavailable"
