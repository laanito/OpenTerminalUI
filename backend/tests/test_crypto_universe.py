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


def _patch_loaded(monkeypatch, rows) -> None:
    async def _fake_load_universe(limit: int = 300):  # noqa: ARG001
        return [dict(r) for r in rows]

    monkeypatch.setattr(cu, "load_universe", _fake_load_universe)


def _loaded_rows() -> list[dict]:
    return [
        {"symbol": "BTC-USD", "name": "Bitcoin", "coin_id": "bitcoin"},
        {"symbol": "ETH-USD", "name": "Ethereum", "coin_id": "ethereum"},
        {"symbol": "UNI-USD", "name": "Uniswap", "coin_id": "uniswap"},
        {"symbol": "RNDR-USD", "name": "Render", "coin_id": "render-token"},
    ]


def test_search_universe_finds_non_hardcoded_coin(monkeypatch) -> None:
    _patch_loaded(monkeypatch, _loaded_rows())
    rows = asyncio.run(cu.search_universe("uni", limit=10))
    assert [r["symbol"] for r in rows] == ["UNI-USD"]
    assert rows[0]["name"] == "Uniswap"


def test_search_universe_matches_name(monkeypatch) -> None:
    _patch_loaded(monkeypatch, _loaded_rows())
    rows = asyncio.run(cu.search_universe("render", limit=10))
    assert [r["symbol"] for r in rows] == ["RNDR-USD"]


def test_search_universe_ranks_exact_before_substring(monkeypatch) -> None:
    _patch_loaded(monkeypatch, [
        {"symbol": "ETH-USD", "name": "Ethereum", "coin_id": "ethereum"},
        {"symbol": "ETHFI-USD", "name": "Ether.fi", "coin_id": "ether-fi"},
    ])
    rows = asyncio.run(cu.search_universe("eth", limit=10))
    # Exact ticker base "eth" outranks the substring match.
    assert rows[0]["symbol"] == "ETH-USD"


def test_search_universe_empty_query_returns_top_n(monkeypatch) -> None:
    _patch_loaded(monkeypatch, _loaded_rows())
    rows = asyncio.run(cu.search_universe("", limit=2))
    assert [r["symbol"] for r in rows] == ["BTC-USD", "ETH-USD"]


class _FakeCG:
    def __init__(self, ohlc, *_a, **_k) -> None:
        self._ohlc = ohlc
        self.seen_days = None

    async def initialize(self) -> None:
        pass

    async def close(self) -> None:
        pass

    async def get_ohlc(self, coin_id, *, days=365, vs_currency="usd"):  # noqa: ARG002
        self.seen_days = days
        return self._ohlc


def test_coin_id_for_symbol_uses_fallback_meta(monkeypatch) -> None:
    # Known majors resolve without touching the network/universe.
    async def _boom(limit: int = 300):  # noqa: ARG001
        raise AssertionError("should not load universe for a known coin")

    monkeypatch.setattr(cu, "load_universe", _boom)
    assert asyncio.run(cu.coin_id_for_symbol("btc")) == "bitcoin"


def test_coin_id_for_symbol_falls_back_to_universe(monkeypatch) -> None:
    _patch_loaded(monkeypatch, [
        {"symbol": "RENDER-USD", "name": "Render", "coin_id": "render-token"},
    ])
    assert asyncio.run(cu.coin_id_for_symbol("RENDER-USD")) == "render-token"
    assert asyncio.run(cu.coin_id_for_symbol("NOPE-USD")) == ""


def test_load_candles_maps_ohlc_and_range(monkeypatch) -> None:
    _patch_loaded(monkeypatch, [
        {"symbol": "RENDER-USD", "name": "Render", "coin_id": "render-token"},
    ])
    fake = _FakeCG([[1700000000000, 1.0, 1.5, 0.9, 1.2], [1700086400000, 1.2, 1.3, 1.1, 1.25]])
    monkeypatch.setattr(cu, "CoinGeckoClient", lambda *a, **k: fake)
    rows = asyncio.run(cu.load_candles("RENDER-USD", "1mo"))
    assert len(rows) == 2
    assert rows[0] == {"t": 1700000000, "o": 1.0, "h": 1.5, "l": 0.9, "c": 1.2, "v": 0.0}
    assert fake.seen_days == 30  # "1mo" -> 30 days


def test_load_candles_empty_when_no_coin_id(monkeypatch) -> None:
    _patch_loaded(monkeypatch, [])

    def _boom(*_a, **_k):
        raise AssertionError("should not build a client without a coin id")

    monkeypatch.setattr(cu, "CoinGeckoClient", _boom)
    assert asyncio.run(cu.load_candles("NOPE-USD", "1y")) == []


def test_row_from_coingecko_maps_fields() -> None:
    row = cu._row_from_coingecko(_markets_rows()[0])
    assert row is not None
    assert row["symbol"] == "BTC-USD"
    assert row["sector"] == "L1"  # curated tag
    assert row["coin_id"] == "bitcoin"
    # Unknown coins get an "Other" sector.
    other = cu._row_from_coingecko({"symbol": "xyz", "name": "XYZ", "current_price": 5})
    assert other["sector"] == "Other"
