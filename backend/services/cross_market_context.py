"""Dated, pairwise market comparisons without inferred causality."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from backend.api.routes.chart import _parse_yahoo_chart

PERIOD_DAYS = {"1M": 30, "3M": 90, "6M": 180}
FETCH_RANGES = {"1M": "3mo", "3M": "6mo", "6M": "1y"}


def yahoo_adjusted_closes(raw: Any) -> dict[date, float]:
    """Read provider-supplied adjusted closes without assuming their vintage."""
    if not isinstance(raw, dict):
        return {}
    chart = raw.get("chart")
    if not isinstance(chart, dict):
        return {}
    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        return {}
    result = results[0]
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    if not isinstance(timestamps, list) or not isinstance(indicators, dict):
        return {}
    adjusted = indicators.get("adjclose")
    if not isinstance(adjusted, list) or not adjusted or not isinstance(adjusted[0], dict):
        return {}
    values = adjusted[0].get("adjclose")
    if not isinstance(values, list):
        return {}
    closes: dict[date, float] = {}
    for timestamp, value in zip(timestamps, values):
        try:
            day = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date()
            close = float(value)
        except (OSError, OverflowError, TypeError, ValueError):
            continue
        if math.isfinite(close) and close > 0:
            closes[day] = close
    return closes


def yahoo_action_metadata_present(raw: Any) -> bool:
    if not isinstance(raw, dict):
        return False
    chart = raw.get("chart")
    if not isinstance(chart, dict):
        return False
    results = chart.get("result")
    return (
        isinstance(results, list)
        and bool(results)
        and isinstance(results[0], dict)
        and isinstance(results[0].get("events"), dict)
    )


def yahoo_reported_actions(raw: Any) -> list[dict[str, str]]:
    """Extract dated split/dividend markers from a Yahoo chart response only."""
    if not isinstance(raw, dict):
        return []
    chart = raw.get("chart")
    if not isinstance(chart, dict):
        return []
    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        return []
    events = results[0].get("events") or {}
    if not isinstance(events, dict):
        return []
    actions: set[tuple[str, str]] = set()
    for event_key, action_type in (("splits", "split"), ("dividends", "dividend")):
        group = events.get(event_key) or {}
        if not isinstance(group, dict):
            continue
        for key, item in group.items():
            if not isinstance(item, dict):
                continue
            try:
                timestamp = int(item.get("date") or key)
                day = datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()
            except (OSError, OverflowError, TypeError, ValueError):
                continue
            actions.add((day, action_type))
    return [{"date": day, "type": action_type} for day, action_type in sorted(actions, reverse=True)]


def _technical_measures(closes: dict[date, float], shared: list[date]) -> dict[str, Any]:
    """Descriptive measures on the exact observed dates used by a pair."""
    peak = closes[shared[0]]
    peak_date = shared[0]
    worst_drawdown = 0.0
    worst_peak_date: date | None = None
    worst_trough_date: date | None = None
    for day in shared[1:]:
        close = closes[day]
        if close > peak:
            peak, peak_date = close, day
        drawdown = (peak - close) / peak * 100.0
        if drawdown > worst_drawdown:
            worst_drawdown = drawdown
            worst_peak_date, worst_trough_date = peak_date, day

    sma20_gap: float | None = None
    if len(shared) >= 20:
        mean = sum(closes[day] for day in shared[-20:]) / 20.0
        sma20_gap = (closes[shared[-1]] / mean - 1.0) * 100.0
    return {
        "max_drawdown_pct": round(worst_drawdown, 4),
        "max_drawdown_peak_date": worst_peak_date.isoformat() if worst_peak_date else None,
        "max_drawdown_trough_date": worst_trough_date.isoformat() if worst_trough_date else None,
        "sma20_gap_pct": round(sma20_gap, 4) if sma20_gap is not None else None,
    }


def adjusted_observations(closes: dict[date, float], shared: list[date]) -> dict[str, Any] | None:
    """Use one complete provider-adjusted series on the raw pair's exact dates."""
    if len(shared) < 2 or any(day not in closes for day in shared):
        return None
    return {
        "return_pct": round((closes[shared[-1]] / closes[shared[0]] - 1.0) * 100.0, 4),
        "technical_measures": _technical_measures(closes, shared),
    }


def _native_technical_observations(
    closes: dict[date, float], shared: list[date]
) -> dict[str, Any]:
    """Measure one asset's own dated closes inside the pair's observed window."""
    start, end = shared[0], shared[-1]
    native = sorted(day for day in closes if start <= day <= end)
    return {
        "start_date": native[0].isoformat(),
        "end_date": native[-1].isoformat(),
        "observations": len(native),
        "additional_dates_vs_pair": len(set(native) - set(shared)),
        "technical_measures": _technical_measures(closes, native),
    }


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
        "technical_observations": {
            "basis": "shared_utc_date_provider_closes",
            "as_of_date": end.isoformat(),
            "anchor": _technical_measures(anchor, shared),
            "comparison": _technical_measures(comparison, shared),
        },
        "native_technical_observations": {
            "basis": "per_asset_utc_date_provider_closes_within_pair_window",
            "anchor": _native_technical_observations(anchor, shared),
            "comparison": _native_technical_observations(comparison, shared),
        },
        "points": points,
    }
