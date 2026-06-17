from __future__ import annotations

import asyncio

import httpx

from backend.instruments import live_search
from backend.instruments.text import fold_text, search_blob


def test_fold_text_strips_diacritics():
    assert fold_text("Nestlé") == "nestle"
    assert fold_text("Société Générale") == "societe generale"
    assert fold_text(None) == ""
    assert search_blob("ADS.DE", "Adidas") == "ads.de adidas"


def test_map_quote_types():
    eq = live_search._map_quote({"symbol": "aapl", "quoteType": "EQUITY", "shortname": "Apple", "exchDisp": "NASDAQ"})
    assert eq["display_symbol"] == "AAPL" and eq["type"] == "equity" and eq["exchange"] == "NASDAQ"
    assert eq["canonical_id"] == "YAHOO:AAPL"
    cc = live_search._map_quote({"symbol": "BTC-EUR", "quoteType": "CRYPTOCURRENCY", "shortname": "Bitcoin EUR"})
    assert cc["type"] == "crypto"
    # Unmapped type / empty symbol -> dropped.
    assert live_search._map_quote({"symbol": "X", "quoteType": "OPTION"}) is None
    assert live_search._map_quote({"symbol": "", "quoteType": "EQUITY"}) is None


def test_yahoo_search_parses_and_dedupes(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert "/v1/finance/search" in str(request.url)
        return httpx.Response(200, json={"quotes": [
            {"symbol": "RACE.MI", "quoteType": "EQUITY", "shortname": "Ferrari NV", "exchDisp": "Milan"},
            {"symbol": "RACE.MI", "quoteType": "EQUITY", "shortname": "dup"},
            {"symbol": "RACE", "quoteType": "EQUITY", "shortname": "Ferrari NV", "exchDisp": "NYSE"},
            {"symbol": "BAD", "quoteType": "OPTION"},
        ]})

    real_client = httpx.AsyncClient

    def _fake_client(*args, **kwargs):
        kwargs.pop("trust_env", None)
        kwargs.pop("headers", None)
        kwargs.pop("timeout", None)
        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(live_search.httpx, "AsyncClient", _fake_client)
    rows = asyncio.run(live_search.yahoo_search("ferrari"))
    syms = [r["display_symbol"] for r in rows]
    assert syms == ["RACE.MI", "RACE"]  # deduped, OPTION dropped


def test_yahoo_search_empty_query():
    assert asyncio.run(live_search.yahoo_search("  ")) == []
