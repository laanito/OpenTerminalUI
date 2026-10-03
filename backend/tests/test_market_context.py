from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_unified_fetcher
from backend.api.routes import market_context
from backend.auth.deps import get_current_user
from backend.services.cross_market_context import _daily_closes, compare_closes
from backend.services.economic_data import get_economic_data_service


def _chart(closes: dict[date, float]) -> dict[str, Any]:
    days = sorted(closes)
    values = [closes[day] for day in days]
    return {
        "chart": {
            "result": [{
                "timestamp": [int(datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).timestamp()) for day in days],
                "indicators": {"quote": [{
                    "open": values, "high": values, "low": values, "close": values,
                    "volume": [100] * len(values),
                }]},
            }]
        }
    }


def test_pairwise_alignment_excludes_crypto_weekend_and_exposes_dates() -> None:
    start = date(2026, 8, 24)
    weekdays = [start + timedelta(days=i) for i in range(32) if (start + timedelta(days=i)).weekday() < 5]
    anchor = {day: 100.0 + i for i, day in enumerate(weekdays)}
    crypto = {start + timedelta(days=i): 200.0 + i for i in range(32)}
    result = compare_closes(anchor, crypto, period="1M", today=date(2026, 9, 24))
    assert result["status"] == "available"
    assert result["start_date"] == "2026-08-25"
    assert result["end_date"] == "2026-09-24"
    assert result["observations"] == len(weekdays) - 1
    assert result["comparison_latest_date"] == "2026-09-24"
    assert result["freshness"] == "current"
    assert result["anchor_return_pct"] == 21.7822
    assert len(result["points"]) == result["observations"]
    assert result["points"][0] == {
        "date": result["start_date"], "anchor_index": 100.0, "comparison_index": 100.0,
    }
    assert result["points"][-1]["date"] == result["end_date"]
    assert round(result["points"][-1]["anchor_index"] - 100.0, 4) == result["anchor_return_pct"]
    assert all(date.fromisoformat(point["date"]).weekday() < 5 for point in result["points"])


def test_short_or_disjoint_history_never_claims_full_period_return() -> None:
    early = {date(2026, 9, 1): 100.0, date(2026, 9, 24): 110.0}
    late = {date(2026, 9, 22): 200.0, date(2026, 9, 24): 220.0}
    assert compare_closes(early, late, period="1M")["reason"] == "insufficient_overlap"
    assert compare_closes(early, {}, period="1M")["reason"] == "missing_history"


def test_invalid_closes_are_ignored() -> None:
    closes = _daily_closes(_chart({date(2026, 9, 1): 100.0, date(2026, 9, 2): 0.0}))
    assert closes == {date(2026, 9, 1): 100.0}


def test_technical_measures_use_only_shared_unadjusted_closes() -> None:
    start = date(2026, 8, 1)
    days = [start + timedelta(days=i) for i in range(31)]
    anchor = {day: 100.0 for day in days}
    anchor[days[5]] = 120.0
    anchor[days[10]] = 90.0
    anchor[days[-1]] = 110.0
    comparison = {day: 100.0 + i for i, day in enumerate(days)}
    comparison[start + timedelta(days=31)] = 500.0  # never part of the pair

    result = compare_closes(anchor, comparison, period="1M", today=days[-1])
    technical = result["technical_observations"]
    assert technical["basis"] == "shared_utc_date_unadjusted_closes"
    assert technical["as_of_date"] == days[-1].isoformat()
    assert technical["anchor"] == {
        "max_drawdown_pct": 25.0,
        "max_drawdown_peak_date": days[5].isoformat(),
        "max_drawdown_trough_date": days[10].isoformat(),
        "sma20_gap_pct": 9.4527,
    }
    assert technical["comparison"]["max_drawdown_pct"] == 0.0
    assert technical["comparison"]["max_drawdown_peak_date"] is None


def test_short_shared_path_marks_sma20_unavailable() -> None:
    first = date(2026, 8, 1)
    last = first + timedelta(days=30)
    result = compare_closes({first: 100, last: 90}, {first: 100, last: 110}, period="1M", today=last)
    assert result["status"] == "available"
    assert result["technical_observations"]["anchor"]["sma20_gap_pct"] is None
    assert result["technical_observations"]["anchor"]["max_drawdown_pct"] == 10.0


