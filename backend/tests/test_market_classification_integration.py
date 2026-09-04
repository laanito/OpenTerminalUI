from __future__ import annotations

import asyncio

from backend.api.routes import search, stocks
from backend.shared.market_classifier import StockClassification, market_classifier


def _us_classification(symbol: str) -> StockClassification:
    return StockClassification(
        symbol=symbol,
        display_name=symbol,
        exchange="NASDAQ",
        country_code="US",
        country_name="United States",
        flag_emoji="🇺🇸",
        currency="USD",
        has_futures=False,
        has_options=True,
        market_status="open",
    )


def test_market_classifier_fallback_defaults_unknown_unsuffixed_to_us(monkeypatch) -> None:
    async def _fake_nse_symbols():
        return {"RELIANCE", "TCS"}

    async def _fake_profile(_: str):
        return {}

    monkeypatch.setattr(market_classifier, "_load_nse_symbols", _fake_nse_symbols)
    monkeypatch.setattr(market_classifier, "_fetch_fmp_profile", _fake_profile)

    cls = asyncio.run(market_classifier.classify("AAPL"))
    assert cls.exchange == "NASDAQ"
    assert cls.country_code == "US"
    assert cls.has_options is True
    assert asyncio.run(market_classifier.yfinance_symbol("AAPL")) == "AAPL"


def test_stocks_route_includes_classification_and_us_symbol(monkeypatch) -> None:
    async def _fake_snapshot(_: str):
        return {"company_name": "Apple Inc."}

    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yf_symbol(_: str):
        return "AAPL"

    monkeypatch.setattr(stocks, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(stocks.market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(stocks.market_classifier, "yfinance_symbol", _fake_yf_symbol)

    out = asyncio.run(stocks.get_stock("AAPL"))
    assert out.symbol == "AAPL"
    assert out.country_code == "US"
    assert out.exchange == "NASDAQ"
    assert out.classification is not None
    assert out.classification["country_code"] == "US"
    assert out.classification["has_options"] is True


def test_search_results_include_flag_and_exchange(monkeypatch) -> None:
    async def _fake_rows():
        return [{"Symbol": "RELIANCE", "Company Name": "Reliance Industries Limited"}]

    async def _fake_classify(symbol: str):
        return StockClassification(
            symbol=symbol,
            display_name=symbol,
            exchange="NSE",
            country_code="IN",
            country_name="India",
            flag_emoji="🇮🇳",
            currency="INR",
            has_futures=True,
            has_options=True,
            market_status="open",
        )

    monkeypatch.setattr(search, "_get_rows", _fake_rows)
    monkeypatch.setattr(search.market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(search, "get_adapter_registry", lambda: (_ for _ in ()).throw(RuntimeError("no adapter")))

    out = asyncio.run(search.search(q="reli"))
    assert len(out.results) == 1
    first = out.results[0]
    assert first.exchange == "NSE"
    assert first.country_code == "IN"
    assert first.flag_emoji == "🇮🇳"


def test_search_fallback_includes_direct_us_ticker_query(monkeypatch) -> None:
    async def _fake_rows():
        return []

    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_snapshot(_: str):
        return {"company_name": "Apple Inc."}

    monkeypatch.setattr(search, "_get_rows", _fake_rows)
    monkeypatch.setattr(search.market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(search, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(search, "get_adapter_registry", lambda: (_ for _ in ()).throw(RuntimeError("no adapter")))

    out = asyncio.run(search.search(q="AAPL"))
    assert len(out.results) == 1
    first = out.results[0]
    assert first.ticker == "AAPL"
    assert first.name == "Apple Inc."
    assert first.exchange == "NASDAQ"
    assert first.country_code == "US"
