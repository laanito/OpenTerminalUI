from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import correlation
from backend.auth.deps import get_current_user
from backend.equity.services import corporate_actions


class MixedHistory:
    def __init__(self):
        self.calls: list[str] = []
        self.closes: dict[str, pd.Series] = {}

    async def fetch_history(self, ticker, range_str="1y", interval="1d"):
        assert range_str == "1y" and interval == "1d"
        assert ticker in {"BTC-USD", "AAPL", "SAP.DE"}
        self.calls.append(ticker)
        hour, minute = {"BTC-USD": (0, 0), "AAPL": (14, 30), "SAP.DE": (8, 0)}[ticker]
        dates = [datetime(2026, 11, 2, hour, minute, tzinfo=timezone.utc) + timedelta(days=i) for i in range(19)]
        if ticker != "BTC-USD":
            dates = [day for day in dates if day.weekday() < 5]
        prices = [100 + i * 2 + ((i % 3) - 1) * (1 if ticker == "BTC-USD" else 2) for i in range(len(dates))]
        self.closes[ticker] = pd.Series(prices, index=pd.DatetimeIndex(dates).normalize(), dtype=float)
        return {"chart": {"result": [{"timestamp": [int(day.timestamp()) for day in dates], "indicators": {"quote": [{"open": prices, "high": prices, "low": prices, "close": prices, "volume": [100]*len(dates)}]}}]}}


@pytest.fixture
def mixed_client(monkeypatch):
    fetcher = MixedHistory()

    async def get_fetcher():
        return fetcher

    async def no_cache(*args, **kwargs):
        return None

    monkeypatch.setattr(correlation, "get_unified_fetcher", get_fetcher)
    monkeypatch.setattr(correlation.cache_instance, "get", no_cache)
    monkeypatch.setattr(correlation.cache_instance, "set", no_cache)
    app = FastAPI()
    app.include_router(correlation.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="mixed-test")
    return TestClient(app), fetcher


def test_matrix_keeps_native_symbols_and_aligns_daily_dates(mixed_client):
    client, fetcher = mixed_client
    symbols = ["BTC-USD", "AAPL", "SAP.DE"]
    response = client.post("/api/correlation/matrix", json={"symbols": symbols})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["symbols"] == symbols
    assert fetcher.calls == symbols  # no exchange suffix or quote-currency rewrite
    expected = pd.concat({symbol: series.pct_change().dropna() for symbol, series in fetcher.closes.items()}, axis=1).dropna().corr()
    np.testing.assert_allclose(payload["matrix"], expected.values, atol=0.0001)
    assert payload["period_start"] == "2026-11-03"
    assert payload["period_end"] == "2026-11-20"


def test_rolling_and_clusters_share_the_mixed_date_alignment(mixed_client):
    client, _ = mixed_client
    rolling = client.post("/api/correlation/rolling", json={"symbol1": "BTC-USD", "symbol2": "SAP.DE", "window": 5, "period": "1Y"})
    assert rolling.status_code == 200, rolling.text
    assert rolling.json()["series"]
    assert all(datetime.fromisoformat(row["date"]).weekday() < 5 for row in rolling.json()["series"])
    clusters = client.post("/api/correlation/clusters", json={"symbols": ["BTC-USD", "AAPL", "SAP.DE"], "n_clusters": 2})
    assert clusters.status_code == 200, clusters.text
    assert sorted(name for group in clusters.json()["clusters"] for name in group["symbols"]) == ["AAPL", "BTC-USD", "SAP.DE"]


def test_returns_preserve_missing_close_dates_and_sort_observations():
    frame = pd.DataFrame({"Close": [120, 100, None, 110]}, index=pd.to_datetime(["2026-11-05T08:00Z", "2026-11-02T08:00Z", "2026-11-04T08:00Z", "2026-11-03T08:00Z"]))
    result = correlation._returns_from_close(frame)
    assert list(result.index.strftime("%Y-%m-%d")) == ["2026-11-03", "2026-11-05"]
    np.testing.assert_allclose(result.values, [.1, 120/110-1])


def test_conflicting_daily_closes_are_not_arbitrarily_chosen():
    index = pd.to_datetime(["2026-11-02T08:00Z", "2026-11-02T14:30Z", "2026-11-03T08:00Z"])
    assert correlation._returns_from_close(pd.DataFrame({"Close": [100, 101, 110]}, index=index)).empty
    result = correlation._returns_from_close(pd.DataFrame({"Close": [100, 100, 110]}, index=index))
    assert len(result) == 1 and result.iloc[0] == pytest.approx(.1)


@pytest.mark.parametrize("symbol", ["BTC-USD", "BTC-EUR", "BTC-INR", "CRYPTO:ETH-USD", "ETHUSDT"])
def test_crypto_never_requests_yahoo_stock_calendars_or_dividends(monkeypatch, symbol):
    async def unexpected_fetcher():
        pytest.fail("crypto must not start a stock-calendar/dividend lookup")

    monkeypatch.setattr(corporate_actions, "get_unified_fetcher", unexpected_fetcher)
    service = corporate_actions.CorporateActionsService()
    assert asyncio.run(service._fetch_yahoo_events(symbol)) == []
    assert asyncio.run(service._fetch_yahoo_chart_dividends(symbol)) == []


@pytest.mark.parametrize("symbol", ["AAPL", "SAP.DE", "RELIANCE.NS"])
def test_non_crypto_calendar_symbols_remain_native(monkeypatch, symbol):
    calls = []

    async def summary(native, modules):
        calls.append(native)
        return {"calendarEvents": {"earnings": {"earningsDate": ["2026-12-01"]}}}

    async def chart(native, **kwargs):
        calls.append(native)
        return {"chart": {"result": [{"events": {"dividends": {"one": {"date": 1796083200, "amount": .5}}}}]}}

    async def get_fetcher():
        return SimpleNamespace(yahoo=SimpleNamespace(get_quote_summary=summary, get_chart=chart))

    monkeypatch.setattr(corporate_actions, "get_unified_fetcher", get_fetcher)
    service = corporate_actions.CorporateActionsService()
    assert asyncio.run(service._fetch_yahoo_events(symbol))
    assert asyncio.run(service._fetch_yahoo_chart_dividends(symbol))
    assert calls == [symbol, symbol]


def test_nonoverlapping_dates_still_fail_instead_of_filling_prices(mixed_client, monkeypatch):
    client, fetcher = mixed_client
    original = fetcher.fetch_history

    async def shifted_history(ticker, **kwargs):
        data = await original(ticker, **kwargs)
        if ticker == "AAPL":
            chart = data["chart"]["result"][0]
            chart["timestamp"] = [stamp + 90*86400 for stamp in chart["timestamp"]]
        return data

    monkeypatch.setattr(fetcher, "fetch_history", shifted_history)
    response = client.post("/api/correlation/matrix", json={"symbols": ["BTC-USD", "AAPL"]})
    assert response.status_code == 404
    assert response.json()["detail"] == "No overlapping return series available"