def _client(data: dict[str, Any]) -> TestClient:
    class FakeFetcher:
        async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d") -> Any:
            assert range_str == "3mo"
            assert interval == "1d"
            value = data[ticker]
            if isinstance(value, Exception):
                raise value
            return value

        async def fetch_history_with_source(self, ticker: str, range_str: str = "1y", interval: str = "1d") -> tuple[Any, str]:
            data = await self.fetch_history(ticker, range_str=range_str, interval=interval)
            return data, "yahoo" if ticker == "AAPL" else "fmp"

    app = FastAPI()
    app.include_router(market_context.router)
    app.dependency_overrides[get_current_user] = lambda: object()
    app.dependency_overrides[get_unified_fetcher] = lambda: FakeFetcher()
    return TestClient(app)


def test_route_retains_partial_results_and_provider_failure() -> None:
    start = date(2026, 8, 24)
    days = [start + timedelta(days=i) for i in range(32)]
    client = _client({
        "AAPL": _chart({day: 100.0 + i for i, day in enumerate(days)}),
        "SPY": _chart({day: 200.0 + i for i, day in enumerate(days)}),
        "BTC-USD": RuntimeError("rate limited"),
    })
    response = client.post("/api/market-context/compare", json={
        "anchor": " aapl ", "comparisons": ["spy", "btc-usd", "SPY"], "period": "1M",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["anchor"] == "AAPL"
    assert payload["return_basis"] == "native_quote_currency_unadjusted"
    assert [row["symbol"] for row in payload["comparisons"]] == ["SPY", "BTC-USD"]
    assert payload["comparisons"][0]["status"] == "available"
    assert len(payload["comparisons"][0]["points"]) == payload["comparisons"][0]["observations"]
    assert payload["comparisons"][0]["anchor_history_source"] == "yahoo"
    assert payload["comparisons"][0]["comparison_history_source"] == "fmp"
    assert payload["comparisons"][0]["technical_observations"]["basis"] == "shared_utc_date_unadjusted_closes"
    assert payload["comparisons"][1]["reason"] == "provider_error"
    assert payload["comparisons"][1]["comparison_history_source"] is None
    assert payload["comparisons"][1]["technical_observations"] is None
    assert payload["comparisons"][1]["points"] == []


def test_route_rejects_anchor_as_comparison_and_bad_symbols() -> None:
    client = _client({})
    assert client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["aapl"]}).status_code == 422
    assert client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["bad symbol"]}).status_code == 422


def test_route_does_not_attribute_unusable_history() -> None:
    client = _client({"AAPL": {}, "SPY": {}})
    response = client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["SPY"]})
    assert response.status_code == 200
    row = response.json()["comparisons"][0]
    assert row["status"] == "unavailable"
    assert row["anchor_history_source"] is None
    assert row["comparison_history_source"] is None


