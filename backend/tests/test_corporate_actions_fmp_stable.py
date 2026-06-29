"""The corporate-actions FMP calls must use the /stable endpoint shapes.

Regression for the legacy /api/v3 paths (/historical-price-full/stock_dividend/
{symbol}, .../stock_split/..., /ipo_calendar) that 404 on the /stable base, and
for skipping crypto (which has no dividends/splits/IPO).
"""

from __future__ import annotations

import asyncio

import backend.equity.services.corporate_actions as ca
from backend.equity.services.corporate_actions import EventType, corporate_actions_service


class _FakeFMP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict | None]] = []

    def _symbol(self, s: str) -> str:
        return s.strip().upper()

    async def _get(self, endpoint: str, params: dict | None = None):
        self.calls.append((endpoint, params))
        if endpoint == "/dividends":
            return [{"date": "2024-02-09", "adjDividend": 0.24, "dividend": 0.24}]
        if endpoint == "/splits":
            return [{"date": "2020-08-31", "numerator": 4, "denominator": 1}]
        if endpoint == "/ipos-calendar":
            return [{"symbol": "AAPL", "date": "2024-01-10", "company": "Apple"}]
        return []


def _patch_fetcher(monkeypatch, fmp: _FakeFMP) -> None:
    class _FakeFetcher:
        def __init__(self) -> None:
            self.fmp = fmp

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(ca, "get_unified_fetcher", _fake_get_unified_fetcher)


def test_dividends_splits_use_stable_endpoints(monkeypatch):
    fmp = _FakeFMP()
    _patch_fetcher(monkeypatch, fmp)

    events = asyncio.run(corporate_actions_service._fetch_fmp_dividends_splits("AAPL"))

    assert ("/dividends", {"symbol": "AAPL"}) in fmp.calls
    assert ("/splits", {"symbol": "AAPL"}) in fmp.calls
    # No legacy path-segment endpoints.
    assert all("historical-price-full" not in ep for ep, _ in fmp.calls)

    kinds = {e.event_type for e in events}
    assert EventType.DIVIDEND in kinds
    assert EventType.SPLIT in kinds


def test_ipo_uses_stable_calendar_with_window(monkeypatch):
    fmp = _FakeFMP()
    _patch_fetcher(monkeypatch, fmp)

    asyncio.run(corporate_actions_service._fetch_fmp_ipo("AAPL"))

    assert len(fmp.calls) == 1
    endpoint, params = fmp.calls[0]
    assert endpoint == "/ipos-calendar"
    assert params is not None and "from" in params and "to" in params


def test_crypto_skips_fmp_corporate_actions(monkeypatch):
    fmp = _FakeFMP()
    _patch_fetcher(monkeypatch, fmp)

    assert asyncio.run(corporate_actions_service._fetch_fmp_dividends_splits("BTC-USD")) == []
    assert asyncio.run(corporate_actions_service._fetch_fmp_ipo("BTC-EUR")) == []
    assert fmp.calls == []  # no FMP calls made for crypto
