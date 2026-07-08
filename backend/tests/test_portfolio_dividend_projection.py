"""Portfolio dividend tracker must surface projected dividends.

Regression: a monthly/quarterly ETF like JEIP.DE publishes no forward ex-date on
free sources, so its only announced dividends are historical and get filtered out
of the upcoming window. The dividend tracker used get_portfolio_events (announced
upcoming only) and showed nothing; it now uses get_upcoming_dividends(project=True),
which falls back to a labelled projection from the historical cadence.
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
from types import SimpleNamespace

from backend.equity.services.corporate_actions import CorporateEvent, EventType
from backend.services import portfolio_analytics as pa


def test_dividend_tracker_includes_projected_dividend(monkeypatch) -> None:
    next_ex = date.today() + timedelta(days=12)

    async def _fake_upcoming(symbols, days_ahead=30, project=True):
        # The projecting entry point returns a labelled estimate for JEIP.DE.
        assert project is True
        assert "JEIP.DE" in symbols
        return [
            CorporateEvent(
                symbol="JEIP.DE",
                event_type=EventType.DIVIDEND,
                title="Dividend (estimated)",
                description="Projected from a ~30-day historical cadence.",
                event_date=next_ex,
                ex_date=next_ex,
                value="0.40 per share",
                source="projection",
                impact="positive",
            )
        ]

    async def _fake_snapshot(_symbol):
        return {}  # no div_yield_pct → trailing-yield fallback contributes nothing

    # The tracker must NOT fall back to the non-projecting path.
    async def _boom(*_a, **_k):  # pragma: no cover - fails loudly if called
        raise AssertionError("dividend_tracker should use get_upcoming_dividends, not get_portfolio_events")

    monkeypatch.setattr(pa.corporate_actions_service, "get_upcoming_dividends", _fake_upcoming)
    monkeypatch.setattr(pa.corporate_actions_service, "get_portfolio_events", _boom)
    monkeypatch.setattr(pa, "fetch_stock_snapshot_coalesced", _fake_snapshot)

    holdings = [SimpleNamespace(ticker="JEIP.DE", quantity=100.0)]
    out = asyncio.run(pa.portfolio_analytics_service.dividend_tracker(holdings, days=180))

    rows = out["upcoming"]
    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "JEIP.DE"
    assert row["dividend_per_share"] == 0.40
    assert row["position_qty"] == 100.0
    assert row["projected_income"] == 40.0  # 0.40 * 100
    assert out["annual_income_projection"] == 40.0


def test_events_calendar_merges_projected_dividends(monkeypatch) -> None:
    from backend.equity.routes import events as events_route

    next_ex = date.today() + timedelta(days=8)
    projection = CorporateEvent(
        symbol="JEIP.DE",
        event_type=EventType.DIVIDEND,
        title="Dividend (estimated)",
        description="Projected.",
        event_date=next_ex,
        ex_date=next_ex,
        value="0.40 per share",
        source="projection",
        impact="positive",
    )

    async def _no_announced(_symbols, days_ahead=30):
        return []  # no announced upcoming events for JEIP.DE

    async def _with_projection(_symbols, days_ahead=30, project=True):
        return [projection]

    monkeypatch.setattr(events_route.corporate_actions_service, "get_portfolio_events", _no_announced)
    monkeypatch.setattr(events_route.corporate_actions_service, "get_upcoming_dividends", _with_projection)

    out = asyncio.run(events_route.get_portfolio_events(symbols="JEIP.DE", days=30))
    assert out["count"] == 1
    item = out["items"][0]
    assert item["symbol"] == "JEIP.DE"
    assert item["event_type"] == "dividend"
    assert item["source"] == "projection"
