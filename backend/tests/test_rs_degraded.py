"""Regression: the Relative Strength API must not fabricate live data.

The previous implementation returned hardcoded Indian symbols (RELIANCE/TCS/
INFY, NIFTY50) dressed up as live RS data. Until a real RS engine is wired, every
endpoint must return an empty payload plus the standard `degraded` marker, with
de-India'd defaults (S&P 500 / SPY).
"""

from __future__ import annotations

import asyncio

from backend.api.routes import rs
from backend.shared.degraded import DEGRADED_KEY, REASON_NO_LIVE_SOURCE

_INDIA_SYMBOLS = {"RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "NIFTY50"}


def _assert_degraded(payload: dict) -> None:
    marker = payload.get(DEGRADED_KEY)
    assert marker is not None, "every RS endpoint must flag itself degraded"
    assert marker["reason"] == REASON_NO_LIVE_SOURCE


def test_rankings_empty_degraded_and_us_default() -> None:
    payload = asyncio.run(rs.get_rs_rankings())
    assert payload["items"] == []
    assert payload["universe"] == "S&P 500"  # de-India'd default
    _assert_degraded(payload)


def test_sector_rs_empty_degraded() -> None:
    payload = asyncio.run(rs.get_sector_rs())
    assert payload["sectors"] == []
    _assert_degraded(payload)


def test_chart_empty_degraded_and_spy_benchmark() -> None:
    payload = asyncio.run(rs.get_rs_chart_data("aapl"))
    assert payload["series"] == []
    assert payload["symbol"] == "AAPL"
    assert payload["benchmark"] == "SPY"  # was NIFTY50
    _assert_degraded(payload)


def test_new_highs_empty_degraded() -> None:
    payload = asyncio.run(rs.get_rs_new_highs())
    assert payload["items"] == []
    _assert_degraded(payload)


def test_no_india_symbols_anywhere() -> None:
    blobs = [
        str(asyncio.run(rs.get_rs_rankings())),
        str(asyncio.run(rs.get_sector_rs())),
        str(asyncio.run(rs.get_rs_chart_data("AAPL"))),
        str(asyncio.run(rs.get_rs_new_highs())),
    ]
    joined = " ".join(blobs).upper()
    for sym in _INDIA_SYMBOLS:
        assert sym not in joined, f"RS API still leaks India symbol {sym}"
