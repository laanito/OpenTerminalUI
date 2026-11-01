"""Known financial series and source failures exercise observed-close arithmetic."""
from copy import deepcopy
from datetime import date, timedelta
import math

import pytest

from backend.api.routes.market_context import MarketComparisonResponse
from backend.services.cross_market_context import daily_closes_with_conflicts
from backend.services.market_briefing_evidence import build_comparison_evidence
from backend.services.technical_inputs import TechnicalAssetInput, technical_asset_input
from backend.services.technical_indicators import calculate_technical_indicators
from backend.tests.test_market_context import _client
from backend.tests.test_technical_inputs import chart


START = date(2026, 8, 24)


def source(values, *, days=None, crypto=True, raw_values=None, symbol="AAPL"):
    days = days or [START + timedelta(days=i) for i in range(len(values))]
    raw = chart(symbol, crypto=crypto, days=days)
    result = raw["chart"]["result"][0]
    result["indicators"]["adjclose"][0]["adjclose"] = list(values)
    for key in ("open", "high", "low", "close"):
        result["indicators"]["quote"][0][key] = list(raw_values or values)
    return raw, days


def calculate(values, *, days=None, crypto=True, raw_values=None, age=0):
    raw, days = source(values, days=days, crypto=crypto, raw_values=raw_values)
    inputs = technical_asset_input(raw, symbol="AAPL", source="yahoo", feed="yahoo_chart",
                                   accepted_closes=daily_closes_with_conflicts(raw)[0], shared_dates=[days[0], days[-1]],
                                   today=days[-1] + timedelta(days=age))
    return calculate_technical_indicators(TechnicalAssetInput.model_validate(inputs))


def metrics(result):
    return {metric.name: metric for metric in result.metrics}


def test_known_rising_series_uses_twenty_closes_for_trend_and_twenty_steps_for_momentum():
    result = calculate(list(range(100, 121)))
    trend, momentum, volatility = result.metrics
    assert result.status == "available" and result.available_closes == 21
    assert trend.value == pytest.approx(8.59728507)  # last 20 mean = 110.5
    assert momentum.value == 20
    assert trend.start_date == START + timedelta(days=1)
    assert momentum.start_date == START and volatility.start_date == START
    assert trend.used_closes == 20 and momentum.used_closes == volatility.used_closes == 21
    assert all(metric.end_date == START + timedelta(days=20) for metric in result.metrics)
    assert len(trend.observation_dates) == 20 and len(volatility.observation_dates) == 21


def test_alternating_series_volatility_is_sample_dispersion_and_not_annualized():
    result = calculate([100, 200] * 10 + [100])
    found = metrics(result)
    # Ten +100% and ten -50% returns, mean 25%, squared-deviation sum 11.25.
    expected = math.sqrt(11.25 / 19) * 100
    assert found["volatility20_pp"].value == pytest.approx(expected)
    assert found["volatility20_pp"].unit == "percentage_points"
    assert found["return20_pct"].value == 0
    assert found["sma20_gap_pct"].value == pytest.approx(-33.33333333)
    assert result.annualized is False and "ddof=1" in found["volatility20_pp"].formula


def test_flat_series_has_real_zero_values_and_keeps_quality_and_freshness_caveats():
    result = calculate([100] * 25, age=20)
    assert result.status == "available" and all(metric.value == 0 for metric in result.metrics)
    assert result.adjustment_verification == "not_independently_verified"
    assert result.session_verification == "not_performed" and result.bar_completion == "not_verified"
    assert result.freshness == "stale"


@pytest.mark.parametrize("count,status,available", [(2, "unavailable", 0), (19, "unavailable", 0), (20, "partial", 1), (21, "available", 3)])
def test_exact_history_thresholds_never_shorten_or_pad_periods(count, status, available):
    result = calculate([100] * count)
    assert result.status == status
    assert sum(metric.status == "available" for metric in result.metrics) == available
    for metric in result.metrics:
        if metric.status == "unavailable":
            assert metric.reason == "insufficient_history" and metric.value is None
            assert metric.observation_dates == [] and metric.observation_id is None and metric.used_closes == 0


