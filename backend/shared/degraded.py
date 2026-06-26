"""Standard convention for signalling degraded / non-live data to clients.

The fork's north star is to help an individual invest *without being fooled*.
A service that silently fabricates plausible numbers when its real source is
unavailable directly violates that. The rule across the backend is therefore:

    wire real data, OR label it degraded — never pass fabricated data off as live.

This module is the single source of truth for that label. Attach the object
returned by :func:`degraded_marker` to any response that is NOT backed by a live
source, under the top-level key :data:`DEGRADED_KEY` (``"degraded"``). A single
frontend banner reads that key everywhere.

For *price series* (charts, tape, heatmap tiles, OHLCV) the policy is stricter:
do not return a synthetic series at all. Return an empty series plus the marker,
so the UI shows "data unavailable" rather than a convincing fake chart.
"""
from __future__ import annotations

from typing import Any

DEGRADED_KEY = "degraded"

# Canonical machine-readable reasons. Keep this list small and stable; the
# frontend maps them to human copy. Add new ones here rather than inventing
# ad-hoc strings at call sites.
REASON_NO_PROVIDER_DATA = "no_provider_data"   # provider reachable but returned nothing
REASON_PROVIDER_ERROR = "provider_error"       # provider raised / HTTP error / timeout
REASON_MISSING_API_KEY = "missing_api_key"     # required key not configured
REASON_RATE_LIMITED = "rate_limited"           # upstream 429 / quota exhausted
REASON_NO_LIVE_SOURCE = "no_live_source"       # no live integration exists yet (static stub)

# Source qualifier: where the returned payload actually came from.
SOURCE_FALLBACK = "fallback"     # fabricated / hardcoded placeholder
SOURCE_STALE_CACHE = "stale_cache"  # last-known cached value, past its freshness window


def degraded_marker(
    reason: str,
    *,
    source: str = SOURCE_FALLBACK,
    detail: str | None = None,
) -> dict[str, Any]:
    """Build the standard ``degraded`` marker object.

    Parameters
    ----------
    reason:
        One of the ``REASON_*`` constants — why the data is not live.
    source:
        One of the ``SOURCE_*`` constants — what the payload actually is.
    detail:
        Optional human-readable hint (e.g. which API key is missing). Never
        put secrets here.
    """
    marker: dict[str, Any] = {"reason": reason, "source": source}
    if detail:
        marker["detail"] = detail
    return marker


def mark_degraded(
    payload: dict[str, Any],
    reason: str,
    *,
    source: str = SOURCE_FALLBACK,
    detail: str | None = None,
) -> dict[str, Any]:
    """Attach a degraded marker to ``payload`` in place and return it.

    Convenience for the common ``return mark_degraded({...}, REASON_...)`` shape.
    """
    payload[DEGRADED_KEY] = degraded_marker(reason, source=source, detail=detail)
    return payload
