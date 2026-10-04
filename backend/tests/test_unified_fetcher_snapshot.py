from __future__ import annotations

import asyncio
from datetime import date

from backend.adapters.crypto import CryptoDataAdapter
from backend.adapters.yahoo import YahooFinanceAdapter
from backend.adapters.base import OHLCV, QuoteResponse
from backend.core.unified_fetcher import UnifiedFetcher
from backend.shared.market_classifier import StockClassification, market_classifier


class _DummyNSE:
    async def get_quote_equity(self, _symbol: str):
        return {}

    async def get_trade_info(self, _symbol: str):
        return {}


class _DummyYahoo:
    async def get_quote_summary(self, _symbol: str, _modules):
        return {
            "assetProfile": {
                "sector": "Consumer Defensive",
                "industry": "Discount Stores",
            }
        }

    async def get_quotes(self, _symbols):
        return [{"shortName": "Costco Wholesale Corporation"}]

    async def get_chart(self, _symbol: str, _range_str: str = "1y", _interval: str = "1d"):
        return {"chart": {"result": []}}

    async def search_news(self, _query: str, limit: int = 30):
        return [{"title": "Headline", "link": "https://example.com/1"}][:limit]


class _DummyFMP:
    async def get_quote(self, _symbol: str):
        return {}

    async def get_historical_price_full(self, _symbol: str):
        return {}


class _DummyFinnhub:
    async def get_company_profile(self, _symbol: str):
        return {}

    api_key = "test-key"

    async def get_company_news(self, symbol: str, limit: int = 30):
        return [{"headline": f"{symbol} news", "url": "https://example.com/company"}][:limit]

    async def get_market_news(self, category: str = "general", limit: int = 30):
        return [{"headline": f"{category} market", "url": "https://example.com/market"}][:limit]


class _DummyKite:
    api_key = None

    def resolve_access_token(self):
        return None


class _RegistryStub:
    def __init__(self, *, quote: QuoteResponse | None = None, history: list[OHLCV] | None = None,
                 history_feed: str | None = None, history_source: str = "alpaca",
                 provider_chart: dict | None = None) -> None:
        self.quote = quote
        self.history = history or []
        self.history_feed = history_feed
        self.history_source = history_source
        self.provider_chart = provider_chart

    async def invoke(self, exchange: str, method: str, *args):
        if method == "get_quote":
            return self.quote
        if method == "get_history":
            return self.history
        if method == "get_history_with_provider":
            return self.history, self.history_feed
        if method == "get_history_with_evidence":
            return self.history, self.history_feed, self.provider_chart
        raise AssertionError(f"Unexpected invoke: {exchange}:{method}:{args}")

    async def invoke_with_source(self, exchange: str, method: str, *args):
        return await self.invoke(exchange, method, *args), self.history_source


def _us_classification(symbol: str) -> StockClassification:
    return StockClassification(
        symbol=symbol,
        display_name=symbol,
        exchange="NASDAQ",
        country_code="US",
        country_name="United States",
        flag_emoji="US",
        currency="USD",
        has_futures=False,
        has_options=True,
        market_status="open",
    )


