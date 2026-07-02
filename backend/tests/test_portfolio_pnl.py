"""Realized P&L = capital gains (cost basis subtracted), not sell proceeds.

Guards the correctness fix: the old analytics summed `shares * price - fees` as
"realized", overstating it by the entire cost basis. See portfolio_pnl.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.main import app
from backend.services.portfolio_pnl import realized_pnl


def _tx(type_, symbol="", shares=0.0, price=0.0, fees=0.0, date="2026-01-01", seq=0):
    return SimpleNamespace(
        type=type_,
        symbol=symbol,
        shares=shares,
        price=price,
        fees=fees,
        date=date,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc).replace(microsecond=seq),
    )


def test_realized_is_gain_not_proceeds() -> None:
    # Buy 10 @ 100, sell 10 @ 110 → gain = 10 * (110 - 100) = 100, not 1100.
    txns = [
        _tx("buy", "AAPL", shares=10, price=100, date="2026-01-01", seq=1),
        _tx("sell", "AAPL", shares=10, price=110, date="2026-02-01", seq=2),
    ]
    assert realized_pnl(txns) == 100.0


def test_realized_uses_average_cost_across_lots() -> None:
    # Buy 10 @ 100 and 10 @ 200 → avg 150. Sell 10 @ 180 → 10 * (180 - 150) = 300.
    txns = [
        _tx("buy", "MSFT", shares=10, price=100, date="2026-01-01", seq=1),
        _tx("buy", "MSFT", shares=10, price=200, date="2026-01-02", seq=2),
        _tx("sell", "MSFT", shares=10, price=180, date="2026-03-01", seq=3),
    ]
    assert realized_pnl(txns) == 300.0


def test_sell_fees_reduce_realized() -> None:
    txns = [
        _tx("buy", "T", shares=100, price=20, date="2026-01-01", seq=1),
        _tx("sell", "T", shares=100, price=25, fees=10, date="2026-02-01", seq=2),
    ]
    # 100 * (25 - 20) - 10 = 490
    assert realized_pnl(txns) == 490.0


def test_dividends_and_cash_moves_excluded() -> None:
    txns = [
        _tx("deposit", price=10_000, date="2026-01-01", seq=1),
        _tx("dividend", "AAPL", price=50, date="2026-02-01", seq=2),
        _tx("withdrawal", price=500, date="2026-03-01", seq=3),
    ]
    assert realized_pnl(txns) == 0.0


def test_chronology_respected_regardless_of_input_order() -> None:
    # Provide sell before buy in the list; date/created_at ordering must fix it.
    txns = [
        _tx("sell", "NVDA", shares=5, price=120, date="2026-02-01", seq=2),
        _tx("buy", "NVDA", shares=5, price=100, date="2026-01-01", seq=1),
    ]
    assert realized_pnl(txns) == 100.0  # 5 * (120 - 100)


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-pnl-12345"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_analytics_realized_pnl_is_capital_gain() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "realized-pnl@example.com")
    pid = client.post(
        "/api/portfolios", headers=headers, json={"name": "Realized", "starting_cash": 100_000}
    ).json()["id"]

    client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"symbol": "AAPL", "type": "buy", "shares": 10, "price": 100, "date": "2026-01-01"},
    )
    client.post(
        f"/api/portfolios/{pid}/transactions",
        headers=headers,
        json={"symbol": "AAPL", "type": "sell", "shares": 5, "price": 150, "date": "2026-02-01"},
    )
    analytics = client.get(f"/api/portfolios/{pid}/analytics", headers=headers)
    assert analytics.status_code == 200, analytics.text
    # 5 * (150 - 100) = 250 — a gain, not the 750 proceeds the old code reported.
    assert analytics.json()["realized_pnl"] == 250.0
