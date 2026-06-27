"""Regression: crypto holdings must not all collapse into the "Unknown" sector.

Crypto pairs (BTC-USD, …) carry no equity sector, so the snapshot returns none.
Sector allocation now buckets them under "Crypto" (the meaningful asset-class
grouping) instead of "Unknown", while real equities without a sector still fall
back to "Unknown".
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.portfolio_analytics import PortfolioAnalyticsService
import backend.services.portfolio_analytics as pa


def _holding(ticker: str, qty: float = 1.0, price: float = 100.0):
    return SimpleNamespace(ticker=ticker, quantity=qty, avg_buy_price=price, buy_date="2024-01-01")


@pytest.mark.asyncio
async def test_sector_allocation_buckets_crypto_not_unknown(monkeypatch):
    service = PortfolioAnalyticsService()

    async def fake_snapshot(ticker: str) -> dict:
        if ticker.upper() == "AAPL":
            return {"sector": "Technology", "current_price": 100.0}
        # Crypto + a sector-less equity both return no sector.
        return {"current_price": 100.0}

    monkeypatch.setattr(pa, "fetch_stock_snapshot_coalesced", fake_snapshot)

    holdings = [_holding("AAPL"), _holding("BTC-USD"), _holding("ETH-USD"), _holding("OBSCURE")]
    result = await service.sector_allocation(holdings)

    sectors = {s["sector"] for s in result["sectors"]}
    assert "Crypto" in sectors
    assert "Technology" in sectors
    # Sector-less equity still falls back to Unknown; crypto does not.
    assert "Unknown" in sectors

    by_name = {s["sector"]: s for s in result["sectors"]}
    # BTC + ETH both land in the single Crypto bucket.
    assert by_name["Crypto"]["value"] == pytest.approx(200.0)
