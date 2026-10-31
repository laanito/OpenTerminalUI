"""Bounded, descriptive technical inputs; never a verified trading signal.

Retain original Yahoo fields before adapter normalization can lose defects.
Eligibility means the stated observed-data contract passed, not that provider
adjustments, exchange calendars, bar completion or historical vintages were audited.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field

CONTRACT = "yahoo-adjusted-own-dates-v1"
_MAX_SOURCE_ROWS = 1000
_META_FIELDS = ("symbol", "instrumentType", "currency", "exchangeTimezoneName", "dataGranularity")


class TechnicalInputPoint(BaseModel):
    date: date
    provider_close: float = Field(gt=0, allow_inf_nan=False)
    adjusted_close: float = Field(gt=0, allow_inf_nan=False)


class TechnicalAssetInput(BaseModel):
    contract: Literal["yahoo-adjusted-own-dates-v1"]
    symbol: str
    status: Literal["available", "unavailable"]
    reason: str | None
    source: str | None
    feed: str | None
    price_basis: Literal["yahoo_reported_adjclose"]
    sampling: Literal["own_utc_dates_within_pair_window"]
    adjustment_verification: Literal["not_independently_verified"]
    session_verification: Literal["not_performed"]
    bar_completion: Literal["not_verified"]
    pair_start_date: date | None
    pair_end_date: date | None
    source_symbol: str | None = None
    instrument_type: str | None = None
    quote_unit: str | None = None
    exchange_timezone: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    observations: int = 0
    additional_dates_vs_pair: int = 0
    shifted_local_dates: int = 0
    freshness: Literal["current", "stale"] | None = None
    input_id: str | None = None
    points: list[TechnicalInputPoint] = Field(default_factory=list, max_length=181)


class TechnicalPairInputs(BaseModel):
    anchor: TechnicalAssetInput
    comparison: TechnicalAssetInput


def capture_yahoo_technical_chart(raw: Any) -> dict[str, Any]:
    """Copy only bounded source fields, with no provider URLs or arbitrary metadata."""
    try:
        chart = raw["chart"]
        results = chart["result"]
        if chart.get("error") or not isinstance(results, list) or len(results) != 1:
            return {"error": "invalid_source_shape"}
        result = results[0]
        stamps = result["timestamp"]
        indicators = result["indicators"]
        quotes, adjusted = indicators["quote"], indicators["adjclose"]
        if (not isinstance(stamps, list) or not 1 <= len(stamps) <= _MAX_SOURCE_ROWS
                or not isinstance(quotes, list) or len(quotes) != 1
                or not isinstance(adjusted, list) or len(adjusted) != 1):
            return {"error": "invalid_source_shape"}
        closes, adjusted_closes = quotes[0]["close"], adjusted[0]["adjclose"]
        if (not isinstance(closes, list) or not isinstance(adjusted_closes, list)
                or len(closes) != len(stamps) or len(adjusted_closes) != len(stamps)):
            return {"error": "incomplete_source_arrays"}
        meta = result.get("meta", {})
        return {"meta": {key: meta[key] for key in _META_FIELDS
                         if isinstance(meta.get(key), str) and len(meta[key]) <= 128},
                "timestamp": stamps.copy(), "close": closes.copy(), "adjclose": adjusted_closes.copy()}
    except (KeyError, IndexError, TypeError, AttributeError):
        return {"error": "invalid_source_shape"}


def technical_asset_input(
    raw: Any, *, symbol: str, source: str | None, feed: str | None,
    accepted_closes: dict[date, float], shared_dates: list[date], today: date | None = None,
) -> dict[str, Any]:
    """Select one asset's own original source dates inside the unchanged pair window.

    No resampling, raw-close substitution, partial adjusted window or new fetch.
    Missing equity sessions cannot be inferred without an audited calendar.
    Crypto source dates must be contiguous within the selected window.
    """
    start, end = (shared_dates[0], shared_dates[-1]) if shared_dates else (None, None)
    output = {"contract": CONTRACT, "symbol": symbol, "status": "unavailable", "reason": None,
              "source": source, "feed": feed, "price_basis": "yahoo_reported_adjclose",
              "sampling": "own_utc_dates_within_pair_window",
              "adjustment_verification": "not_independently_verified", "session_verification": "not_performed",
              "bar_completion": "not_verified", "pair_start_date": start, "pair_end_date": end}

    def unavailable(reason: str) -> dict[str, Any]:
        return {**output, "reason": reason}

    if start is None:
        return unavailable("pair_unavailable")
    if feed != "yahoo_chart":
        return unavailable("unsupported_or_unknown_feed")
    # The private sidecar is constructed before adapter normalization. Direct
    # Yahoo fallback charts are captured here through the same strict parser.
    if isinstance(raw, dict) and "_technical_input_chart" in raw:
        sidecar = raw["_technical_input_chart"]
        if not isinstance(sidecar, dict):
            return unavailable("invalid_source_shape")
        if isinstance(sidecar.get("error"), str) and sidecar["error"] in {"invalid_source_shape", "incomplete_source_arrays"}:
            return unavailable(sidecar["error"])
        # Revalidate even this internal copy; no provider-supplied sidecar may
        # bypass shape/length checks or publish an arbitrary error string.
        captured = capture_yahoo_technical_chart({"chart": {"result": [{
            "meta": sidecar.get("meta"), "timestamp": sidecar.get("timestamp"),
            "indicators": {"quote": [{"close": sidecar.get("close")}],
                           "adjclose": [{"adjclose": sidecar.get("adjclose")}]},
        }]}})
    else:
        captured = capture_yahoo_technical_chart(raw)
    if captured.get("error"):
        return unavailable(captured["error"])
    meta = captured["meta"]
    if meta.get("symbol", "").upper() != symbol:
        return unavailable("source_symbol_mismatch")
    if meta.get("dataGranularity") != "1d":
        return unavailable("daily_interval_unconfirmed")
    if meta.get("instrumentType") not in {"EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY"}:
        return unavailable("unsupported_instrument_type")
    unit, zone_name = meta.get("currency"), meta.get("exchangeTimezoneName")
    if not unit or not re.fullmatch(r"[A-Za-z0-9]{2,12}", unit):
        return unavailable("quote_unit_unavailable")
    try:
        zone = ZoneInfo(zone_name)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return unavailable("timezone_unavailable")
    output.update(source_symbol=meta["symbol"], instrument_type=meta["instrumentType"],
                  quote_unit=unit, exchange_timezone=zone_name)
    points: dict[date, dict[str, Any]] = {}
    shifted: set[date] = set()
    for stamp, close, adjusted in zip(captured["timestamp"], captured["close"], captured["adjclose"]):
        try:
            if not isinstance(stamp, int) or isinstance(stamp, bool):
                return unavailable("invalid_timestamp")
            moment = datetime.fromtimestamp(stamp, tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            return unavailable("invalid_timestamp")
        day = moment.date()
        if not start <= day <= end:
            continue
        if day in points:
            return unavailable("duplicate_utc_date")
        try:
            valid = all(not isinstance(value, bool) and isinstance(value, (int, float))
                        and math.isfinite(float(value)) and value > 0 for value in (close, adjusted))
        except OverflowError:
            valid = False
        if not valid:
            return unavailable("invalid_or_missing_close")
        if accepted_closes.get(day) != close:
            return unavailable("selected_rows_differ_from_source")
        points[day] = {"date": day.isoformat(), "provider_close": float(close), "adjusted_close": float(adjusted)}
        if moment.astimezone(zone).date() != day:
            shifted.add(day)
    selected_days = sorted(day for day in accepted_closes if start <= day <= end)
    if sorted(points) != selected_days or not selected_days:
        return unavailable("selected_rows_differ_from_source")
    if selected_days[0] != start or selected_days[-1] != end:
        return unavailable("incomplete_window")
    if meta["instrumentType"] == "CRYPTOCURRENCY" and len(points) != (end - start).days + 1:
        return unavailable("missing_crypto_dates")
    observed_today = today or datetime.now(timezone.utc).date()
    if end > observed_today:
        return unavailable("future_observation")
    ordered = [points[day] for day in selected_days]
    identity = {**output, "points": ordered}
    return {**output, "status": "available", "reason": None, "start_date": start, "end_date": end,
            "observations": len(ordered), "additional_dates_vs_pair": len(set(points) - set(shared_dates)),
            "shifted_local_dates": len(shifted),
            "freshness": "stale" if observed_today - end > timedelta(days=7) else "current",
            "input_id": "ti_" + hashlib.sha256(json.dumps(identity, sort_keys=True, default=str).encode()).hexdigest()[:24],
            "points": ordered}
