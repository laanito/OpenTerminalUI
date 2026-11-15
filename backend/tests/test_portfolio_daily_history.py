"""Daily portfolio comparisons align exchange sessions by UTC date, not hour."""
from types import SimpleNamespace

import pandas as pd
import pytest

from backend.services import portfolio_analytics as analytics
from backend.services.portfolio_analytics import PortfolioAnalyticsService


@pytest.fixture
def daily_market(monkeypatch):
    # Thursday through Monday: crypto trades on the weekend; US index does not.
    crypto = {"2026-11-12": 100., "2026-11-13": 110., "2026-11-14": 115., "2026-11-15": 120., "2026-11-16": 130.}
    benchmark = {"2026-11-13": 5000., "2026-11-16": 5100.}
    payloads = {}
    for symbol, prices, hour in (("BTC-USD", crypto, "00:00"), ("^GSPC", benchmark, "14:30")):
        payloads[symbol] = {"chart": {"result": [{
            "timestamp": [int(pd.Timestamp(f"{day}T{hour}:00Z").timestamp()) for day in prices],
            "indicators": {"quote": [{"close": list(prices.values())}]},
        }]}}
    requests = []
    async def history(symbol, **kwargs):
        requests.append((symbol, kwargs))
        return payloads.get(symbol, {})
    async def fetcher(): return SimpleNamespace(fetch_history=history)
    async def snapshot(symbol): return {"currency": "USD"}
    async def rates(source, target, dates):
        assert source == target == "USD"
        return {day.isoformat(): {"rate": 1., "requested_date": day.isoformat(), "rate_at": day.isoformat(),
                "source_symbol": "USDUSD", "degraded": False} for day in dates}
    monkeypatch.setattr(analytics, "get_unified_fetcher", fetcher)
    monkeypatch.setattr(analytics, "fetch_stock_snapshot_coalesced", snapshot)
    monkeypatch.setattr(analytics.forex_service, "get_historical_valuation_rates", rates)
    return payloads, requests


@pytest.mark.asyncio
@pytest.mark.parametrize("benchmark_format", ["yahoo", "fmp"])
async def test_crypto_and_equity_benchmark_share_daily_labels_despite_session_hours(daily_market, benchmark_format):
    if benchmark_format == "fmp":
        daily_market[0]["^GSPC"] = {"historical": [{"date": "2026-11-13", "close": 5000.}, {"date": "2026-11-16", "close": 5100.}]}
    service = PortfolioAnalyticsService()
    result = await service.benchmark_overlay([SimpleNamespace(ticker="BTC-USD", quantity=2., buy_date="2026-11-12")])
    assert result["status"] == "complete", result
    assert result["issues"] == []
    curve = result["equity_curve"]
    # Thursday has no earlier benchmark observation: never backfill from Friday.
    assert [point["date"] for point in curve] == ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]
    assert [point["benchmark"] for point in curve] == pytest.approx([1., 1., 1., 1.02])
    assert [point["portfolio_value_base"] for point in curve] == pytest.approx([220., 230., 240., 260.])
    assert curve[-1]["portfolio"] == pytest.approx(130 / 110)
    assert all(kwargs["interval"] == "1d" for _, kwargs in daily_market[1])


@pytest.mark.asyncio
@pytest.mark.parametrize("format", ["yahoo", "fmp"])
async def test_daily_close_labels_are_utc_midnights_for_both_history_formats(daily_market, format):
    payloads, _ = daily_market
    if format == "fmp":
        payloads["^GSPC"] = {"historical": [{"date": "2026-11-13", "close": 5000.}, {"date": "2026-11-16", "close": 5100.}]}
    series = await PortfolioAnalyticsService()._close_series("^GSPC")
    assert list(series.index) == list(pd.to_datetime(["2026-11-13T00:00:00Z", "2026-11-16T00:00:00Z"]))
    assert list(series.values) == [5000., 5100.]


@pytest.mark.asyncio
async def test_intraday_requests_keep_their_actual_timestamp(daily_market):
    series = await PortfolioAnalyticsService()._close_series("^GSPC", interval="1h")
    assert series.index[0] == pd.Timestamp("2026-11-13T14:30:00Z")


@pytest.mark.asyncio
async def test_missing_benchmark_still_reports_unavailable_instead_of_inventing_rows(daily_market):
    daily_market[0]["^GSPC"] = {}
    result = await PortfolioAnalyticsService().benchmark_overlay([SimpleNamespace(ticker="BTC-USD", quantity=1., buy_date="2026-11-12")])
    assert result["status"] == "partial" and result["equity_curve"] == []
    assert {issue["code"] for issue in result["issues"]} >= {"price_history_unavailable", "benchmark_history_unavailable"}


@pytest.mark.asyncio
async def test_daily_labels_use_the_utc_day_instead_of_the_exchange_local_day(daily_market):
    daily_market[0]["LATE"] = {"chart": {"result": [{
        "timestamp": [int(pd.Timestamp("2026-11-13T23:30:00-05:00").timestamp())],
        "indicators": {"quote": [{"close": [123.]}]},
    }]}}
    close = await PortfolioAnalyticsService()._close_series("LATE")
    assert list(close.index) == [pd.Timestamp("2026-11-14T00:00:00Z")]
    assert list(close.values) == [123.]
