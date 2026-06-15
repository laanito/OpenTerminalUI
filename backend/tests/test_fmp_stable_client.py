from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from backend.core.fmp_client import FMPClient


def _client(handler) -> FMPClient:
    c = FMPClient(api_key="test-key")
    c.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return c


def test_quote_uses_stable_endpoint_and_query_param():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=[{"symbol": "AAPL", "price": 1.0}])

    c = _client(handler)
    out = asyncio.run(c.get_quote("AAPL"))

    assert "/stable/quote" in seen["url"]
    assert "symbol=AAPL" in seen["url"]
    assert "/api/v3/" not in seen["url"]
    assert out["symbol"] == "AAPL"


def test_symbol_not_forced_to_ns():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=[{"symbol": "TSLA"}])

    c = _client(handler)
    asyncio.run(c.get_quote("TSLA"))
    assert "symbol=TSLA" in seen["url"]
    assert ".NS" not in seen["url"]


def test_historical_wraps_flat_array_into_legacy_shape():
    rows = [
        {"symbol": "AAPL", "date": "2026-01-02", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 10},
        {"symbol": "AAPL", "date": "2026-01-01", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 5},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/stable/historical-price-eod/full" in str(request.url)
        return httpx.Response(200, json=rows)

    c = _client(handler)
    out = asyncio.run(c.get_historical_price_full("AAPL"))
    assert isinstance(out, dict)
    assert out["symbol"] == "AAPL"
    assert out["historical"] == rows


def test_non_json_plan_restriction_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        # Mimics the free-tier "Premium Query Parameter ..." plain-text body.
        return httpx.Response(200, text="Premium Query Parameter: not available under your plan")

    c = _client(handler)
    assert asyncio.run(c.get_quote("RELIANCE.NS")) == {}
    assert asyncio.run(c.get_income_statement("RELIANCE.NS")) == []


def test_error_message_payload_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"Error Message": "Legacy Endpoint ..."})

    c = _client(handler)
    assert asyncio.run(c.get_income_statement("AAPL")) == []


def test_http_402_returns_empty_without_disabling():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, text="Restricted Endpoint")

    c = _client(handler)
    assert asyncio.run(c.get_esg_data("AAPL")) == []
    assert c.disabled is False  # 402 (plan) must not disable the whole client


def test_http_403_disables_client():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"Error Message": "Invalid API KEY"})

    c = _client(handler)
    assert asyncio.run(c.get_quote("AAPL")) == {}
    assert c.disabled is True