def test_headline_context_filters_to_pair_window_and_keeps_partial_feed(monkeypatch) -> None:
    async def fake_news(symbol: str, market: str | None, limit: int) -> list[dict[str, str]]:
        assert market is None
        assert limit == 50
        if symbol == "SPY":
            raise RuntimeError("feed down")
        return [
            {"title": "In window", "url": "https://example.com/in", "source": "Wire", "published_at": "2026-09-02T00:30:00+02:00"},
            {"title": "At end", "url": "https://example.com/end", "source": "Wire", "published_at": "2026-09-10T23:00:00Z"},
            {"title": "Too late", "url": "https://example.com/late", "source": "Wire", "published_at": "2026-09-11T00:00:00Z"},
            {"title": "Undated", "url": "https://example.com/no-date", "source": "Wire"},
            {"title": "Unsafe", "url": "javascript:alert(1)", "source": "Wire", "published_at": "2026-09-05T10:00:00Z"},
        ]

    monkeypatch.setattr(market_context, "_fetch_ticker_news", fake_news)
    client = _client({})
    response = client.post("/api/market-context/headlines", json={
        "anchor": "aapl", "comparison": "spy", "start_date": "2026-09-02", "end_date": "2026-09-10",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "current_keyless_feeds"
    assert payload["fetch_limit_per_symbol"] == 50
    assert payload["groups"][0]["examined_count"] == 5
    assert payload["groups"][0]["matched_count"] == 1
    assert [item["title"] for item in payload["groups"][0]["headlines"]] == ["At end"]
    assert payload["groups"][1]["status"] == "feed_error"


def test_headline_context_rejects_invalid_pair_and_oversized_window() -> None:
    client = _client({})
    base = {"anchor": "AAPL", "comparison": "SPY", "start_date": "2026-09-01", "end_date": "2026-09-10"}
    assert client.post("/api/market-context/headlines", json={**base, "comparison": "AAPL"}).status_code == 422
    assert client.post("/api/market-context/headlines", json={**base, "end_date": "2026-08-30"}).status_code == 422
    assert client.post("/api/market-context/headlines", json={**base, "start_date": "2026-01-01"}).status_code == 422


def _macro_client(live: dict[str, Any]) -> TestClient:
    class FakeService:
        async def get_live_calendar(self, start: str, end: str) -> dict[str, Any]:
            assert start == "2026-09-02"
            assert end == "2026-09-10"
            return live

    app = FastAPI()
    app.include_router(market_context.router)
    app.dependency_overrides[get_current_user] = lambda: object()
    app.dependency_overrides[get_economic_data_service] = lambda: FakeService()
    return TestClient(app)


def test_macro_context_filters_provider_rows_to_requested_dates() -> None:
    client = _macro_client({
        "status": "available", "reason": None, "source": "fmp", "retrieved_at": "2026-09-11T10:00:00Z",
        "events": [
            {"date": "2026-09-05", "event_name": "Rate decision", "country": "US", "impact": "high"},
            {"date": "2026-09-11", "event_name": "Outside window", "country": "EU", "impact": "medium"},
            {"date": "bad", "event_name": "Undated", "country": "US", "impact": "low"},
        ],
    })
    response = client.post("/api/market-context/macro-events", json={"start_date": "2026-09-02", "end_date": "2026-09-10"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "fmp"
    assert payload["matched_count"] == 1
    assert [event["event_name"] for event in payload["events"]] == ["Rate decision"]


def test_macro_context_preserves_unavailable_state_without_sample() -> None:
    client = _macro_client({
        "status": "unavailable", "reason": "missing_api_key", "source": None,
        "retrieved_at": "2026-09-11T10:00:00Z", "events": [],
    })
    response = client.post("/api/market-context/macro-events", json={"start_date": "2026-09-02", "end_date": "2026-09-10"})
    assert response.status_code == 200
    assert response.json()["reason"] == "missing_api_key"
    assert response.json()["events"] == []
    assert client.post("/api/market-context/macro-events", json={"start_date": "2026-01-01", "end_date": "2026-09-10"}).status_code == 422


def _fundamentals_client(data: dict[str, Any]) -> TestClient:
    class FakeFetcher:
        async def fetch_pit_fundamentals_records(self, symbol: str) -> list[dict[str, Any]]:
            value = data[symbol]
            if isinstance(value, Exception):
                raise value
            return value

    app = FastAPI()
    app.include_router(market_context.router)
    app.dependency_overrides[get_current_user] = lambda: object()
    app.dependency_overrides[get_unified_fetcher] = lambda: FakeFetcher()
    return TestClient(app)


def test_fundamental_releases_keep_only_source_dated_window_candidates() -> None:
    dated = {
        "symbol": "AAPL", "metric": "revenue", "value": 100.0,
        "fiscal_period": "2026-06-30", "as_of_release_date": date(2026, 9, 5),
        "release_date_estimated": False, "source": "fmp",
    }
    client = _fundamentals_client({
        "AAPL": [
            dated, dict(dated),
            {**dated, "metric": "net_income", "value": 15.0, "release_date_estimated": True},
            {**dated, "metric": "eps", "as_of_release_date": "2026-09-11"},
            {**dated, "metric": "eps", "fiscal_period": "2026-10-01"},
            {**dated, "metric": "free_cash_flow", "value": float("nan")},
            {**dated, "metric": "total_assets"},
        ],
        "SPY": [],
    })
    response = client.post("/api/market-context/fundamental-releases", json={
        "anchor": "aapl", "comparison": "spy", "start_date": "2026-09-02", "end_date": "2026-09-10",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "on_demand_pit_fetch"
    assert payload["groups"][0]["examined_count"] == 7
    assert payload["groups"][0]["matched_count"] == 1
    assert payload["groups"][0]["releases"] == [{
        "release_date": "2026-09-05", "fiscal_period_end": "2026-06-30",
        "metric": "revenue", "value": 100.0, "source": "fmp",
    }]
    assert payload["groups"][1]["status"] == "no_usable_records"


def test_fundamental_releases_keep_partial_failure_and_validate_window() -> None:
    client = _fundamentals_client({"AAPL": [], "SPY": RuntimeError("provider failed")})
    base = {"anchor": "AAPL", "comparison": "SPY", "start_date": "2026-09-02", "end_date": "2026-09-10"}
    response = client.post("/api/market-context/fundamental-releases", json=base)
    assert response.status_code == 200
    assert [group["status"] for group in response.json()["groups"]] == ["no_usable_records", "feed_error"]
    assert client.post("/api/market-context/fundamental-releases", json={**base, "comparison": "AAPL"}).status_code == 422
    assert client.post("/api/market-context/fundamental-releases", json={**base, "start_date": "2026-01-01"}).status_code == 422
