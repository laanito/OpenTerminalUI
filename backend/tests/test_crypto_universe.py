from __future__ import annotations

import asyncio

from backend.services import crypto_universe as cu


class _FakeCache:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}

    def build_key(self, data_type: str, symbol: str, params: dict | None = None) -> str:
        return f"{data_type}:{symbol}:{params or {}}"

    async def get(self, key: str):
        return self.data.get(key)

    async def set(self, key: str, value, ttl: int = 300):  # noqa: ARG002
        self.data[key] = value


def _markets_rows() -> list[dict]:
    return [
        {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "current_price": 65000,
         "market_cap": 1_300_000_000_000, "total_volume": 30_000_000_000,
         "price_change_percentage_24h": 1.2, "high_24h": 66000, "low_24h": 64000, "market_cap_rank": 1},
        {"id": "ethereum", "symbol": "eth", "name": "Ethereum", "current_price": 3200,
         "market_cap": 380_000_000_000, "total_volume": 12_000_000_000,
         "price_change_percentage_24h": -0.5, "high_24h": 3300, "low_24h": 3100, "market_cap_rank": 2},
    ]


def _patch_cache(monkeypatch) -> _FakeCache:
    cache = _FakeCache()
    monkeypatch.setattr(cu, "cache_instance", cache)
    return cache


def test_load_universe_prefers_coingecko(monkeypatch) -> None:
    _patch_cache(monkeypatch)
    calls = {"n": 0}

    async def _fake_cg(limit: int):
        calls["n"] += 1
        return [r for r in (
            cu._row_from_coingecko(c) for c in _markets_rows()
        ) if r][:limit]

    monkeypatch.setattr(cu, "_from_coingecko", _fake_cg)
    rows = asyncio.run(cu.load_universe(50))
    assert [r["symbol"] for r in rows] == ["BTC-USD", "ETH-USD"]
    # Real market cap carried through (not a price*volume proxy).
    assert rows[0]["market_cap"] == 1_300_000_000_000
    assert calls["n"] == 1


def test_load_universe_caches_between_calls(monkeypatch) -> None:
    _patch_cache(monkeypatch)
    calls = {"n": 0}

    async def _fake_cg(limit: int):  # noqa: ARG001
        calls["n"] += 1
        return [{"symbol": "BTC-USD", "name": "Bitcoin", "price": 1.0, "change_24h": 0.0,
                 "volume_24h": 0.0, "market_cap": 1.0, "sector": "L1",
                 "day_high": 1.0, "day_low": 1.0, "coin_id": "bitcoin", "market_cap_rank": 1}]

    monkeypatch.setattr(cu, "_from_coingecko", _fake_cg)
    asyncio.run(cu.load_universe(10))
    asyncio.run(cu.load_universe(10))
    assert calls["n"] == 1  # second call served from cache


def test_load_universe_falls_back_to_yahoo(monkeypatch) -> None:
    _patch_cache(monkeypatch)

    async def _empty_cg(limit: int):  # noqa: ARG001
        return []

    async def _fake_yahoo(limit: int):  # noqa: ARG001
        return [{"symbol": "BTC-USD", "name": "Bitcoin", "price": 50000.0, "change_24h": 1.0,
                 "volume_24h": 1000.0, "market_cap": 5e10, "sector": "L1",
                 "day_high": 51000.0, "day_low": 49000.0, "coin_id": "bitcoin", "market_cap_rank": None}]

    monkeypatch.setattr(cu, "_from_coingecko", _empty_cg)
    monkeypatch.setattr(cu, "_from_yahoo", _fake_yahoo)
    rows = asyncio.run(cu.load_universe(10))
    assert len(rows) == 1 and rows[0]["symbol"] == "BTC-USD"


def test_load_universe_serves_stale_when_all_sources_fail(monkeypatch) -> None:
    cache = _patch_cache(monkeypatch)
    stale_key = cache.build_key("crypto_quotes", "universe_stale", {"limit": 10})
    cache.data[stale_key] = [{"symbol": "BTC-USD", "name": "Bitcoin", "price": 1.0,
                              "change_24h": 0.0, "volume_24h": 0.0, "market_cap": 1.0,
                              "sector": "L1", "day_high": 1.0, "day_low": 1.0}]

    async def _empty(limit: int):  # noqa: ARG001
        return []

    monkeypatch.setattr(cu, "_from_coingecko", _empty)
    monkeypatch.setattr(cu, "_from_yahoo", _empty)
    rows = asyncio.run(cu.load_universe(10))
    assert len(rows) == 1 and rows[0]["symbol"] == "BTC-USD"


def test_row_from_coingecko_maps_fields() -> None:
    row = cu._row_from_coingecko(_markets_rows()[0])
    assert row is not None
    assert row["symbol"] == "BTC-USD"
    assert row["sector"] == "L1"  # curated tag
    assert row["coin_id"] == "bitcoin"
    # Unknown coins get an "Other" sector.
    other = cu._row_from_coingecko({"symbol": "xyz", "name": "XYZ", "current_price": 5})
    assert other["sector"] == "Other"
