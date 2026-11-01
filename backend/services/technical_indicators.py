"""Deterministic observations from the versioned technical-input contract only."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date
from statistics import stdev
from typing import Literal

from pydantic import BaseModel, Field

from backend.services.technical_inputs import TechnicalAssetInput

VERSION = "technical-indicators-v1"
MetricName = Literal["sma20_gap_pct", "return20_pct", "volatility20_pp"]
_DEFINITIONS = (
    ("sma20_gap_pct", 20, "percent", "100 * (last_adjusted_close / mean(last_20_adjusted_closes) - 1)"),
    ("return20_pct", 21, "percent", "100 * (last_adjusted_close / adjusted_close_20_observations_earlier - 1)"),
    ("volatility20_pp", 21, "percentage_points", "100 * sample_stddev(last_20_simple_close_to_close_returns, ddof=1)"),
)


class TechnicalMetric(BaseModel):
    name: MetricName
    status: Literal["available", "unavailable"]
    reason: Literal["input_unavailable", "inconsistent_input", "insufficient_history", "non_finite_calculation"] | None
    value: float | None = Field(default=None, allow_inf_nan=False)
    unit: Literal["percent", "percentage_points"]
    formula: str
    lookback: Literal[20] = 20
    required_closes: Literal[20, 21]
    used_closes: int = 0
    observation_dates: list[date] = Field(default_factory=list, max_length=21)
    start_date: date | None = None
    end_date: date | None = None
    observation_id: str | None = None


class TechnicalAssetIndicators(BaseModel):
    calculation_version: Literal["technical-indicators-v1"] = VERSION
    symbol: str
    status: Literal["available", "partial", "unavailable"]
    input_status: Literal["available", "unavailable"]
    input_reason: str | None
    input_id: str | None
    source: str | None
    feed: str | None
    quote_unit: str | None
    price_basis: Literal["yahoo_reported_adjclose"] = "yahoo_reported_adjclose"
    sampling: Literal["own_utc_dates_within_pair_window"] = "own_utc_dates_within_pair_window"
    adjustment_verification: Literal["not_independently_verified"] = "not_independently_verified"
    session_verification: Literal["not_performed"] = "not_performed"
    bar_completion: Literal["not_verified"] = "not_verified"
    annualized: Literal[False] = False
    value_decimal_places: Literal[8] = 8
    available_closes: int
    as_of_date: date | None
    freshness: Literal["current", "stale"] | None
    metrics: list[TechnicalMetric] = Field(min_length=3, max_length=3)


class TechnicalPairIndicators(BaseModel):
    anchor: TechnicalAssetIndicators
    comparison: TechnicalAssetIndicators


def calculate_technical_indicators(inputs: TechnicalAssetInput) -> TechnicalAssetIndicators:
    """No new history, shortening, resampling, raw-price fallback or model call.

    These are observed-close calculations, not certified sessions or signals.
    Data quality/freshness limitations follow the source even when values exist.
    """
    points = inputs.points
    dates = [point.date for point in points]
    consistent = (
        bool(points) and bool(inputs.input_id) and inputs.reason is None
        and len(points) == inputs.observations and dates == sorted(set(dates))
        and dates[0] == inputs.start_date == inputs.pair_start_date
        and dates[-1] == inputs.end_date == inputs.pair_end_date
    )
    metrics = []
    for name, required, unit, formula in _DEFINITIONS:
        base = {"name": name, "unit": unit, "formula": formula, "required_closes": required}
        if inputs.status != "available":
            metrics.append(TechnicalMetric(**base, status="unavailable", reason="input_unavailable"))
            continue
        if not consistent:
            metrics.append(TechnicalMetric(**base, status="unavailable", reason="inconsistent_input"))
            continue
        if len(points) < required:
            metrics.append(TechnicalMetric(**base, status="unavailable", reason="insufficient_history"))
            continue
        window = points[-required:]
        values = [point.adjusted_close for point in window]
        try:
            if name == "sma20_gap_pct":
                # Dividing first avoids overflowing an otherwise finite mean.
                mean = math.fsum(value / 20 for value in values)
                value = 100 * (values[-1] / mean - 1)
            elif name == "return20_pct":
                value = 100 * (values[-1] / values[0] - 1)
            else:
                returns = [current / previous - 1 for previous, current in zip(values, values[1:])]
                if not all(math.isfinite(item) for item in returns):
                    raise ValueError("Non-finite return")
                value = 100 * stdev(returns)
            if not math.isfinite(value):
                raise ValueError("Non-finite indicator")
        except (ArithmeticError, ValueError):
            metrics.append(TechnicalMetric(**base, status="unavailable", reason="non_finite_calculation"))
            continue
        result = TechnicalMetric(**base, status="available", reason=None, value=round(value, 8),
                                 used_closes=required, observation_dates=[point.date for point in window],
                                 start_date=window[0].date, end_date=window[-1].date)
        identity = {"version": VERSION, "input_id": inputs.input_id,
                    "metric": result.model_dump(mode="json", exclude={"observation_id"})}
        result.observation_id = "to_" + hashlib.sha256(
            json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()[:24]
        metrics.append(result)
    available = sum(metric.status == "available" for metric in metrics)
    return TechnicalAssetIndicators(
        symbol=inputs.symbol, status="available" if available == 3 else "partial" if available else "unavailable",
        input_status=inputs.status, input_reason=inputs.reason, input_id=inputs.input_id,
        source=inputs.source, feed=inputs.feed, quote_unit=inputs.quote_unit,
        available_closes=len(points) if inputs.status == "available" and consistent else 0,
        as_of_date=inputs.end_date if inputs.status == "available" and consistent else None,
        freshness=inputs.freshness, metrics=metrics,
    )
