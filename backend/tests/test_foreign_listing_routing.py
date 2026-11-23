"""A UI crypto/India hint cannot turn an explicit EUR listing into a coin."""
import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.adapters.crypto import CryptoDataAdapter
from backend.api.routes import chart, quotes
from backend.providers.chart_data import ChartDataProvider
from backend.services.marketdata_hub import MarketDataHub
from backend.shared.market_classifier import foreign_symbol_currency, market_classifier


@pytest.mark.parametrize("hint", ["CRYPTO", "NSE", "NASDAQ"])
def test_normalized_provider_preserves_listing_under_conflicting_hint(hint):
    provider = ChartDataProvider()
    assert asyncio.run(provider.resolve_market("MWRE.DE", hint)) == ("US", "MWRE.DE", "MWRE.DE")
    assert foreign_symbol_currency("MWRE.DE") == "EUR"
    classification = asyncio.run(market_classifier.classify("MWRE.DE"))
    assert classification.currency == "EUR" and classification.exchange == "XETRA"


@pytest.mark.parametrize("provider_currency", [None, "EUR"])
def test_legacy_chart_skips_crypto_adapter_and_retains_eur(monkeypatch, provider_currency):
    fetcher = SimpleNamespace(fetch_history=AsyncMock(return_value={"chart": {"result": [{"meta": {"currency": provider_currency}, "timestamp": [1795000000], "indicators": {"quote": [{"open": [10], "high": [12], "low": [9], "close": [11], "volume": [25]}]}}]}}))
    registry = SimpleNamespace(invoke=AsyncMock(side_effect=AssertionError("must not enter crypto adapter")))
    monkeypatch.setattr(chart, "get_unified_fetcher", AsyncMock(return_value=fetcher))
    monkeypatch.setattr(chart, "get_adapter_registry", lambda: registry)
    monkeypatch.setattr(chart.cache_instance, "get", AsyncMock(return_value=None))
    monkeypatch.setattr(chart.cache_instance, "set", AsyncMock())
    result = asyncio.run(chart.get_chart("MWRE.DE", market="CRYPTO", interval="1m", range="1mo"))
    assert result.currency == "EUR" and result.data[0].c == 11
    fetcher.fetch_history.assert_awaited_once_with("MWRE.DE", range_str="1mo", interval="1m")
    registry.invoke.assert_not_called()


@pytest.mark.parametrize("hint", ["CRYPTO", "NASDAQ", "NSE"])
def test_rest_and_stream_quotes_keep_native_symbol(monkeypatch, hint):
    yahoo = SimpleNamespace(get_quotes=AsyncMock(return_value=[{"symbol": "MWRE.DE", "currency": "EUR", "regularMarketPrice": 11, "regularMarketVolume": 25}]))
    fetcher = SimpleNamespace(yahoo=yahoo)
    registry = SimpleNamespace(invoke=AsyncMock(side_effect=AssertionError("explicit listing must bypass adapter")))
    monkeypatch.setattr(quotes, "get_unified_fetcher", AsyncMock(return_value=fetcher))
    monkeypatch.setattr(quotes, "get_adapter_registry", lambda: registry)
    result = asyncio.run(quotes.get_quotes(market=hint, symbols="MWRE.DE"))
    assert result["quotes"][0]["symbol"] == "MWRE.DE" and result["quotes"][0]["last"] == 11
    registry.invoke.assert_not_called()
    hub = MarketDataHub.__new__(MarketDataHub)
    result = asyncio.run(hub._fetch_quotes_batch(fetcher, hint, ["MWRE.DE"]))
    assert result[0]["symbol"] == "MWRE.DE" and result[0]["last"] == 11
    assert all(call.args == (["MWRE.DE"],) for call in yahoo.get_quotes.await_args_list)


def test_crypto_adapter_rejects_listings_but_keeps_eur_coin_units():
    yahoo = SimpleNamespace(get_quotes=AsyncMock(return_value=[{"regularMarketPrice": 50000}]), get_chart=AsyncMock())
    adapter = CryptoDataAdapter(yahoo)
    assert asyncio.run(adapter.get_quote("CRYPTO:MWRE.DE")) is None
    assert asyncio.run(adapter.get_history("MWRE.DE", "1m", date(2026, 11, 1), date(2026, 11, 2))) == []
    yahoo.get_quotes.assert_not_called(); yahoo.get_chart.assert_not_called()
    result = asyncio.run(adapter.get_quote("BTC-EUR"))
    assert result.symbol == "BTC-EUR" and result.currency == "EUR"


def test_mixed_stream_batch_retains_both_listing_and_crypto():
    rows = {symbol: {"symbol": symbol, "regularMarketPrice": price} for symbol, price in [("MWRE.DE", 11), ("BTC-USD", 50000)]}
    yahoo = SimpleNamespace(get_quotes=AsyncMock(side_effect=lambda symbols: [rows[s] for s in symbols]))
    hub = MarketDataHub.__new__(MarketDataHub)
    result = asyncio.run(hub._fetch_quotes_batch(SimpleNamespace(yahoo=yahoo), "CRYPTO", ["MWRE.DE", "BTC-USD"]))
    assert {row["symbol"]: row["last"] for row in result} == {"MWRE.DE": 11, "BTC-USD": 50000}
    assert [call.args[0] for call in yahoo.get_quotes.await_args_list] == [["MWRE.DE"], ["BTC-USD"]]
