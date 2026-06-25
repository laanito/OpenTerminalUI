"""Regression: correlation matrix with duplicate-ticker holdings (e.g. a 2nd lot).

Two purchases of the same symbol produce two Holding rows with the same ticker.
That used to create duplicate columns in the returns frame, so df.corr().loc[i, c]
returned a Series and float() raised TypeError (500 on
GET /api/portfolio/analytics/correlation). The service now de-dupes tickers.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from backend.services.portfolio_analytics import PortfolioAnalyticsService


def _holding(ticker: str):
    return SimpleNamespace(ticker=ticker, quantity=1.0, avg_buy_price=1.0, buy_date="2024-01-01")


def _price_series(seed: int) -> pd.Series:
    idx = pd.date_range("2024-01-01", periods=120, freq="D", tz="UTC")
    rng = np.random.default_rng(seed)
    return pd.Series(100.0 + rng.standard_normal(120).cumsum(), index=idx)


@pytest.mark.asyncio
async def test_correlation_matrix_dedupes_duplicate_tickers(monkeypatch):
    service = PortfolioAnalyticsService()

    async def fake_close(symbol: str, range_str: str = "5y", interval: str = "1d") -> pd.Series:
        return _price_series(hash(symbol) % 1000)

    monkeypatch.setattr(service, "_close_series", fake_close)

    # AAPL appears twice (two lots) — must not duplicate in the matrix.
    holdings = [_holding("AAPL"), _holding("MSFT"), _holding("AAPL")]
    result = await service.correlation_matrix(holdings, window=60)

    # Deduped to the unique set.
    assert result["symbols"] == ["AAPL", "MSFT"]
    # 2x2 matrix, every value a real float (the bug raised before reaching here).
    assert len(result["matrix"]) == 2
    for row in result["matrix"]:
        assert len(row) == 2
        for cell in row:
            assert isinstance(cell["value"], float)
    # Self-correlation on the diagonal is 1.0.
    diag = {(c["x"], c["y"]): c["value"] for row in result["matrix"] for c in row}
    assert diag[("AAPL", "AAPL")] == pytest.approx(1.0)
    assert diag[("MSFT", "MSFT")] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_correlation_matrix_empty_holdings():
    service = PortfolioAnalyticsService()
    result = await service.correlation_matrix([], window=60)
    assert result == {"symbols": [], "matrix": [], "rolling": []}
