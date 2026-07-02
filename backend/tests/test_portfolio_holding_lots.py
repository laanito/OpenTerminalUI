"""Adding the same symbol repeatedly must not collide on the lot unique key.

Regression for the "Import from Legacy" 500: the auto lot_id was a
second-resolution timestamp, so a bulk add of the same symbol within one second
violated the (portfolio_id, symbol, lot_id) unique constraint.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-lots-12345"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_bulk_add_same_symbol_gets_distinct_lots() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "holding-lots@example.com")
    pid = client.post(
        "/api/portfolios", headers=headers, json={"name": "Lots", "starting_cash": 100_000}
    ).json()["id"]

    # Back-to-back adds of the same symbol (as the legacy import does) — all succeed.
    for i in range(5):
        resp = client.post(
            f"/api/portfolios/{pid}/holdings",
            headers=headers,
            json={"symbol": "BTC-USD", "shares": 0.1 + i, "cost_basis_per_share": 50_000, "purchase_date": "2026-06-25"},
        )
        assert resp.status_code == 200, resp.text

    holdings = client.get(f"/api/portfolios/{pid}/holdings", headers=headers).json()["items"]
    btc = [h for h in holdings if h["symbol"] == "BTC-USD"]
    assert len(btc) == 5
    # Every auto-generated lot_id is unique.
    assert len({h["lot_id"] for h in btc}) == 5


def test_explicit_lot_id_still_enforced_unique() -> None:
    # An explicit duplicate lot_id for the same symbol is still a client error,
    # not a 500 — the constraint is intact, we just stopped auto-colliding.
    client = TestClient(app)
    headers = _auth_headers(client, "holding-explicit@example.com")
    pid = client.post(
        "/api/portfolios", headers=headers, json={"name": "Explicit", "starting_cash": 0}
    ).json()["id"]

    first = client.post(
        f"/api/portfolios/{pid}/holdings",
        headers=headers,
        json={"symbol": "AAPL", "shares": 1, "cost_basis_per_share": 100, "lot_id": "L1"},
    )
    assert first.status_code == 200, first.text
    dup = client.post(
        f"/api/portfolios/{pid}/holdings",
        headers=headers,
        json={"symbol": "AAPL", "shares": 1, "cost_basis_per_share": 100, "lot_id": "L1"},
    )
    assert dup.status_code == 409, dup.text
