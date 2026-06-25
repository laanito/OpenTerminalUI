"""Dividend + economic-calendar de-India / real-data regressions.

Before this work the dividend routes returned hardcoded NSE mock data and the
portfolio tracker stripped only "INR" (so USD/EUR dividends parsed to 0.0), and
the macro config / mock fallbacks carried India series. These tests lock in the
currency-agnostic amount parser and the region filtering.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.api.routes.dividends import _dividend_type
from backend.equity.services.corporate_actions import (
    CorporateEvent,
    EventType,
    corporate_actions_service,
    extract_amount,
)
from backend.services.economic_data import MACRO_CONFIG, EconomicDataService


def test_extract_amount_currency_agnostic():
    assert extract_amount("0.25 per share") == 0.25  # FMP shape
    assert extract_amount("$0.96") == 0.96
    assert extract_amount("€1.20") == 1.20
    assert extract_amount("INR 10") == 10.0
    assert extract_amount("Rs. 8.5 Final") == 8.5
    assert extract_amount("1,234.50") == 1234.5
    assert extract_amount(2.5) == 2.5


def test_extract_amount_handles_missing():
    assert extract_amount(None) is None
    assert extract_amount("") is None
    assert extract_amount("no number here") is None


def test_dividend_type_classification():
    assert _dividend_type("Special Dividend") == "Special"
    assert _dividend_type("Interim Dividend") == "Interim"
    assert _dividend_type("Final Dividend") == "Final"
    assert _dividend_type("Dividend Ex-Date") == "Dividend"


def test_macro_config_is_de_indianized():
    assert "india" not in MACRO_CONFIG
    assert set(MACRO_CONFIG) == {"us", "eu", "china"}


@pytest.mark.asyncio
async def test_macro_indicators_region_filter_no_key(monkeypatch):
    """With no FRED key the service returns its (de-Indianized) mock, and an
    unknown country still returns the full set rather than erroring."""
    svc = EconomicDataService()
    svc.fred_key = None  # force mock path

    monkeypatch.setattr("backend.shared.cache.cache.get", _async_none)
    monkeypatch.setattr("backend.shared.cache.cache.set", _async_noop)

    data = await svc.get_macro_indicators("US")
    assert "india" not in data
    assert "us" in data


async def _async_none(*args, **kwargs):
    return None


async def _async_noop(*args, **kwargs):
    return None


def _div(d: date, amt: float) -> CorporateEvent:
    return CorporateEvent(
        symbol="JEIP.DE",
        event_type=EventType.DIVIDEND,
        title="Dividend",
        description="x",
        event_date=d,
        ex_date=d,
        value=f"{amt} per share",
        source="yahoo",
        impact="positive",
    )


@pytest.mark.asyncio
async def test_project_next_dividend_monthly(monkeypatch):
    """A regular ~monthly payer with no announced forward date gets a labelled
    projection within the window (the JEIP.DE case)."""
    today = date.today()
    history = [_div(today - timedelta(days=30 * i), 0.18) for i in range(1, 7)]

    async def fake_history(symbol):
        return history

    monkeypatch.setattr(corporate_actions_service, "get_dividend_history", fake_history)
    proj = await corporate_actions_service.project_next_dividend("JEIP.DE", days_ahead=35)
    assert proj is not None
    assert proj.source == "projection"
    assert proj.title == "Dividend (estimated)"
    assert proj.ex_date >= today


@pytest.mark.asyncio
async def test_project_next_dividend_skips_irregular(monkeypatch):
    """One-off / sparse history must not be projected."""

    async def fake_history(symbol):
        return [_div(date(2020, 1, 1), 5.0), _div(date(2024, 6, 1), 1.0)]

    monkeypatch.setattr(corporate_actions_service, "get_dividend_history", fake_history)
    assert await corporate_actions_service.project_next_dividend("X", days_ahead=30) is None


def test_mock_calendar_is_flagged_sample():
    svc = EconomicDataService()
    events = svc._get_mock_calendar("2026-06-01", "2026-06-30")
    assert events and all(ev.get("sample") is True for ev in events)
    assert "IN" not in {ev["country"] for ev in events}
