from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.services import crypto_market_service as cms
from backend.services.crypto_market_service import CryptoMarketService


class _FakeCache:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}

    def build_key(self, data_type: str, symbol: str, params: dict | None = None) -> str:
        return f"{data_type}:{symbol}:{params or {}}"

    async def get(self, key: str):
        return self.data.get(key)

    async def set(self, key: str, value, ttl: int = 300):  # noqa: ARG002
        self.data[key] = value


class _FakeYahoo:
    async def get_chart(self, symbol: str, range_str: str = "1mo", interval: str = "1d"):  # noqa: ARG002
        return {
            "chart": {
                "result": [
                    {
                        "timestamp": [1735689600, 1735776000, 1735862400],
                        "indicators": {
                            "quote": [
                                {
                                    "open": [100, 101, 102],
                                    "high": [101, 102, 103],
                                    "low": [99, 100, 101],
                                    "close": [100.5, 101.5, 102.5],
                                    "volume": [10, 11, 12],
                                }
                            ]
                        },
                    }
                ]
            }
        }


class _FakeFetcher:
    def __init__(self, yahoo: _FakeYahoo) -> None:
        self.yahoo = yahoo


def _universe() -> list[dict]:
    return [
        {"symbol": "BTC-USD", "name": "Bitcoin", "price": 50000, "change_24h": 2.1,
         "volume_24h": 1000, "market_cap": 1_000_000_000, "sector": "L1",
         "day_high": 51000, "day_low": 49000},
        {"symbol": "ETH-USD", "name": "Ethereum", "price": 3000, "change_24h": -1.2,
         "volume_24h": 800, "market_cap": 500_000_000, "sector": "L1",
         "day_high": 3200, "day_low": 2800},
    ]


def _patch_universe(monkeypatch, rows=None) -> None:
    payload = _universe() if rows is None else rows

    async def _fake_load_universe(limit: int = 300):  # noqa: ARG001
        return [dict(r) for r in payload]

    monkeypatch.setattr(cms, "load_universe", _fake_load_universe)


def _service() -> CryptoMarketService:
    yahoo = _FakeYahoo()

    async def _fetcher():
        return _FakeFetcher(yahoo)

    return CryptoMarketService(cache_backend=_FakeCache(), fetcher_factory=_fetcher)


def test_crypto_service_markets_returns_items(monkeypatch) -> None:
    _patch_universe(monkeypatch)
    service = _service()
    result = asyncio.run(service.markets(limit=10))
    assert {item["symbol"] for item in result["items"]} == {"BTC-USD", "ETH-USD"}


def test_crypto_service_market_filter_and_sort(monkeypatch) -> None:
    _patch_universe(monkeypatch)
    service = _service()
    result = asyncio.run(
        service.markets(limit=10, q="ETH", sector="L1", sort_by="change_24h", sort_order="asc")
    )
    assert len(result["items"]) == 1
    assert result["items"][0]["symbol"] == "ETH-USD"


def test_crypto_service_coin_detail_shape(monkeypatch) -> None:
    _patch_universe(monkeypatch)
    yahoo = _FakeYahoo()

    async def _fetcher():
        return _FakeFetcher(yahoo)

    service = CryptoMarketService(
        cache_backend=_FakeCache(),
        fetcher_factory=_fetcher,
        now_factory=lambda: datetime(2026, 3, 5, tzinfo=timezone.utc),
    )
    detail = asyncio.run(service.coin_detail("btc"))
    assert detail is not None
    assert detail["symbol"] == "BTC-USD"
    assert detail["high_24h"] == 51000
    assert detail["low_24h"] == 49000
    assert detail["sparkline"] == [100.5, 101.5, 102.5]


def test_crypto_service_dominance_prefers_global(monkeypatch) -> None:
    _patch_universe(monkeypatch)

    async def _fake_global():
        return {"btc_pct": 55.0, "eth_pct": 18.0, "total_market_cap": 2_000_000_000_000.0}

    monkeypatch.setattr(cms, "load_global", _fake_global)
    service = _service()
    result = asyncio.run(service.dominance())
    assert result["btc_pct"] == 55.0
    assert result["eth_pct"] == 18.0
    assert abs(result["others_pct"] - 27.0) < 1e-9


def test_crypto_service_dominance_falls_back_to_universe(monkeypatch) -> None:
    _patch_universe(monkeypatch)

    async def _no_global():
        return None

    monkeypatch.setattr(cms, "load_global", _no_global)
    service = _service()
    result = asyncio.run(service.dominance())
    # BTC 1e9 of 1.5e9 total -> ~66.7%, ETH ~33.3%
    assert round(result["btc_pct"], 1) == 66.7
    total = result["btc_pct"] + result["eth_pct"] + result["others_pct"]
    assert 99.0 <= total <= 101.0


def test_crypto_service_markets_empty_when_no_data(monkeypatch) -> None:
    _patch_universe(monkeypatch, rows=[])
    service = _service()
    result = asyncio.run(service.markets(limit=10))
    assert result["items"] == []
