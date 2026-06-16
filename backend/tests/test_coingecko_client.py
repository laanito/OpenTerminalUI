from __future__ import annotations

import asyncio

import httpx

from backend.core.coingecko_client import CoinGeckoClient


def _client(handler, api_key: str | None = None) -> CoinGeckoClient:
    c = CoinGeckoClient(api_key=api_key)
    c.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return c


def test_markets_parses_list():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "/coins/markets" in str(request.url)
        assert "vs_currency=usd" in str(request.url)
        return httpx.Response(200, json=[{"id": "bitcoin", "symbol": "btc"}])

    c = _client(handler)
    out = asyncio.run(c.get_markets(per_page=10))
    assert out and out[0]["id"] == "bitcoin"


def test_demo_key_sent_as_header():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("x-cg-demo-api-key")
        return httpx.Response(200, json=[])

    # initialize() builds the header set from api_key, so go through it.
    c = CoinGeckoClient(api_key="demo-123")

    async def run():
        await c.initialize()
        # swap transport but keep the headers initialize() configured
        c.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers=c.client.headers)
        await c.get_markets()
        await c.close()

    asyncio.run(run())
    assert seen["key"] == "demo-123"


def test_rate_limit_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="rate limited")

    c = _client(handler)
    assert asyncio.run(c.get_markets()) == []
    assert asyncio.run(c.get_global()) == {}


def test_ohlc_parses_candle_array():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "/coins/bitcoin/ohlc" in str(request.url)
        assert "days=30" in str(request.url)
        return httpx.Response(200, json=[[1700000000000, 100.0, 110.0, 95.0, 105.0]])

    c = _client(handler)
    out = asyncio.run(c.get_ohlc("bitcoin", days=30))
    assert out == [[1700000000000, 100.0, 110.0, 95.0, 105.0]]


def test_ohlc_empty_coin_id_skips_request():
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        raise AssertionError("should not hit the network for an empty coin id")

    c = _client(handler)
    assert asyncio.run(c.get_ohlc("", days=30)) == []


def test_global_unwraps_data_object():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"market_cap_percentage": {"btc": 50.0}}})

    c = _client(handler)
    out = asyncio.run(c.get_global())
    assert out["market_cap_percentage"]["btc"] == 50.0