def test_uses_only_latest_required_closes_and_source_bound_id_changes_with_input():
    first = calculate([100] * 10 + list(range(100, 121)))
    second = calculate([900] * 10 + list(range(100, 121)))
    scaled = calculate([1000] * 10 + [10 * x for x in range(100, 121)])
    assert [metric.value for metric in first.metrics] == [metric.value for metric in second.metrics]
    assert [metric.value for metric in first.metrics] == [metric.value for metric in scaled.metrics]
    assert first.input_id != second.input_id
    assert [metric.observation_id for metric in first.metrics] != [metric.observation_id for metric in second.metrics]
    assert first == calculate([100] * 10 + list(range(100, 121)))


def test_split_and_dividend_like_raw_gaps_cannot_replace_adjusted_input():
    split = calculate([100] * 32, raw_values=[200] * 16 + [100] * 16)
    dividend = calculate([100] * 32, raw_values=[105] * 16 + [100] * 16)
    assert all(metric.value == 0 for metric in split.metrics + dividend.metrics)
    assert split.input_id != dividend.input_id
    bad, days = source([100] * 32)
    bad["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"][12] = None
    inputs = technical_asset_input(bad, symbol="AAPL", source="yahoo", feed="yahoo_chart",
                                   accepted_closes=daily_closes_with_conflicts(bad)[0], shared_dates=[days[0], days[-1]])
    result = calculate_technical_indicators(TechnicalAssetInput.model_validate(inputs))
    assert result.status == "unavailable" and result.input_reason == "invalid_or_missing_close"
    assert all(metric.value is None and metric.reason == "input_unavailable" for metric in result.metrics)


def test_equity_and_crypto_lookbacks_use_own_dates_not_a_shared_sample_or_fixed_calendar_span():
    crypto_days = [START + timedelta(days=i) for i in range(32)]
    equity_days = [day for day in crypto_days if day.weekday() < 5]
    crypto = calculate(list(range(100, 132)), days=crypto_days)
    equity = calculate(list(range(100, 100 + len(equity_days))), days=equity_days, crypto=False)
    assert crypto.metrics[1].end_date == equity.metrics[1].end_date
    assert crypto.metrics[1].start_date != equity.metrics[1].start_date
    assert all(day.weekday() < 5 for day in equity.metrics[1].observation_dates)
    assert any(day.weekday() >= 5 for day in crypto.metrics[1].observation_dates)
    assert equity.sampling == crypto.sampling == "own_utc_dates_within_pair_window"


def test_numerical_extremes_never_publish_nan_or_infinity_or_break_other_metrics():
    result = calculate([1e-300] + [1e300] * 20)
    assert result.status == "partial" and result.metrics[0].value == 0
    assert all(metric.reason == "non_finite_calculation" and metric.value is None for metric in result.metrics[1:])
    result.model_dump_json()  # no NaN/Infinity allowed in public results
    large_flat = calculate([1e308] * 21)
    assert all(metric.value == 0 for metric in large_flat.metrics)


def test_inconsistent_internal_source_metadata_cannot_publish_identified_metrics():
    raw, days = source([100] * 21)
    inputs = technical_asset_input(raw, symbol="AAPL", source="yahoo", feed="yahoo_chart",
                                   accepted_closes=daily_closes_with_conflicts(raw)[0], shared_dates=[days[0], days[-1]])
    parsed = TechnicalAssetInput.model_validate(inputs)
    for changes in ({"observations": 20}, {"input_id": None}, {"points": list(reversed(parsed.points))}):
        result = calculate_technical_indicators(parsed.model_copy(update=changes))
        assert result.status == "unavailable"
        assert all(metric.reason == "inconsistent_input" and metric.observation_id is None for metric in result.metrics)


def test_api_adds_metrics_without_changing_prices_or_silently_including_them_in_briefings():
    a, _ = source([100] * 32)
    b, _ = source(list(range(100, 132)), symbol="SPY")
    client = _client({"AAPL": a, "SPY": b}, feeds={"AAPL": "yahoo_chart", "SPY": "yahoo_chart"})
    response = client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["SPY"]})
    assert response.status_code == 200
    payload = response.json()
    row = payload["comparisons"][0]
    assert row["technical_indicators"]["anchor"]["status"] == "available" and row["status"] == "available"
    evidence = build_comparison_evidence(MarketComparisonResponse.model_validate(payload))
    changed = deepcopy(payload)
    changed["comparisons"][0]["technical_indicators"] = None
    assert evidence == build_comparison_evidence(MarketComparisonResponse.model_validate(changed))
    assert "technical_measures" in evidence.not_included
