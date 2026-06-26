from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import depth as depth_routes
from backend.api.routes import stream as stream_routes
from backend.api.schemas.market_data import DepthLevel, MarketDepth
from backend.shared.degraded import REASON_NO_LIVE_SOURCE, degraded_marker


def _now() -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


async def _fake_fetch_depth(symbol: str, levels: int = 10, market_hint: str | None = None) -> MarketDepth:
    """Stand-in for UnifiedFetcher.fetch_depth: real book for crypto/IN, empty +
    degraded for US/EU (no live L2 source)."""
    sym = symbol.strip().upper()
    hint = (market_hint or "").strip().upper()

    if sym.endswith("-USD") or hint in {"CRYPTO", "BINANCE"}:
        bids = [DepthLevel(price=100.0 - i, size=0.5 + i * 0.1) for i in range(levels)]
        asks = [DepthLevel(price=101.0 + i, size=0.4 + i * 0.1) for i in range(levels)]
        return MarketDepth(
            symbol=sym,
            market="CRYPTO",
            as_of=_now(),
            bids=bids,
            asks=asks,
            total_bid_quantity=sum(b.size for b in bids),
            total_ask_quantity=sum(a.size for a in asks),
            source="binance",
        )

    if hint in {"IN", "NSE", "BSE"}:
        bids = [DepthLevel(price=2000.0 - i, size=10 + i, orders=2) for i in range(levels)]
        asks = [DepthLevel(price=2001.0 + i, size=11 + i, orders=3) for i in range(levels)]
        return MarketDepth(
            symbol=sym,
            market="IN",
            as_of=_now(),
            bids=bids,
            asks=asks,
            total_bid_quantity=sum(b.size for b in bids),
            total_ask_quantity=sum(a.size for a in asks),
            source="nse",
        )

    # US / EU equity: no live Level-2 source.
    return MarketDepth(
        symbol=sym,
        market=hint or "US",
        as_of=_now(),
        bids=[],
        asks=[],
        source=None,
        degraded=degraded_marker(REASON_NO_LIVE_SOURCE, detail="broker L2 feed not wired"),
    )


class _FakeFetcher:
    async def fetch_depth(self, symbol, levels=10, market_hint=None):  # noqa: ANN001
        return await _fake_fetch_depth(symbol, levels=levels, market_hint=market_hint)


class _FakeHub:
    def __init__(self) -> None:
        self.subscriptions: list[list[str]] = []

    async def register(self, websocket) -> None:  # noqa: ANN001
        return None

    async def unregister(self, websocket) -> None:  # noqa: ANN001
        return None

    async def subscribe(self, websocket, symbols):  # noqa: ANN001
        self.subscriptions.append(list(symbols))
        return bool(symbols)

    async def unsubscribe(self, websocket, symbols):  # noqa: ANN001
        return {"symbols": list(symbols)}

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001
        return None

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001
        return None


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(depth_routes.router, prefix="/api")
    app.include_router(stream_routes.router, prefix="/api")
    return app


def _patch_fetcher(monkeypatch) -> None:
    async def _fake_get() -> _FakeFetcher:
        return _FakeFetcher()

    monkeypatch.setattr(depth_routes, "get_unified_fetcher", _fake_get)
    monkeypatch.setattr(stream_routes, "get_unified_fetcher", _fake_get)


def test_depth_snapshot_http_real_for_crypto_and_india(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    client = TestClient(_build_app())

    for symbol, market, provider_key in (("RELIANCE", "IN", "nse"), ("BTC-USD", "CRYPTO", "binance")):
        response = client.get(f"/api/depth/{symbol}", params={"market": market, "levels": 6})
        assert response.status_code == 200
        payload = response.json()
        assert payload["symbol"] == symbol
        assert payload["provider_key"] == provider_key
        assert payload["degraded"] is None
        bids = payload["bids"]
        asks = payload["asks"]
        assert len(bids) == 6 and len(asks) == 6
        assert bids == sorted(bids, key=lambda row: row["price"], reverse=True)
        assert asks == sorted(asks, key=lambda row: row["price"])
        assert payload["spread"] >= 0
        assert payload["total_bid_quantity"] > 0


def test_depth_snapshot_http_crypto_sizes_are_fractional(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    client = TestClient(_build_app())
    payload = client.get("/api/depth/BTC-USD", params={"market": "CRYPTO", "levels": 4}).json()
    # Crypto quantities are fractional — must survive as floats, not be rounded to int.
    assert any(not float(level["size"]).is_integer() for level in payload["bids"])


def test_depth_snapshot_http_us_is_empty_and_degraded(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    client = TestClient(_build_app())
    payload = client.get("/api/depth/AAPL", params={"market": "US", "levels": 6}).json()
    assert payload["bids"] == []
    assert payload["asks"] == []
    assert payload["provider_key"] == "none"
    assert payload["degraded"]["reason"] == REASON_NO_LIVE_SOURCE
    assert payload["total_bid_quantity"] == 0


def test_depth_websocket_emits_real_snapshot(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    client = TestClient(_build_app())

    with client.websocket_connect("/api/ws/depth") as websocket:
        assert websocket.receive_json() == {"type": "ready", "channels": ["depth"]}

        websocket.send_json({"op": "subscribe", "symbols": ["BTC-USD"], "market": "CRYPTO"})
        subscribed = websocket.receive_json()
        assert subscribed["type"] == "subscribed"
        assert subscribed["symbols"] == ["BTC-USD"]

        depth_msg = websocket.receive_json()
        assert depth_msg["type"] == "depth"
        assert depth_msg["symbol"] == "BTC-USD"
        assert depth_msg["provider_key"] == "binance"
        assert depth_msg["snapshot"]["bids"][0]["price"] > depth_msg["snapshot"]["asks"][0]["price"] - 10_000


def test_quotes_websocket_can_emit_depth_channel_messages(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    fake_hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: fake_hub)
    client = TestClient(_build_app())

    with client.websocket_connect("/api/ws/quotes") as websocket:
        websocket.send_json({"op": "subscribe", "symbols": ["TCS"], "market": "IN", "channels": ["depth"]})
        depth_msg = websocket.receive_json()
        assert depth_msg["type"] == "depth"
        assert depth_msg["symbol"] == "TCS"
        assert depth_msg["market"] == "IN"
        assert depth_msg["provider_key"] == "nse"
