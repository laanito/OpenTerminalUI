"""Source defects must not disappear when adapters normalize technical inputs."""
from copy import deepcopy
from datetime import date, timedelta

import pytest

from backend.adapters.base import OHLCV
from backend.core.unified_fetcher import _chart_payload_from_rows
from backend.services.cross_market_context import daily_closes_with_conflicts
from backend.services.market_briefing_evidence import build_comparison_evidence
from backend.services.technical_inputs import TechnicalAssetInput, capture_yahoo_technical_chart, technical_asset_input
from backend.api.routes.market_context import MarketComparisonResponse
from backend.tests.test_market_context import _chart, _client


START = date(2026, 8, 24)
DAYS = [START + timedelta(days=i) for i in range(32)]


def chart(symbol="AAPL", *, crypto=False, days=None):
    raw = _chart({day: 100.0 + i for i, day in enumerate(days or DAYS)})
    result = raw["chart"]["result"][0]
    result["indicators"]["quote"][0] = {key: values.copy() for key, values in result["indicators"]["quote"][0].items()}
    result["meta"] = {"symbol": symbol, "currency": "USD", "dataGranularity": "1d",
                      "instrumentType": "CRYPTOCURRENCY" if crypto else "EQUITY", "exchangeTimezoneName": "UTC",
                      "provider_url": "https://example.com/private?key=never-copy"}
    result["indicators"]["adjclose"] = [{"adjclose": [90.0 + i for i in range(len(result["timestamp"]))]}]
    return raw


def inputs(raw, *, symbol="AAPL", accepted=None, shared=None, feed="yahoo_chart", **kwargs):
    accepted = daily_closes_with_conflicts(raw)[0] if accepted is None else accepted
    value = technical_asset_input(raw, symbol=symbol, source="yahoo", feed=feed,
                                 accepted_closes=accepted, shared_dates=shared or [DAYS[1], DAYS[-1]],
                                 today=date(2026, 9, 25), **kwargs)
    return TechnicalAssetInput.model_validate(value).model_dump(mode="json")


def normalized(raw, *, drop=()):
    result = raw["chart"]["result"][0]
    rows = [OHLCV(t=t, o=c, h=c, l=c, c=c, v=100)
            for i, (t, c) in enumerate(zip(result["timestamp"], result["indicators"]["quote"][0]["close"]))
            if i not in drop]
    return _chart_payload_from_rows(rows, provider_chart=raw)


def test_own_dates_keep_crypto_weekends_and_hash_identity_without_provider_metadata():
    raw = chart("BTC-USD", crypto=True)
    shared = [day for day in DAYS[1:] if day.weekday() < 5]
    out = inputs(raw, symbol="BTC-USD", shared=shared)
    assert out["status"] == "available" and out["observations"] == 31
    assert out["additional_dates_vs_pair"] == 8
    assert any(date.fromisoformat(p["date"]).weekday() >= 5 for p in out["points"])
    assert out["adjustment_verification"] == "not_independently_verified"
    assert out["session_verification"] == "not_performed" and out["bar_completion"] == "not_verified"
    assert out["freshness"] == "current" and "never-copy" not in str(out)
    assert out["input_id"] == inputs(deepcopy(raw), symbol="BTC-USD", shared=shared)["input_id"]
    raw["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"][-1] += 1
    assert out["input_id"] != inputs(raw, symbol="BTC-USD", shared=shared)["input_id"]


def test_adapter_sidecar_keeps_metadata_and_original_rows_without_altering_selected_closes():
    raw = chart()
    converted = normalized(raw)
    assert converted["chart"]["result"][0]["meta"] == {"currency": "USD"}
    assert inputs(converted) == inputs(raw)
    assert "provider_url" not in converted["_technical_input_chart"]["meta"]
    dropped = normalized(raw, drop=(10,))
    assert inputs(dropped)["reason"] == "selected_rows_differ_from_source"


@pytest.mark.parametrize("mutation,reason", [
    (lambda r: r["meta"].update(symbol="OTHER"), "source_symbol_mismatch"),
    (lambda r: r["meta"].update(dataGranularity="1h"), "daily_interval_unconfirmed"),
    (lambda r: r["meta"].update(instrumentType="FUTURE"), "unsupported_instrument_type"),
    (lambda r: r["meta"].pop("currency"), "quote_unit_unavailable"),
    (lambda r: r["meta"].update(exchangeTimezoneName="Bad/Zone"), "timezone_unavailable"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].pop(), "incomplete_source_arrays"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, None), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, float("nan")), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, True), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, 0), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, -1), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, float("inf")), "invalid_or_missing_close"),
    (lambda r: r["indicators"]["adjclose"][0]["adjclose"].__setitem__(5, 10 ** 400), "invalid_or_missing_close"),
    (lambda r: r["timestamp"].__setitem__(5, True), "invalid_timestamp"),
])
def test_invalid_inputs_are_withheld_without_partial_values(mutation, reason):
    raw = chart()
    accepted = daily_closes_with_conflicts(raw)[0]
    mutation(raw["chart"]["result"][0])
    out = inputs(raw, accepted=accepted)
    assert out["status"] == "unavailable" and out["reason"] == reason
    assert out["points"] == [] and out["input_id"] is None


