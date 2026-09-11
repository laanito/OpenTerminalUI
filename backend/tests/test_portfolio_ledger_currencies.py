"""Currency provenance for portfolio holdings and ledger rows."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from backend.main import app
from backend.models import PortfolioHoldingORM, PortfolioTransactionORM
from backend.shared.db import SessionLocal, engine, init_db


def _auth_headers(client: TestClient) -> dict[str, str]:
    init_db()
    password = "pw-ledger-currency-12345"
    email = f"ledger-currency-{uuid4().hex[:10]}@example.com"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _portfolio(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post(
        "/api/portfolios",
        headers=headers,
        json={"name": "Currency contract", "currency": "usd"},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_sqlite_startup_schema_has_nullable_currency_evidence() -> None:
    init_db()
    inspector = inspect(engine)
    holding_columns = {column["name"]: column for column in inspector.get_columns("portfolio_holdings")}
    transaction_columns = {column["name"]: column for column in inspector.get_columns("portfolio_transactions")}

    assert holding_columns["cost_basis_currency"]["nullable"] is True
    assert transaction_columns["currency"]["nullable"] is True
    assert transaction_columns["fees_currency"]["nullable"] is True


def test_holding_and_generated_buy_preserve_explicit_currency() -> None:
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = _portfolio(client, headers)

    response = client.post(
        f"/api/portfolios/{portfolio_id}/holdings",
        headers=headers,
        json={
            "symbol": "SAP.DE",
            "shares": 2,
            "cost_basis_per_share": 180,
            "currency": "eur",
            "purchase_date": "2026-09-01",
        },
    )

    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        holding = db.query(PortfolioHoldingORM).filter_by(portfolio_id=portfolio_id).one()
        transaction = db.query(PortfolioTransactionORM).filter_by(portfolio_id=portfolio_id).one()
        assert holding.cost_basis_currency == "EUR"
        assert transaction.currency == "EUR"
        assert transaction.fees_currency is None


def test_transaction_api_round_trips_amount_and_fee_currencies() -> None:
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = _portfolio(client, headers)

    created = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=headers,
        json={
            "type": "deposit",
            "price": 1000,
            "currency": "gbp",
            "fees": 2,
            "fees_currency": "eur",
            "date": "2026-09-02",
        },
    )
    assert created.status_code == 200, created.text

    items = client.get(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=headers,
    ).json()["items"]
    assert items[0]["currency"] == "GBP"
    assert items[0]["fees_currency"] == "EUR"


def test_omitted_legacy_currency_remains_unknown() -> None:
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = _portfolio(client, headers)

    response = client.post(
        f"/api/portfolios/{portfolio_id}/holdings",
        headers=headers,
        json={"symbol": "AAPL", "shares": 1, "cost_basis_per_share": 200},
    )
    assert response.status_code == 200, response.text

    with SessionLocal() as db:
        holding = db.query(PortfolioHoldingORM).filter_by(portfolio_id=portfolio_id).one()
        transaction = db.query(PortfolioTransactionORM).filter_by(portfolio_id=portfolio_id).one()
        assert holding.cost_basis_currency is None
        assert transaction.currency is None


def test_one_lot_cannot_mix_known_or_unknown_cost_currencies() -> None:
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = _portfolio(client, headers)
    url = f"/api/portfolios/{portfolio_id}/transactions"

    first = client.post(
        url,
        headers=headers,
        json={
            "type": "buy",
            "symbol": "AAPL",
            "shares": 1,
            "price": 100,
            "currency": "USD",
            "date": "2026-09-01",
            "lot_id": "lot-1",
        },
    )
    assert first.status_code == 200, first.text

    mixed = client.post(
        url,
        headers=headers,
        json={
            "type": "buy",
            "symbol": "AAPL",
            "shares": 1,
            "price": 90,
            "currency": "EUR",
            "date": "2026-09-02",
            "lot_id": "lot-1",
        },
    )
    assert mixed.status_code == 409
    assert "different or unknown currencies" in mixed.json()["detail"]
    with SessionLocal() as db:
        assert db.query(PortfolioTransactionORM).filter_by(portfolio_id=portfolio_id).count() == 1


def test_currency_codes_must_be_three_ascii_letters() -> None:
    client = TestClient(app)
    headers = _auth_headers(client)
    portfolio_id = _portfolio(client, headers)

    response = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=headers,
        json={
            "type": "deposit",
            "price": 100,
            "currency": "EURO",
            "date": "2026-09-02",
        },
    )
    assert response.status_code == 422
