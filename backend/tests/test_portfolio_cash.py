"""Cash ledger — the v1.1 portfolio spine.

Cash is derived from ``starting_cash`` + the signed impact of every transaction;
it is never a stored balance that can drift from the trades. These tests pin the
sign conventions (buy debits, sell/dividend/deposit credit, withdrawal debits,
fees always cost cash) and verify the ledger surfaces through the API.
"""
from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.main import app
from backend.services.portfolio_cash import cash_balance, cash_delta


def _tx(type_: str, shares: float = 0.0, price: float = 0.0, fees: float = 0.0) -> SimpleNamespace:
    return SimpleNamespace(type=type_, shares=shares, price=price, fees=fees)


def test_cash_delta_signs() -> None:
    assert cash_delta("buy", shares=10, price=100, fees=5) == -1005.0
    assert cash_delta("sell", shares=10, price=100, fees=5) == 995.0
    assert cash_delta("dividend", price=42, fees=0) == 42.0
    assert cash_delta("deposit", price=1000) == 1000.0
    assert cash_delta("withdrawal", price=250, fees=1) == -251.0


def test_cash_delta_unknown_type_is_inert() -> None:
    # A stray/unknown row must never silently invent cash.
    assert cash_delta("mystery", shares=10, price=100) == 0.0
    assert cash_delta("", price=100) == 0.0


def test_cash_balance_accumulates_ledger() -> None:
    txns = [
        _tx("deposit", price=10_000),
        _tx("buy", shares=10, price=200, fees=1),  # -2001
        _tx("sell", shares=4, price=250, fees=1),  # +999
        _tx("dividend", price=30),  # +30
        _tx("withdrawal", price=500),  # -500
    ]
    # 5000 (start) + 10000 - 2001 + 999 + 30 - 500 = 13528
    assert cash_balance(5_000, txns) == 13_528.0


def test_cash_balance_empty_is_opening() -> None:
    assert cash_balance(2_500, []) == 2_500.0
    assert cash_balance(0, []) == 0.0


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-cash-12345"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_portfolio_cash_balance_reflects_transactions() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "cash-ledger@example.com")

    created = client.post(
        "/api/portfolios",
        headers=headers,
        json={"name": "Cash Spine", "starting_cash": 10_000, "currency": "USD"},
    )
    assert created.status_code == 200, created.text
    pid = created.json()["id"]

    # Opening balance == starting_cash, no transactions yet.
    detail = client.get(f"/api/portfolios/{pid}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["cash_balance"] == 10_000.0

    # A buy debits cash (shares * price + fees).
    buy = client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"symbol": "AAPL", "type": "buy", "shares": 10, "price": 150, "date": "2026-01-05", "fees": 2},
    )
    assert buy.status_code == 200, buy.text
    assert client.get(f"/api/portfolios/{pid}", headers=headers).json()["cash_balance"] == 10_000 - 1502

    # A deposit credits cash without a symbol.
    dep = client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"type": "deposit", "price": 5_000, "date": "2026-01-06"},
    )
    assert dep.status_code == 200, dep.text
    assert client.get(f"/api/portfolios/{pid}", headers=headers).json()["cash_balance"] == 10_000 - 1502 + 5_000

    # A dividend credits cash; a sell credits proceeds net of fees.
    client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"symbol": "AAPL", "type": "dividend", "price": 12, "date": "2026-02-01"},
    )
    client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"symbol": "AAPL", "type": "sell", "shares": 4, "price": 160, "date": "2026-02-02", "fees": 1},
    )
    expected = 10_000 - 1502 + 5_000 + 12 + (4 * 160 - 1)
    assert client.get(f"/api/portfolios/{pid}", headers=headers).json()["cash_balance"] == expected


def test_deposit_requires_positive_amount() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "cash-guard@example.com")
    pid = client.post(
        "/api/portfolios", headers=headers, json={"name": "Guard", "starting_cash": 0}
    ).json()["id"]

    bad = client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"type": "deposit", "price": 0, "date": "2026-01-01"},
    )
    assert bad.status_code == 422

    bad_symbol = client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"type": "buy", "shares": 1, "price": 10, "date": "2026-01-01"},
    )
    assert bad_symbol.status_code == 422
