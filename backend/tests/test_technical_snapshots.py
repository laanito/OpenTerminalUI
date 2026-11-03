"""Standalone evidence preserves source defects, own dates and bounded collection."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from backend.services.technical_inputs import TechnicalAssetInput, technical_asset_input
from backend.services.technical_indicators import calculate_technical_indicators, calculate_instrument_indicators
from backend.services.cross_market_context import daily_closes_with_conflicts
from backend.services.technical_snapshots import (
    TechnicalSnapshotRequest, build_technical_snapshot, collect_technical_snapshot,
)
from backend.tests.test_technical_inputs import DAYS, chart, normalized

NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)


def snapshot(raw=None, *, symbol="AAPL", feed="yahoo_chart", now=NOW, lookback=90):
    return build_technical_snapshot(
        TechnicalSnapshotRequest(symbol=symbol, lookback_calendar_days=lookback),
        chart(symbol) if raw is None else raw, source="yahoo", feed=feed, retrieved_at=now,
    )


def test_standalone_observations_need_no_pair_and_match_existing_formulas():
    raw = chart()
    result = snapshot(raw)
    pair_input = technical_asset_input(
        raw, symbol="AAPL", source="yahoo", feed="yahoo_chart",
        accepted_closes=daily_closes_with_conflicts(raw)[0], shared_dates=[DAYS[0], DAYS[-1]], today=NOW.date(),
    )
    pair_metrics = calculate_technical_indicators(TechnicalAssetInput.model_validate(pair_input))
    assert result.status == "available"
    assert [m.value for m in result.indicators.metrics] == [m.value for m in pair_metrics.metrics]
    assert result.inputs.window_start_date == DAYS[0] and result.inputs.window_end_date == DAYS[-1]
    assert result.inputs.requested_end_date == NOW.date()
    assert result.inputs.requested_start_date == NOW.date() - timedelta(days=89)
    assert result.indicators.sampling == "own_utc_dates_within_instrument_window"
    assert result.history_semantics == "current_source_history_not_point_in_time"
    assert "pair_start_date" not in result.model_dump_json()
    assert "additional_dates_vs_pair" not in result.model_dump_json()
    assert "never-copy" not in result.model_dump_json()
    assert result.inputs.input_id != pair_metrics.input_id
    assert pair_metrics.input_id == "ti_4b4ea99b59036d69da719324"  # Published v2.5 contract.
    assert all(m.observation_id.startswith("to_") for m in result.indicators.metrics)
    assert result.snapshot_id.startswith("ts_")


def test_identity_binds_source_request_and_values_but_not_retrieval_clock():
    raw = chart()
    original = snapshot(raw)
    assert original.snapshot_id == snapshot(deepcopy(raw), now=NOW + timedelta(minutes=1)).snapshot_id
    assert original.snapshot_id != snapshot(raw, lookback=60).snapshot_id
    raw["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"][-1] += 1
    changed = snapshot(raw)
    assert changed.snapshot_id != original.snapshot_id
    assert changed.inputs.input_id != original.inputs.input_id
    assert changed.indicators.metrics[-1].observation_id != original.indicators.metrics[-1].observation_id


@pytest.mark.parametrize("count,status,usable", [(1, "unavailable", 0), (19, "unavailable", 0), (20, "partial", 1), (21, "available", 3)])
def test_no_shortened_lookback_and_exact_warmup(count, status, usable):
    raw = chart(days=DAYS[-count:])
    result = snapshot(raw)
    assert result.status == status
    assert sum(m.status == "available" for m in result.indicators.metrics) == usable
    assert all(m.value is None and m.observation_id is None for m in result.indicators.metrics if m.status == "unavailable")


def test_crypto_keeps_weekends_and_equity_uses_its_own_observed_dates():
    crypto = snapshot(chart("BTC-USD", crypto=True), symbol="BTC-USD")
    equity = snapshot(chart(days=[day for day in DAYS if day.weekday() < 5]))
    assert crypto.status == equity.status == "available"
    assert any(d.weekday() >= 5 for d in crypto.indicators.metrics[1].observation_dates)
    assert all(d.weekday() < 5 for d in equity.indicators.metrics[1].observation_dates)
    assert crypto.indicators.metrics[1].start_date != equity.indicators.metrics[1].start_date
    assert equity.inputs.session_verification == "not_performed"


def test_missing_crypto_date_is_not_repaired_by_selecting_a_shorter_window():
    raw = chart("BTC-USD", crypto=True, days=[d for d in DAYS if d != DAYS[10]])
    result = snapshot(raw, symbol="BTC-USD")
    assert result.inputs.reason == "missing_crypto_dates"
    assert result.inputs.points == [] and result.status == "unavailable"


@pytest.mark.parametrize("edge", [0, -1])
@pytest.mark.parametrize("field", ["close", "adjclose"])
def test_invalid_edge_rows_cannot_silently_shorten_window(edge, field):
    raw = chart()
    source = raw["chart"]["result"][0]
    source["indicators"]["quote" if field == "close" else "adjclose"][0][field][edge] = None
    result = snapshot(raw)
    assert result.status == "unavailable"
    assert result.inputs.reason == "invalid_or_missing_close"
    assert result.inputs.points == []


def test_adapter_dropped_edge_and_duplicate_original_source_are_withheld():
    raw = chart()
    result = snapshot(normalized(raw, drop=(0,)))
    assert result.inputs.reason == "selected_rows_differ_from_source"
    duplicate = deepcopy(raw)
    source = duplicate["chart"]["result"][0]
    source["timestamp"][1] = source["timestamp"][0]
    source["indicators"]["quote"][0]["close"][1] = source["indicators"]["quote"][0]["close"][0]
    assert snapshot(normalized(duplicate)).inputs.reason == "duplicate_utc_date"


@pytest.mark.parametrize("mutation,reason", [
    (lambda r: r["chart"]["result"][0]["meta"].update(symbol="SPY"), "source_symbol_mismatch"),
    (lambda r: r["chart"]["result"][0]["meta"].update(dataGranularity="1h"), "daily_interval_unconfirmed"),
    (lambda r: r["chart"]["result"][0]["meta"].update(currency=None), "quote_unit_unavailable"),
    (lambda r: r["chart"]["result"][0]["meta"].update(exchangeTimezoneName="bad-zone"), "timezone_unavailable"),
    (lambda r: r["chart"]["result"][0]["timestamp"].__setitem__(-1, int((NOW + timedelta(days=1)).timestamp())), "future_observation"),
])
def test_source_contract_is_shared_and_never_guessed(mutation, reason):
    raw = chart()
    mutation(raw)
    result = snapshot(raw)
    assert result.inputs.reason == reason and result.status == "unavailable"
    assert result.inputs.input_id is None and result.inputs.points == []


def test_window_cutoff_is_explicit_and_stale_history_remains_labelled():
    current = snapshot(lookback=21)
    assert current.inputs.window_start_date == NOW.date() - timedelta(days=20)
    assert current.inputs.observations == 20  # Today has no source close; no padding.
    assert current.status == "partial"
    stale = snapshot(now=NOW + timedelta(days=20))
    assert stale.status == "available" and stale.inputs.freshness == "stale"
    assert stale.indicators.freshness == "stale"
    assert stale.inputs.bar_completion == "not_verified"
    empty = snapshot(now=NOW + timedelta(days=120))
    assert empty.inputs.reason == "no_observations_in_window"


@pytest.mark.parametrize("raw", [{}, [], {"chart": None}, {"chart": {"result": []}}])
def test_malformed_payloads_produce_typed_unavailable_snapshot(raw):
    result = snapshot(raw)
    assert result.status == "unavailable" and result.inputs.points == []
    assert result.inputs.reason == "invalid_source_shape"


@pytest.mark.parametrize("changes", [{"symbol": "../secret"}, {"symbol": 123}, {"lookback_calendar_days": 182},
                                      {"lookback_calendar_days": True}, {"lookback_calendar_days": 0}, {"interval": "1h"}, {"extra": 1}])
def test_requests_are_bounded(changes):
    with pytest.raises(ValidationError):
        TechnicalSnapshotRequest(**{"symbol": "AAPL", **changes})


def test_request_normalisation_and_retrieval_timezone_are_explicit():
    request = TechnicalSnapshotRequest(symbol=" btc-usd ")
    assert request.symbol == "BTC-USD"
    with pytest.raises(ValueError, match="timezone-aware"):
        snapshot(now=NOW.replace(tzinfo=None))


@pytest.mark.asyncio
async def test_collector_fetches_once_with_provenance_and_no_pair_or_model():
    class Fetcher:
        calls = []

        async def fetch_history_with_provenance(self, symbol, **kwargs):
            self.calls.append((symbol, kwargs))
            return chart(symbol), "yahoo", "yahoo_chart"

    fetcher = Fetcher()
    result = await collect_technical_snapshot(TechnicalSnapshotRequest(symbol=" aapl "), fetcher, retrieved_at=NOW)
    assert result.status == "available"
    assert fetcher.calls == [("AAPL", {"range_str": "3mo", "interval": "1d"})]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["error", "timeout", "unsupported_feed"])
async def test_collection_failure_never_tries_another_feed_or_leaks_error(failure):
    class Fetcher:
        calls = 0
        closed = False

        async def fetch_history_with_provenance(self, symbol, **kwargs):
            self.calls += 1
            try:
                if failure == "error":
                    raise RuntimeError("private?api_key=never-copy")
                if failure == "timeout":
                    await asyncio.sleep(60)
                return chart(), "alpaca", "alpaca_iex_raw"
            finally:
                self.closed = True

    fetcher = Fetcher()
    result = await collect_technical_snapshot(TechnicalSnapshotRequest(symbol="AAPL"), fetcher,
                                              timeout_seconds=0.01, retrieved_at=NOW)
    assert result.inputs.reason == {"error": "provider_error", "timeout": "provider_timeout",
                                    "unsupported_feed": "unsupported_or_unknown_feed"}[failure]
    assert result.status == "unavailable" and result.inputs.points == []
    assert fetcher.calls == 1 and fetcher.closed and "never-copy" not in result.model_dump_json()


@pytest.mark.asyncio
async def test_cancellation_propagates_and_closes_fetch_without_returning_an_old_snapshot():
    entered, closed = asyncio.Event(), asyncio.Event()

    class Fetcher:
        async def fetch_history_with_provenance(self, symbol, **kwargs):
            try:
                entered.set()
                await asyncio.sleep(60)
            finally:
                closed.set()

    task = asyncio.create_task(collect_technical_snapshot(TechnicalSnapshotRequest(symbol="AAPL"), Fetcher(), retrieved_at=NOW))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


def test_flat_adjusted_series_does_not_turn_raw_split_into_a_signal():
    raw = chart()
    source = raw["chart"]["result"][0]
    source["indicators"]["adjclose"][0]["adjclose"] = [100.0] * 32
    for key in ("open", "high", "low", "close"):
        source["indicators"]["quote"][0][key] = [200.0] * 16 + [100.0] * 16
    result = snapshot(raw)
    assert result.status == "available"
    assert all(m.value == 0 for m in result.indicators.metrics)
    assert result.indicators.annualized is False
    assert result.indicators.adjustment_verification == "not_independently_verified"


def test_source_unit_and_reported_type_are_not_inferred_or_fx_converted():
    raw = chart()
    raw["chart"]["result"][0]["meta"].update(currency="GBp", instrumentType="ETF")
    result = snapshot(raw)
    assert result.inputs.quote_unit == result.indicators.quote_unit == "GBp"
    assert result.inputs.instrument_type == "ETF"
    assert result.inputs.points[-1].adjusted_close == 121.0


def test_oversized_selected_chart_is_rejected_before_normalization(monkeypatch):
    raw = chart()
    raw["chart"]["result"][0]["timestamp"] *= 100

    def must_not_parse(_):
        raise AssertionError("oversized source must be bounded before dataframe parsing")

    monkeypatch.setattr("backend.services.technical_snapshots.daily_closes_with_conflicts", must_not_parse)
    assert snapshot(raw).inputs.reason == "invalid_source_shape"


@pytest.mark.asyncio
async def test_legacy_fetcher_does_not_trigger_an_unproven_source_query():
    class Fetcher:
        async def fetch_history(self, *args, **kwargs):
            raise AssertionError("must not make a provenance-free fallback query")

    result = await collect_technical_snapshot(TechnicalSnapshotRequest(symbol="AAPL"), Fetcher(), retrieved_at=NOW)
    assert result.inputs.reason == "unsupported_or_unknown_feed"


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout", [0, -1, float("inf"), float("nan"), True, 46, "15"])
async def test_invalid_deadlines_fail_before_fetch(timeout):
    with pytest.raises(ValueError, match="finite and positive"):
        await collect_technical_snapshot(TechnicalSnapshotRequest(symbol="AAPL"), object(), timeout_seconds=timeout)


@pytest.mark.asyncio
async def test_longer_bounded_window_fetches_once_and_caps_returned_points():
    days = [NOW.date() - timedelta(days=i) for i in range(182, -1, -1)]

    class Fetcher:
        calls = 0

        async def fetch_history_with_provenance(self, symbol, **kwargs):
            self.calls += 1
            assert kwargs == {"range_str": "6mo", "interval": "1d"}
            return chart(symbol, crypto=True, days=days), "crypto", "yahoo_chart"

    fetcher = Fetcher()
    result = await collect_technical_snapshot(TechnicalSnapshotRequest(symbol="BTC-USD", lookback_calendar_days=181),
                                              fetcher, retrieved_at=NOW)
    assert fetcher.calls == 1 and result.status == "available"
    assert result.inputs.observations == 181


def test_inconsistent_standalone_window_never_produces_available_metrics():
    inputs = snapshot().inputs
    for changes in ({"observations": 1}, {"window_start_date": DAYS[1]}, {"input_id": None}):
        result = calculate_instrument_indicators(inputs.model_copy(update=changes))
        assert result.status == "unavailable"
        assert all(m.reason == "inconsistent_input" and m.value is None for m in result.metrics)