@pytest.mark.parametrize("change", [False, True])
def test_duplicate_source_day_cannot_be_hidden_by_adjusted_last_value_wins(change):
    raw = chart()
    result = raw["chart"]["result"][0]
    result["timestamp"].append(result["timestamp"][5])
    for values in result["indicators"]["quote"][0].values():
        values.append(values[5])
    adjusted = result["indicators"]["adjclose"][0]["adjclose"]
    adjusted.append(adjusted[5] + int(change))
    out = inputs(normalized(raw))
    assert out["status"] == "unavailable" and out["reason"] == "duplicate_utc_date"


def test_partial_adjustment_and_split_do_not_fall_back_to_raw_prices():
    raw = chart()
    result = raw["chart"]["result"][0]
    closes = result["indicators"]["quote"][0]["close"]
    closes[:16] = [200.0] * 16
    closes[16:] = [100.0] * 16
    for key in ("open", "high", "low"):
        result["indicators"]["quote"][0][key] = closes.copy()
    result["events"] = {"splits": {str(result["timestamp"][16]): {"date": result["timestamp"][16]}}}
    result["indicators"]["adjclose"][0]["adjclose"] = [100.0] * 32
    out = inputs(normalized(raw))
    assert out["status"] == "available"
    assert {p["adjusted_close"] for p in out["points"]} == {100.0}
    assert {p["provider_close"] for p in out["points"]} == {100.0, 200.0}
    result["indicators"]["adjclose"][0]["adjclose"][5] = None
    assert inputs(normalized(raw))["reason"] == "invalid_or_missing_close"


def test_sampling_is_observed_utc_dates_not_an_inferred_exchange_calendar():
    raw = chart(days=[d for d in DAYS if d.weekday() < 5])
    raw["chart"]["result"][0]["meta"]["exchangeTimezoneName"] = "America/New_York"
    out = inputs(raw)
    assert out["status"] == "available" and out["shifted_local_dates"] == out["observations"]
    assert out["sampling"] == "own_utc_dates_within_pair_window"
    crypto = chart("BTC-USD", crypto=True, days=[d for d in DAYS if d.weekday() < 5])
    assert inputs(crypto, symbol="BTC-USD")["reason"] == "missing_crypto_dates"


def test_unconfirmed_feed_and_stale_source_are_explicit():
    assert inputs(chart(), feed=None)["reason"] == "unsupported_or_unknown_feed"
    assert inputs(chart(), feed="alpaca_stocks_bars:iex:raw")["reason"] == "unsupported_or_unknown_feed"
    dates = [d - timedelta(days=30) for d in DAYS]
    out = inputs(chart(days=dates), shared=[dates[1], dates[-1]])
    assert out["status"] == "available" and out["freshness"] == "stale"


def test_invalid_values_outside_pair_window_do_not_shorten_or_poison_selected_inputs():
    raw = chart()
    raw["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"][0] = None
    out = inputs(raw)
    assert out["status"] == "available" and out["observations"] == 31
    assert out["points"][0]["date"] == DAYS[1].isoformat()


def test_unavailable_sidecar_does_not_fall_back_to_normalized_chart():
    raw = chart()
    raw["_technical_input_chart"] = {"error": "incomplete_source_arrays"}
    assert inputs(raw)["reason"] == "incomplete_source_arrays"


def test_route_keeps_price_comparison_and_does_not_add_technical_inputs_to_briefing():
    client = _client({"AAPL": chart(), "SPY": chart("SPY")}, feeds={"AAPL": "yahoo_chart", "SPY": "yahoo_chart"})
    payload = client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["SPY"], "period": "1M"}).json()
    row = payload["comparisons"][0]
    assert row["status"] == "available" and row["technical_inputs"]["anchor"]["status"] == "available"
    assert row["technical_inputs"]["anchor"]["observations"] == 31
    before = build_comparison_evidence(MarketComparisonResponse.model_validate(payload))
    changed = deepcopy(payload)
    changed["comparisons"][0]["technical_inputs"] = None
    assert before == build_comparison_evidence(MarketComparisonResponse.model_validate(changed))
    assert "technical_measures" in before.not_included


def test_optional_source_defect_leaves_prices_available_and_unavailable_pair_has_no_inputs():
    good, partial = chart(), chart("SPY")
    partial["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"][5] = None
    client = _client({"AAPL": good, "SPY": partial, "BAD": RuntimeError("offline")},
                     feeds={"AAPL": "yahoo_chart", "SPY": "yahoo_chart"})
    payload = client.post("/api/market-context/compare", json={"anchor": "AAPL", "comparisons": ["SPY", "BAD"]}).json()
    available, unavailable = payload["comparisons"]
    assert available["status"] == "available" and available["technical_inputs"]["comparison"]["reason"] == "invalid_or_missing_close"
    assert unavailable["status"] == "unavailable"
    assert unavailable["technical_inputs"]["anchor"]["reason"] == "pair_unavailable"


def test_capture_is_bounded_and_malformed_private_sidecar_fails_closed():
    assert capture_yahoo_technical_chart({}) == {"error": "invalid_source_shape"}
    raw = chart()
    raw["chart"]["result"][0]["timestamp"] *= 100
    assert capture_yahoo_technical_chart(raw)["error"] == "invalid_source_shape"
    raw = chart()
    raw["_technical_input_chart"] = {"error": ["untrusted"], "meta": None}
    assert inputs(raw)["reason"] == "invalid_source_shape"
