from __future__ import annotations

import asyncio
from dataclasses import dataclass

from backend.api.routes import portfolio, search, stocks
from backend.db.models import WatchlistItem
from backend.shared.market_classifier import StockClassification, market_classifier


@dataclass
class _FakeWatchlist:
    id: int
    watchlist_name: str
    ticker: str


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeDB:
    def __init__(self, watchlists=None):
        self._watchlists = watchlists or []

    def query(self, model):
        if model is WatchlistItem:
            return _FakeQuery(self._watchlists)
        return _FakeQuery([])


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


def test_watchlist_is_enriched_with_market_fields(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    monkeypatch.setattr(portfolio.market_classifier, "classify", _fake_classify)

    db = _FakeDB(watchlists=[_FakeWatchlist(id=1, watchlist_name="Core", ticker="AAPL")])
    watch = asyncio.run(portfolio.get_watchlists(db=db))

    assert len(watch["items"]) == 1
    wrow = watch["items"][0]
    assert wrow["exchange"] == "NASDAQ"
    assert wrow["country_code"] == "US"
    assert wrow["flag_emoji"] == "🇺🇸"
    assert wrow["has_options"] is True


def test_watchlist_mixed_india_us_enrichment(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        s = symbol.strip().upper()
        if s == "RELIANCE":
            return StockClassification(
                symbol=s,
                display_name=s,
                exchange="NSE",
                country_code="IN",
                country_name="India",
                flag_emoji="🇮🇳",
                currency="INR",
                has_futures=True,
                has_options=True,
                market_status="open",
            )
        return _us_classification(s)

    monkeypatch.setattr(portfolio.market_classifier, "classify", _fake_classify)

    db = _FakeDB(
        watchlists=[
            _FakeWatchlist(id=1, watchlist_name="Core", ticker="RELIANCE"),
            _FakeWatchlist(id=2, watchlist_name="Core", ticker="AAPL"),
        ],
    )

    watch = asyncio.run(portfolio.get_watchlists(db=db))
    by_ticker_watch = {row["ticker"]: row for row in watch["items"]}

    assert by_ticker_watch["RELIANCE"]["exchange"] == "NSE"
    assert by_ticker_watch["RELIANCE"]["country_code"] == "IN"
    assert by_ticker_watch["RELIANCE"]["has_futures"] is True
    assert by_ticker_watch["RELIANCE"]["flag_emoji"] == "🇮🇳"

    assert by_ticker_watch["AAPL"]["exchange"] == "NASDAQ"
    assert by_ticker_watch["AAPL"]["country_code"] == "US"
    assert by_ticker_watch["AAPL"]["flag_emoji"] == "🇺🇸"


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
