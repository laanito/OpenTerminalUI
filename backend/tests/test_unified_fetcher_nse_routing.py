from __future__ import annotations

import asyncio

import pytest

from backend.core import unified_fetcher as uf
from backend.core.unified_fetcher import UnifiedFetcher
from backend.shared.market_classifier import StockClassification


def _classification(country_code: str, exchange: str) -> StockClassification:
    return StockClassification(
        symbol="X",
        display_name="X",
        exchange=exchange,
        country_code=country_code,
        country_name=country_code,
        flag_emoji="",
        currency="USD",
        has_futures=False,
        has_options=False,
        market_status="closed",
    )


class _SpyNSE:
    def __init__(self) -> None:
        self.corp_info_calls: list[str] = []

    async def get_corp_info(self, symbol: str) -> dict:
        self.corp_info_calls.append(symbol)
        return {"info": {"symbol": symbol}}


@pytest.fixture
def fetcher_with_spy_nse(monkeypatch):
    fetcher = UnifiedFetcher.__new__(UnifiedFetcher)  # bypass __init__ / network clients
    spy = _SpyNSE()
    fetcher.nse = spy  # type: ignore[attr-defined]
    return fetcher, spy


def test_corporate_actions_skips_nse_for_non_indian_symbol(monkeypatch, fetcher_with_spy_nse):
    fetcher, spy = fetcher_with_spy_nse

    async def fake_classify(symbol: str):
        return _classification("US", "NASDAQ")

    monkeypatch.setattr(uf.market_classifier, "classify", fake_classify)

    result = asyncio.run(fetcher.fetch_corporate_actions("ETH-USD"))

    assert spy.corp_info_calls == []  # NSE was never called
    assert result["ticker"] == "ETH-USD"
    assert result["corporateActions"] == []
    assert "warning" in result


def test_corporate_actions_uses_nse_for_indian_symbol(monkeypatch, fetcher_with_spy_nse):
    fetcher, spy = fetcher_with_spy_nse

    async def fake_classify(symbol: str):
        return _classification("IN", "NSE")

    monkeypatch.setattr(uf.market_classifier, "classify", fake_classify)

    result = asyncio.run(fetcher.fetch_corporate_actions("RELIANCE"))

    assert spy.corp_info_calls == ["RELIANCE"]
    assert result == {"info": {"symbol": "RELIANCE"}}


def test_shareholding_skips_nse_for_non_indian_symbol(monkeypatch, fetcher_with_spy_nse):
    fetcher, spy = fetcher_with_spy_nse

    async def fake_classify(symbol: str):
        return _classification("US", "NASDAQ")

    # Stop the Yahoo fallback from making network calls.
    async def fake_yfinance_symbol(symbol: str):
        return symbol

    class _Yahoo:
        async def get_quote_summary(self, *args, **kwargs):
            return {}

    monkeypatch.setattr(uf.market_classifier, "classify", fake_classify)
    monkeypatch.setattr(uf.market_classifier, "yfinance_symbol", fake_yfinance_symbol)
    fetcher.yahoo = _Yahoo()  # type: ignore[attr-defined]

    result = asyncio.run(fetcher.fetch_shareholding("ETH-USD"))

    assert spy.corp_info_calls == []  # NSE was never called
    assert result["ticker"] == "ETH-USD"
    # Falls through to the deterministic default distribution.
    assert result["history"]
