from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import tape as tape_routes


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(tape_routes.router, prefix="/api/tape")
    return TestClient(app)


class _StubAdapter:
    """Adapter exposing a live trades feed, to exercise the real-data path."""

    def __init__(self, rows):
        self._rows = rows

    def get_recent_trades(self, symbol, limit=500):  # noqa: ARG002
        return self._rows[:limit]


def _patch_live_trades(monkeypatch, rows):
    monkeypatch.setattr(tape_routes, "get_adapter_registry", lambda: None)
    monkeypatch.setattr(
        tape_routes,
        "_fetch_live_trades",
        _make_fetch(rows),
    )


def _make_fetch(rows):
    async def _fetch(symbol, limit):  # noqa: ARG001
        return tape_routes._coerce_trade_rows(rows, limit)

    return _fetch


def test_tape_recent_returns_live_trade_rows(monkeypatch) -> None:
    now = datetime.now(timezone.utc).isoformat()
    _patch_live_trades(
        monkeypatch,
        [
            {"timestamp": now, "price": 100.0, "quantity": 5, "side": "buy"},
            {"timestamp": now, "price": 101.0, "quantity": 3, "side": "sell"},
        ],
    )
    client = _build_client()

    response = client.get("/api/tape/AAPL/recent")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("trades"), list)
    assert payload["trades"]
    first = payload["trades"][0]
    assert {"timestamp", "price", "quantity", "side"} <= set(first)
    assert "degraded" not in payload


def test_tape_recent_without_live_feed_is_empty_and_degraded() -> None:
    # No adapters registered in the bare test app → no live trade feed.
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/recent")

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"] == []
    assert payload["degraded"]["reason"] == "no_provider_data"


def test_tape_summary_without_live_feed_is_zeroed_and_degraded() -> None:
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/summary")

    assert response.status_code == 200
    payload = response.json()
    for key in ("total_volume", "buy_volume", "sell_volume", "buy_pct", "large_trade_count", "avg_trade_size", "trades_per_min"):
        assert key in payload
    assert payload["total_volume"] == 0
    assert payload["degraded"]["reason"] == "no_provider_data"


def test_tape_recent_side_values_are_constrained(monkeypatch) -> None:
    now = datetime.now(timezone.utc).isoformat()
    _patch_live_trades(
        monkeypatch,
        [{"timestamp": now, "price": 100.0 + i, "quantity": 1, "side": "buy"} for i in range(20)],
    )
    client = _build_client()

    response = client.get("/api/tape/AAPL/recent", params={"limit": 50})

    assert response.status_code == 200
    sides = {trade["side"] for trade in response.json()["trades"]}
    assert sides <= {"buy", "sell", "neutral"}


def test_tape_recent_limit_is_applied(monkeypatch) -> None:
    now = datetime.now(timezone.utc).isoformat()
    _patch_live_trades(
        monkeypatch,
        [{"timestamp": now, "price": 100.0 + i, "quantity": 1, "side": "buy"} for i in range(40)],
    )
    client = _build_client()

    response = client.get("/api/tape/AAPL/recent", params={"limit": 10})

    assert response.status_code == 200
    assert len(response.json()["trades"]) <= 10