def test_fetch_stock_snapshot_uses_yahoo_quote_name_for_us_symbols(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yfinance_symbol(symbol: str):
        return symbol.strip().upper()

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(market_classifier, "yfinance_symbol", _fake_yfinance_symbol)

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    snapshot = asyncio.run(fetcher.fetch_stock_snapshot("COST"))

    assert snapshot["company_name"] == "Costco Wholesale Corporation"
    assert snapshot["exchange"] == "NASDAQ"
    assert snapshot["country_code"] == "US"


def test_fetch_quote_uses_adapter_registry_and_preserves_payload_shape(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(quote=QuoteResponse(symbol="AAPL", price=201.5, change=1.2, change_pct=0.6, currency="USD")),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    payload = asyncio.run(fetcher.fetch_quote("AAPL"))

    assert payload["price"] == 201.5
    assert payload["last_price"] == 201.5
    assert payload["regularMarketPrice"] == 201.5
    assert payload["c"] == 201.5
    assert payload["dp"] == 0.6


def test_fetch_history_uses_adapter_registry_and_returns_chart_payload(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    history = [
        OHLCV(t=1710000000, o=100.0, h=101.0, l=99.5, c=100.5, v=1000.0),
        OHLCV(t=1710086400, o=100.5, h=102.0, l=100.0, c=101.5, v=1200.0),
    ]

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(history=history),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    payload, source = asyncio.run(fetcher.fetch_history_with_source("AAPL", range_str="1mo", interval="1d"))
    assert source == "alpaca"
    assert asyncio.run(fetcher.fetch_history("AAPL", range_str="1mo", interval="1d")) == payload

    result = payload["chart"]["result"][0]
    assert result["timestamp"] == [1710000000, 1710086400]
    quote = result["indicators"]["quote"][0]
    assert quote["open"] == [100.0, 100.5]
    assert quote["close"] == [100.5, 101.5]


def test_history_provenance_identifies_feed_without_changing_existing_source_contract(monkeypatch) -> None:
    history = [OHLCV(t=1710000000, o=100.0, h=101.0, l=99.5, c=100.5, v=1000.0)]
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(history=history, history_source="crypto", history_feed="yahoo_chart"),
    )
    fetcher = UnifiedFetcher(nse=_DummyNSE(), yahoo=_DummyYahoo(), fmp=_DummyFMP(), finnhub=_DummyFinnhub(), kite=_DummyKite())
    payload, source, feed = asyncio.run(fetcher.fetch_history_with_provenance("BTC-USD", range_str="1mo"))
    assert payload["chart"]["result"][0]["indicators"]["quote"][0]["close"] == [100.5]
    assert (source, feed) == ("crypto", "yahoo_chart")
    assert asyncio.run(fetcher.fetch_history_with_source("BTC-USD", range_str="1mo"))[1] == "crypto"


def test_adapter_chart_metadata_aligns_to_selected_rows_without_changing_prices(monkeypatch) -> None:
    history = [
        OHLCV(t=1710000000, o=100.0, h=101.0, l=99.5, c=100.5),
        OHLCV(t=1710172800, o=110.0, h=111.0, l=109.5, c=110.5),
    ]
    original = {"chart": {"result": [{
        "timestamp": [1710000000, 1710086400, 1710172800],
        "indicators": {"adjclose": [{"adjclose": [90.0, 95.0, 100.0]}]},
        "events": {"splits": {"1710086400": {"date": 1710086400}}},
    }]}}
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(history=history, history_source="crypto", history_feed="yahoo_chart", provider_chart=original),
    )
    fetcher = UnifiedFetcher(nse=_DummyNSE(), yahoo=_DummyYahoo(), fmp=_DummyFMP(), finnhub=_DummyFinnhub(), kite=_DummyKite())
    payload, source, feed = asyncio.run(fetcher.fetch_history_with_provenance("BTC-USD", range_str="1mo"))
    result = payload["chart"]["result"][0]
    assert (source, feed) == ("crypto", "yahoo_chart")
    assert result["timestamp"] == [1710000000, 1710172800]
    assert result["indicators"]["quote"][0]["close"] == [100.5, 110.5]
    assert result["indicators"]["adjclose"][0]["adjclose"] == [90.0, 100.0]
    assert result["events"] == original["chart"]["result"][0]["events"]


def test_crypto_and_yahoo_adapters_report_only_the_feed_used_for_history() -> None:
    class HistoryYahoo:
        def __init__(self) -> None:
            self.calls = 0

        async def get_chart(self, symbol: str, range_str: str, interval: str):
            self.calls += 1
            assert symbol == "BTC-USD"
            assert interval == "1d"
            return {"chart": {"result": [{
                "timestamp": [1710000000],
                "indicators": {"quote": [{
                    "open": [100.0], "high": [101.0], "low": [99.0],
                    "close": [100.5], "volume": [1000.0],
                }]},
            }]}}

    start, end = date(2024, 3, 1), date(2024, 3, 15)
    for adapter_type in (CryptoDataAdapter, YahooFinanceAdapter):
        yahoo = HistoryYahoo()
        adapter = adapter_type(yahoo=yahoo)
        rows, feed = asyncio.run(adapter.get_history_with_provider("BTC-USD", "1d", start, end))
        assert len(rows) == 1
        assert rows[0].c == 100.5
        assert feed == "yahoo_chart"
        evidence_rows, evidence_feed, raw = asyncio.run(adapter.get_history_with_evidence("BTC-USD", "1d", start, end))
        assert evidence_rows == rows
        assert evidence_feed == feed
        assert raw["chart"]["result"][0]["timestamp"] == [1710000000]
        assert yahoo.calls == 2  # one chart request per invocation, no metadata refetch


def test_fetch_stock_snapshot_uses_unified_quote_path_for_price(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yfinance_symbol(symbol: str):
        return symbol.strip().upper()

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(market_classifier, "yfinance_symbol", _fake_yfinance_symbol)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(quote=QuoteResponse(symbol="COST", price=999.0, change=10.0, change_pct=1.5, currency="USD")),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    snapshot = asyncio.run(fetcher.fetch_stock_snapshot("COST"))

    assert snapshot["current_price"] == 999.0
    assert snapshot["change_pct"] == 1.5
    assert snapshot["details"]["price_source"] == "adapter"


def test_search_news_uses_yahoo_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.search_news("nvidia", limit=5))

    assert len(rows) == 1
    assert rows[0]["title"] == "Headline"


def test_get_company_news_uses_finnhub_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.get_company_news("AAPL", limit=5))

    assert len(rows) == 1
    assert rows[0]["headline"] == "AAPL news"


def test_get_market_news_uses_finnhub_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.get_market_news("general", limit=5))

    assert len(rows) == 1
    assert rows[0]["headline"] == "general market"
