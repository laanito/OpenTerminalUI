from __future__ import annotations

import pytest

from backend.core.yahoo_client import _clamp_range_for_interval


@pytest.mark.parametrize(
    "range_str,interval,expected",
    [
        # The reported 422: 1-minute bars over a 1-month range. Yahoo caps 1m at
        # ~7 days/request, so clamp down to the largest token that fits (5d).
        ("1mo", "1m", "5d"),
        ("1d", "1m", "1d"),      # already within the limit
        ("5d", "1m", "5d"),      # exactly the largest token that fits
        ("6mo", "5m", "1mo"),    # 5m allows 60d -> 1mo is the largest token <= 60d
        ("1y", "15m", "1mo"),    # 15m allows 60d
        ("2y", "1h", "2y"),      # 1h allows 730d -> 2y fits
        ("max", "1h", "2y"),     # 1h -> clamp unbounded range down to 2y
        # Daily and coarser have no per-request limit and are untouched.
        ("10y", "1d", "10y"),
        ("1y", "1d", "1y"),
        ("max", "1mo", "max"),
    ],
)
def test_clamp_range_for_interval(range_str: str, interval: str, expected: str) -> None:
    assert _clamp_range_for_interval(range_str, interval) == expected
