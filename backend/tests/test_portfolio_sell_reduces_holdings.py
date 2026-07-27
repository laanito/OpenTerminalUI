"""Selling must actually reduce/remove holdings, not just move cash.

Regression: recording a sell defaulted its lot_id to the synthetic "manual" and
matched holdings on `lot_id == "manual"`, which never matched a real lot. So the
transaction was written (cash moved via the ledger) but the position was never
reduced — it stayed in the portfolio. Sells now consume the symbol's lots
oldest-first (or an explicit lot when given).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-sell-12345"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _holdings(client: TestClient, headers: dict[str, str], pid: str) -> list[dict]:
    return client.get(f"/api/portfolios/{pid}/holdings", headers=headers).json()["items"]


def _sell(client, headers, pid, symbol, shares, price):
    return client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"type": "sell", "symbol": symbol, "shares": shares, "price": price, "date": "2026-07-12"},
    )


def test_full_sell_removes_the_position() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "sell-full@example.com")
    pid = client.post("/api/portfolios", headers=headers, json={"name": "S", "starting_cash": 100000}).json()["id"]
    client.post(
        f"/api/portfolios/{pid}/holdings",
        headers=headers,
        json={"symbol": "AAPL", "shares": 10, "cost_basis_per_share": 100, "purchase_date": "2026-01-02"},
    )
    assert len(_holdings(client, headers, pid)) == 1

    # Sell the whole position (as the "Sell" button does: full size, no lot_id).
    resp = _sell(client, headers, pid, "AAPL", 10, 150)
    assert resp.status_code == 200, resp.text

    assert [h for h in _holdings(client, headers, pid) if h["symbol"] == "AAPL"] == []


def test_partial_sell_reduces_shares() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "sell-partial@example.com")
    pid = client.post("/api/portfolios", headers=headers, json={"name": "S", "starting_cash": 0}).json()["id"]
    client.post(
        f"/api/portfolios/{pid}/holdings",
        headers=headers,
        json={"symbol": "MSFT", "shares": 10, "cost_basis_per_share": 100},
    )

    assert _sell(client, headers, pid, "MSFT", 4, 120).status_code == 200

    msft = [h for h in _holdings(client, headers, pid) if h["symbol"] == "MSFT"]
    assert len(msft) == 1
    assert msft[0]["shares"] == 6


def test_sell_consumes_multiple_lots_fifo() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "sell-fifo@example.com")
    pid = client.post("/api/portfolios", headers=headers, json={"name": "S", "starting_cash": 0}).json()["id"]
    # Two lots of the same symbol (bulk add gives distinct auto lot_ids).
    for shares in (5, 5):
        client.post(
            f"/api/portfolios/{pid}/holdings",
            headers=headers,
            json={"symbol": "TSLA", "shares": shares, "cost_basis_per_share": 100},
        )
    assert len([h for h in _holdings(client, headers, pid) if h["symbol"] == "TSLA"]) == 2

    # Sell 7: first lot (5) fully consumed + 2 from the second → one lot with 3 left.
    assert _sell(client, headers, pid, "TSLA", 7, 130).status_code == 200

    tsla = [h for h in _holdings(client, headers, pid) if h["symbol"] == "TSLA"]
    assert len(tsla) == 1
    assert tsla[0]["shares"] == 3
