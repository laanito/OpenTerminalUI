from __future__ import annotations

from datetime import date

import pytest

from backend.services import economic_data


@pytest.fixture
def uncached(monkeypatch):
    async def cache_get(key: str):  # noqa: ARG001
        return None

    async def cache_set(key: str, value, ttl: int):  # noqa: ARG001
        return None

    monkeypatch.setattr(economic_data.cache, "get", cache_get)
    monkeypatch.setattr(economic_data.cache, "set", cache_set)


@pytest.mark.asyncio
async def test_live_calendar_never_uses_legacy_sample_without_keys(uncached) -> None:  # noqa: ARG001
    service = economic_data.EconomicDataService()
    service.finnhub_key = None
    service.fmp_key = None

    live = await service.get_live_calendar("2026-09-01", "2026-09-10")
    assert live["status"] == "unavailable"
    assert live["reason"] == "missing_api_key"
    assert live["events"] == []

    legacy = await service.get_economic_calendar("2026-09-01", "2026-09-10")
    assert legacy
    assert all(event["sample"] is True for event in legacy)


@pytest.mark.asyncio
async def test_live_calendar_identifies_fallback_source(uncached, monkeypatch) -> None:  # noqa: ARG001
    service = economic_data.EconomicDataService()
    service.finnhub_key = "test"
    service.fmp_key = "test"
    called = []

    async def fake_source(source: str, key: str, start: str, end: str):  # noqa: ARG001
        called.append(source)
        if source == "finnhub":
            raise RuntimeError("provider down")
        return [{"date": "2026-09-05", "event_name": "Rate decision", "impact": "unknown"}]

    monkeypatch.setattr(service, "_fetch_live_calendar_source", fake_source)
    live = await service.get_live_calendar("2026-09-01", "2026-09-10")
    assert called == ["finnhub", "fmp"]
    assert live["status"] == "available"
    assert live["source"] == "fmp"
    assert live["events"][0]["event_name"] == "Rate decision"


@pytest.mark.asyncio
async def test_live_calendar_reports_provider_failure_without_sample(uncached, monkeypatch) -> None:  # noqa: ARG001
    service = economic_data.EconomicDataService()
    service.finnhub_key = "test"
    service.fmp_key = None

    async def failed_source(source: str, key: str, start: str, end: str):  # noqa: ARG001
        raise RuntimeError("unavailable")

    monkeypatch.setattr(service, "_fetch_live_calendar_source", failed_source)
    live = await service.get_live_calendar("2026-09-01", "2026-09-10")
    assert live["status"] == "unavailable"
    assert live["reason"] == "provider_error"
    assert live["events"] == []


@pytest.mark.asyncio
async def test_fmp_calendar_discards_undated_rows_and_does_not_invent_impact(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return [
                {"date": "2026-09-05 14:00:00", "event": "Rate decision", "country": "US"},
                {"date": "bad", "event": "Undated", "country": "US"},
            ]

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
            return None

        async def get(self, url: str, params: dict):  # noqa: ARG002
            return FakeResponse()

    monkeypatch.setattr(economic_data.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    service = economic_data.EconomicDataService()
    events = await service._fetch_live_calendar_source("fmp", "test", "2026-09-01", "2026-09-10")
    assert len(events) == 1
    assert events[0]["date"] == "2026-09-05"
    assert events[0]["impact"] == "unknown"


def test_live_calendar_unknown_impact_is_not_mislabeled_low() -> None:
    assert economic_data.EconomicDataService._calendar_impact(None) == "unknown"
    assert economic_data.EconomicDataService._calendar_impact("unexpected") == "unknown"
    assert economic_data.EconomicDataService._calendar_impact(3) == "high"


@pytest.mark.asyncio
async def test_macro_context_never_falls_back_to_dashboard_samples() -> None:
    service = economic_data.EconomicDataService()
    service.fred_key = None
    result = await service.get_market_context_macro_observations(date(2026, 9, 1), date(2026, 9, 30))
    assert result["status"] == "unavailable"
    assert result["reason"] == "missing_api_key"
    assert result["series"] == []


@pytest.mark.asyncio
async def test_macro_context_preserves_reference_dates_metadata_and_partial_failure(monkeypatch) -> None:
    requests = []

    class FakeResponse:
        def __init__(self, data):
            self.data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self.data

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
            return None

        async def get(self, url, params):  # noqa: ANN001
            requests.append((url, params))
            assert params["realtime_start"] == params["realtime_end"]
            if params["series_id"] == "FEDFUNDS":
                raise RuntimeError("provider down")
            if url.endswith("/series"):
                return FakeResponse({"seriess": [{
                    "id": params["series_id"], "title": "Provider title",
                    "units": "Percent", "frequency": "Monthly",
                }]})
            assert params["observation_start"] == "2026-09-01"
            assert params["observation_end"] == "2026-09-30"
            return FakeResponse({"observations": [
                {"date": "2026-09-01", "value": "3.5"},
                {"date": "2026-09-01", "value": "3.5"},
                {"date": "2026-09-02", "value": "4.0"},
                {"date": "2026-09-02", "value": "5.0"},
                {"date": "2026-09-03", "value": "."},
                {"date": "2026-10-01", "value": "8.0"},
            ]})

    monkeypatch.setattr(economic_data.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    service = economic_data.EconomicDataService()
    service.fred_key = "test-key"
    result = await service.get_market_context_macro_observations(date(2026, 9, 1), date(2026, 9, 30))
    assert result["status"] == "available"
    assert result["reason"] is None
    assert len(requests) == 6
    cpi = result["series"][0]
    assert cpi["series_id"] == "CPIAUCSL"
    assert cpi["units"] == "Percent"
    assert cpi["matched_count"] == 1
    assert cpi["withheld_conflict_count"] == 1
    assert cpi["observations"] == [{"reference_date": date(2026, 9, 1), "value": 3.5}]
    assert result["series"][2]["status"] == "feed_error"


@pytest.mark.asyncio
async def test_macro_context_reports_total_provider_failure(monkeypatch) -> None:
    service = economic_data.EconomicDataService()
    service.fred_key = "test-key"

    async def fail(*args):  # noqa: ANN002
        raise ValueError("provider failed")

    monkeypatch.setattr(service, "_fetch_market_context_fred_series", fail)
    result = await service.get_market_context_macro_observations(date(2026, 9, 1), date(2026, 9, 30))
    assert result["status"] == "unavailable"
    assert result["reason"] == "provider_error"
    assert [group["status"] for group in result["series"]] == ["feed_error"] * 3
