"""Yahoo client now caches successful responses and retries transient 429s via
the shared http_resilience helper (bucket C), mirroring FMP/Finnhub.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from backend.core.yahoo_client import YahooClient


def _client(handler) -> YahooClient:
    c = YahooClient()
    c.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return c


def test_chart_caches_successful_response():
    calls = {"n": 0}
    payload = {"chart": {"result": [{"meta": {"symbol": "AAPL"}}]}}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=payload)

    c = _client(handler)
    out1 = asyncio.run(c.get_chart("AAPL", "1y", "1d"))
    out2 = asyncio.run(c.get_chart("AAPL", "1y", "1d"))
    assert calls["n"] == 1  # second call served from cache
    assert out1 == out2 == payload


def test_chart_different_range_is_a_distinct_cache_entry():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"chart": {}})

    c = _client(handler)
    asyncio.run(c.get_chart("AAPL", "1y", "1d"))
    asyncio.run(c.get_chart("AAPL", "5y", "1d"))
    assert calls["n"] == 2  # range is part of the key


def test_quote_summary_caches():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"quoteSummary": {"result": [{"financialData": {"x": 1}}]}})

    c = _client(handler)
    out1 = asyncio.run(c.get_quote_summary("AAPL", ["financialData"]))
    out2 = asyncio.run(c.get_quote_summary("AAPL", ["financialData"]))
    assert calls["n"] == 1
    assert out1 == out2 == {"financialData": {"x": 1}}


def test_quotes_cache_per_batch():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"quoteResponse": {"result": [{"symbol": "AAPL", "regularMarketPrice": 1.0}]}})

    c = _client(handler)
    out1 = asyncio.run(c.get_quotes(["AAPL"]))
    out2 = asyncio.run(c.get_quotes(["AAPL"]))
    assert calls["n"] == 1  # same batch served from cache
    assert out1 == out2 == [{"symbol": "AAPL", "regularMarketPrice": 1.0}]


def test_symbol_search_caches():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"quotes": [{"symbol": "AAPL"}]})

    c = _client(handler)
    asyncio.run(c.search_symbols("apple"))
    out = asyncio.run(c.search_symbols("apple"))
    assert calls["n"] == 1
    assert out == [{"symbol": "AAPL"}]


def test_chart_retries_then_raises_on_persistent_429():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, text="Too Many Requests")

    c = _client(handler)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(c.get_chart("AAPL", "1y", "1d"))
    assert calls["n"] >= 2  # retried before giving up


def test_quotes_429_returns_empty_and_not_cached():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, text="Too Many Requests")

    c = _client(handler)
    assert asyncio.run(c.get_quotes(["AAPL"])) == []
    n_after_first = calls["n"]
    assert asyncio.run(c.get_quotes(["AAPL"])) == []
    assert calls["n"] > n_after_first  # second call still hit network (no poisoned cache)
