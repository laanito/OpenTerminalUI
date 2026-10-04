"""Normalize source-dated fundamentals without inventing historical vintages."""

from __future__ import annotations

import math
from datetime import date
from typing import Any


CONTEXT_METRICS = frozenset({"revenue", "net_income", "eps", "free_cash_flow"})


def source_dated_candidates(
    raw: list[Any], *, start_date: date | None = None, end_date: date | None = None
) -> list[dict[str, Any]]:
    """Keep distinct current-fetch values with source-reported release dates."""
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[date, date, str, str, float]] = set()
    for item in raw:
        if not isinstance(item, dict) or item.get("release_date_estimated") is not False:
            continue
        try:
            release_date = date.fromisoformat(str(item["as_of_release_date"]))
            fiscal_end = date.fromisoformat(str(item["fiscal_period"]))
            metric = str(item["metric"])
            source = str(item["source"]).strip()
            value = float(item["value"])
        except (KeyError, OverflowError, TypeError, ValueError):
            continue
        if (
            metric not in CONTEXT_METRICS
            or not source
            or len(source) > 128
            or not math.isfinite(value)
            or release_date < fiscal_end
            or (start_date is not None and release_date < start_date)
            or (end_date is not None and release_date > end_date)
        ):
            continue
        identity = (release_date, fiscal_end, metric, source, value)
        if identity in seen:
            continue
        seen.add(identity)
        candidates.append({
            "release_date": release_date,
            "fiscal_period_end": fiscal_end,
            "metric": metric,
            "value": value,
            "source": source,
        })
    candidates.sort(key=lambda row: (
        row["release_date"], row["fiscal_period_end"], row["metric"], row["source"], row["value"]
    ), reverse=True)
    return candidates
