"""Finnhub client now caches successful responses and retries transient 429s,
mirroring the FMP client, so the free tier is not re-spent on identical calls.
"""

from __future__ import annotations

import asyncio

import httpx

from backend.core.finnhub_client import FinnhubClient


def _client(handler) -> FinnhubClient:
    c = FinnhubClient(api_key="test-key")
    c.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return c


def test_get_caches_successful_response():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"name": "Apple Inc", "ticker": "AAPL"})

    c = _client(handler)
    out1 = asyncio.run(c.get_company_profile("AAPL"))
    out2 = asyncio.run(c.get_company_profile("AAPL"))
    assert calls["n"] == 1  # second call served from cache
    assert out1 == out2 == {"name": "Apple Inc", "ticker": "AAPL"}


def test_cache_key_excludes_token():
    # Same logical request under two different keys must share one cache entry.
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"c": 100.0})

    c1 = FinnhubClient(api_key="key-A")
    c1.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    c2 = FinnhubClient(api_key="key-B")
    c2.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    asyncio.run(c1.get_quote("AAPL"))
    asyncio.run(c2.get_quote("AAPL"))
    assert calls["n"] == 1  # token is not part of the cache key


def test_rate_limit_not_cached_and_retried():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, text="API limit reached")

    c = _client(handler)
    assert asyncio.run(c.get_company_profile("AAPL")) == {}
    assert asyncio.run(c.get_company_profile("AAPL")) == {}
    assert calls["n"] >= 4  # retried + second call not served from a poisoned cache


def test_403_disables_client():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="You don't have access")

    c = _client(handler)
    assert asyncio.run(c.get_company_profile("AAPL")) == {}
    assert c.disabled is True
