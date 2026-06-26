from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import depth as depth_routes
from backend.api.schemas.market_data import DepthLevel, MarketDepth


class _FakeFetcher:
    async def fetch_depth(self, symbol, levels=10, market_hint=None):  # noqa: ANN001
        bids = [DepthLevel(price=2000.0 - i, size=10 + i, orders=2) for i in range(levels)]
        asks = [DepthLevel(price=2001.0 + i, size=11 + i, orders=3) for i in range(levels)]
        return MarketDepth(
            symbol=symbol.strip().upper(),
            market="IN",
            as_of=datetime(2026, 1, 1, tzinfo=timezone.utc),
            bids=bids,
            asks=asks,
            total_bid_quantity=sum(b.size for b in bids),
            total_ask_quantity=sum(a.size for a in asks),
            source="nse",
        )


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(depth_routes.router, prefix="/api")
    return app


def test_dom_depth_endpoint_returns_sorted_l2_book_with_metrics(monkeypatch) -> None:
    async def _fake_get() -> _FakeFetcher:
        return _FakeFetcher()

    monkeypatch.setattr(depth_routes, "get_unified_fetcher", _fake_get)
    client = TestClient(_build_app())

    response = client.get("/api/depth/RELIANCE", params={"market": "IN", "levels": 20})
    assert response.status_code == 200

    payload = response.json()
    bids = payload["bids"]
    asks = payload["asks"]

    assert len(bids) == 20
    assert len(asks) == 20
    assert bids == sorted(bids, key=lambda row: row["price"], reverse=True)
    assert asks == sorted(asks, key=lambda row: row["price"])

    bid_cumulative = [row["cumulative_qty"] for row in bids]
    ask_cumulative = [row["cumulative_qty"] for row in asks]
    assert bid_cumulative == sorted(bid_cumulative)
    assert ask_cumulative == sorted(ask_cumulative)

    best_bid = bids[0]["price"]
    best_ask = asks[0]["price"]
    assert payload["spread"] == pytest.approx(best_ask - best_bid)
    assert -1.0 <= payload["imbalance"] <= 1.0
    assert payload["total_bid_qty"] == payload["total_bid_quantity"]
    assert payload["total_ask_qty"] == payload["total_ask_quantity"]
    assert payload["last_price"] > 0
    assert payload["provider_key"] == "nse"
    assert payload["degraded"] is None
