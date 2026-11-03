"""Standalone, current-source technical evidence for bounded research consumers.

No model, portfolio, private notes, database, comparison pair or historical
knowledge reconstruction. Callers decide relevant symbols and outer budgets.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.services.cross_market_context import daily_closes_with_conflicts
from backend.services.technical_inputs import _MAX_SOURCE_ROWS, TechnicalInstrumentInput, technical_instrument_input
from backend.services.technical_indicators import TechnicalInstrumentIndicators, calculate_instrument_indicators


class TechnicalSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    symbol: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z0-9^._=-]+$")
    interval: Literal["1d"] = "1d"
    lookback_calendar_days: int = Field(default=90, ge=1, le=181, strict=True)

    @field_validator("symbol", mode="before")
    @classmethod
    def normalise_symbol(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("Technical snapshot symbol must be a string")
        return value.strip().upper()


class TechnicalSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    snapshot_id: str
    request: TechnicalSnapshotRequest
    retrieved_at: datetime
    history_semantics: Literal["current_source_history_not_point_in_time"] = "current_source_history_not_point_in_time"
    status: Literal["available", "partial", "unavailable"]
    inputs: TechnicalInstrumentInput
    indicators: TechnicalInstrumentIndicators


class TechnicalHistoryFetcher(Protocol):
    async def fetch_history_with_provenance(
        self, symbol: str, *, range_str: str, interval: str,
    ) -> tuple[Any, str | None, str | None]: ...


def build_technical_snapshot(
    request: TechnicalSnapshotRequest, raw: Any, *, source: str | None, feed: str | None,
    retrieved_at: datetime | None = None, failure_reason: Literal["provider_error", "provider_timeout", "unsupported_or_unknown_feed"] | None = None,
) -> TechnicalSnapshot:
    """Project one original history payload into reproducible technical evidence.

    Window bounds come from original source timestamps, before normalization can
    discard a bad edge row. A selected-source defect withholds all input values.
    The last 20/21 accepted closes drive the fixed v1 measures, never padding.
    """
    retrieved_at = retrieved_at or datetime.now(timezone.utc)
    if retrieved_at.utcoffset() is None:
        raise ValueError("Technical snapshot retrieval time must be timezone-aware")
    retrieved_at = retrieved_at.astimezone(timezone.utc)
    end = retrieved_at.date()
    start = end - timedelta(days=request.lookback_calendar_days - 1)
    if failure_reason is not None:
        raw = None
        source = feed = None
    # Bound selected-row parsing too, including payloads with a source sidecar.
    # The source selector independently bounds/revalidates the original copy.
    try:
        stamps = raw["chart"]["result"][0]["timestamp"]
        if not isinstance(stamps, list) or not 1 <= len(stamps) <= _MAX_SOURCE_ROWS:
            raise ValueError("invalid source shape")
        accepted, _ = daily_closes_with_conflicts(raw)
    except (KeyError, IndexError, TypeError, ValueError, AttributeError, OverflowError):
        raw, accepted = None, {}
    inputs = technical_instrument_input(
        raw, symbol=request.symbol, source=source, feed=feed, accepted_closes=accepted,
        requested_start=start, requested_end=end,
    )
    if failure_reason is not None:
        # Collection failures carry no stale source rows or guessed source labels.
        inputs = inputs.model_copy(update={"reason": failure_reason})
    indicators = calculate_instrument_indicators(inputs)
    content = {"schema_version": 1, "request": request.model_dump(mode="json"),
               "history_semantics": "current_source_history_not_point_in_time",
               "inputs": inputs.model_dump(mode="json"), "indicators": indicators.model_dump(mode="json")}
    identity = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()[:24]
    return TechnicalSnapshot(snapshot_id="ts_" + identity, request=request, retrieved_at=retrieved_at,
                             status=indicators.status, inputs=inputs, indicators=indicators)


async def collect_technical_snapshot(
    request: TechnicalSnapshotRequest, fetcher: TechnicalHistoryFetcher, *,
    timeout_seconds: float = 15.0, retrieved_at: datetime | None = None,
) -> TechnicalSnapshot:
    """One bounded provenance-aware fetch, no fallback query or internal cache.

    Cancellation propagates; a caller's outer deadline can remain authoritative.
    Existing fetcher adapters may have their own source fallback, whose actual
    feed identity is assessed here rather than silently replaced with Yahoo.
    """
    if (isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float))
            or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 45):
        raise ValueError("Technical collection timeout must be finite and positive, at most 45 seconds")
    if retrieved_at is not None and retrieved_at.utcoffset() is None:
        raise ValueError("Technical snapshot retrieval time must be timezone-aware")
    fetch = getattr(fetcher, "fetch_history_with_provenance", None)
    failure = None
    source = feed = None
    raw = None
    if not callable(fetch):
        failure = "unsupported_or_unknown_feed"
    else:
        try:
            async with asyncio.timeout(timeout_seconds):
                raw, source, feed = await fetch(
                    request.symbol, range_str="3mo" if request.lookback_calendar_days <= 90 else "6mo", interval="1d",
                )
        except TimeoutError:
            failure = "provider_timeout"
        except Exception:
            # Never log arbitrary provider exceptions/URLs or copy them to evidence.
            failure = "provider_error"
    return build_technical_snapshot(request, raw, source=source, feed=feed,
                                    retrieved_at=retrieved_at, failure_reason=failure)
