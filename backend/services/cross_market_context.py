"""Dated, pairwise market comparisons without inferred causality."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from backend.api.routes.chart import _parse_yahoo_chart

PERIOD_DAYS = {"1M": 30, "3M": 90, "6M": 180}
FETCH_RANGES = {"1M": "3mo", "3M": "6mo", "6M": "1y"}


def _daily_closes(raw: Any) -> dict[date, float]:
    frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
    if frame.empty or "Close" not in frame:
        return {}
    closes: dict[date, float] = {}
    for timestamp, value in frame["Close"].items():
        try:
            close = float(value)
            day = pd.Timestamp(timestamp).date()
        except (TypeError, ValueError, OverflowError):
            continue
        if math.isfinite(close) and close > 0:
            closes[day] = close
    return closes


def compare_closes(
    anchor: dict[date, float],
    comparison: dict[date, float],
    *,
    period: str,
    today: date | None = None,
) -> dict[str, Any]:
    """Compare only closes observed on the same UTC calendar dates."""
    if not anchor or not comparison:
        return {"status": "unavailable", "reason": "missing_history"}

    end = min(max(anchor), max(comparison))
    cutoff = end - timedelta(days=PERIOD_DAYS[period])
    shared = sorted(day for day in anchor.keys() & comparison.keys() if cutoff <= day <= end)
    if len(shared) < 2 or shared[0] > cutoff + timedelta(days=7):
        return {
            "status": "unavailable",
            "reason": "insufficient_overlap",
            "anchor_latest_date": max(anchor).isoformat(),
            "comparison_latest_date": max(comparison).isoformat(),
        }

    start, end = shared[0], shared[-1]
    anchor_return = (anchor[end] / anchor[start] - 1.0) * 100.0
    comparison_return = (comparison[end] / comparison[start] - 1.0) * 100.0
    points = [
        {
            "date": day.isoformat(),
            "anchor_index": round(anchor[day] / anchor[start] * 100.0, 4),
            "comparison_index": round(comparison[day] / comparison[start] * 100.0, 4),
        }
        for day in shared
    ]
    observed_today = today or datetime.now(timezone.utc).date()
    return {
        "status": "available",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "anchor_latest_date": max(anchor).isoformat(),
        "comparison_latest_date": max(comparison).isoformat(),
        "observations": len(shared),
        "freshness": "stale" if observed_today - end > timedelta(days=7) else "current",
        "anchor_return_pct": round(anchor_return, 4),
        "comparison_return_pct": round(comparison_return, 4),
        "relative_return_pp": round(anchor_return - comparison_return, 4),
        "points": points,
    }
