from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pandas as pd

from backend.api.routes import backtest, backtests, chart, framework, paper, statlab, tape
from backend.api.routes.screener import ScreenerScanRequest
from backend.core import backtester
from backend.core.models import ChartResponse
from backend.core.symbols import normalize_symbol
from backend.reports.tearsheet import infer_benchmark, infer_market_from_report
from backend.screener.factor_routes import IdeaListRequest
from backend.screener.router import ScreenerRunRequest
from backend.shared.market_defaults import currency_for_market


def test_generic_request_models_use_global_equity_defaults() -> None:
    assert backtests.BacktestSubmitPayload(symbol="AAPL").market == "NASDAQ"
    assert backtest.BacktestRequest(tickers=["AAPL"]).market == "NASDAQ"
    assert backtest.BacktestRequest(tickers=["AAPL"]).benchmark == "SPY"
    assert ScreenerRunRequest(query="ROE > 10").market == "US"
    assert ScreenerRunRequest(query="ROE > 10").universe == "sp_500"
    assert ScreenerScanRequest().markets == ["NYSE", "NASDAQ"]
    assert IdeaListRequest().market == "US"
    assert paper.DeployStrategyRequest(symbol="AAPL", strategy="example:sma_crossover").market == "NASDAQ"
    assert statlab.RegressionRequest(ticker="AAPL").benchmark == "SPY"
    assert framework.FrameworkBacktestRequest.model_fields["benchmark"].default == "SPY"
    assert tape._guess_exchange("AAPL") == "NASDAQ"
    assert normalize_symbol("AAPL").provider_symbol == "AAPL"
    assert normalize_symbol("RELIANCE", "NSE").provider_symbol == "RELIANCE.NS"


def test_reports_and_currency_default_to_us_without_erasing_india() -> None:
    assert infer_benchmark(None) == "SPY"
    assert infer_market_from_report({}) == "NASDAQ"
    assert infer_benchmark("NSE") == "NIFTY"
    assert currency_for_market("NASDAQ") == "USD"
    assert currency_for_market("NSE") == "INR"
    assert currency_for_market("LSE") == "GBP"
    assert currency_for_market("XETRA") == "EUR"
    assert currency_for_market("TSX") == "CAD"
    assert ChartResponse(ticker="AAPL", interval="1d", data=[]).currency == "USD"


def test_momentum_download_only_adds_india_suffix_for_india(monkeypatch) -> None:
    requested: list[list[str]] = []

    def fake_download(symbols, **_kwargs):  # noqa: ANN001
        requested.append(list(symbols))
        return pd.DataFrame({symbols[0]: [100.0, 101.0]}, index=pd.date_range("2026-01-01", periods=2))

    monkeypatch.setattr(backtester.yf, "download", fake_download)

    us = backtester._download_close(["AAPL"], "2026-01-01", "2026-01-03", "NASDAQ")
    india = backtester._download_close(["RELIANCE"], "2026-01-01", "2026-01-03", "NSE")

    assert requested == [["AAPL"], ["RELIANCE.NS"]]
    assert list(us.columns) == ["AAPL"]
    assert list(india.columns) == ["RELIANCE"]


def test_legacy_chart_without_market_uses_nasdaq_and_usd(monkeypatch) -> None:
    seen: dict[str, str] = {}

    class FakeRegistry:
        async def invoke(self, market, *_args):  # noqa: ANN001
            seen["market"] = market
            row = type(
                "Bar",
                (),
                {"o": 100.0, "h": 102.0, "l": 99.0, "c": 101.0, "v": 10.0, "t": int(datetime.now(timezone.utc).timestamp())},
            )()
            return [row]

    class FakeCache:
        @staticmethod
        def build_key(*parts):  # noqa: ANN002
            return ":".join(map(str, parts))

        async def get(self, _key):  # noqa: ANN001
            return None

        async def set(self, _key, _value, ttl):  # noqa: ANN001
            del ttl

    monkeypatch.setattr(chart, "get_adapter_registry", lambda: FakeRegistry())
    monkeypatch.setattr(chart, "cache_instance", FakeCache())

    response = asyncio.run(chart.get_chart("AAPL"))

    assert seen["market"] == "NASDAQ"
    assert response.currency == "USD"
