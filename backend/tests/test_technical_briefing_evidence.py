"""Opt-in technical facts stay bound to the fresh price snapshot and exact refs."""
import asyncio
from datetime import date, datetime, timedelta, timezone
import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend.api.deps import get_unified_fetcher
from backend.api.routes import market_briefing as routes
from backend.api.routes.market_context import MarketComparisonResponse
from backend.auth.deps import get_current_user
from backend.services import comparison_context_briefing as synthesis
from backend.services import market_briefing_context_collection as collection
from backend.services.comparison_briefing import InvalidComparisonBriefing
from backend.services.market_briefing_context_evidence import BriefingContextOptions, build_context_evidence
from backend.services.market_briefing_evidence import build_comparison_evidence
from backend.services.economic_data import get_economic_data_service
from backend.tests.test_comparison_briefing import _Client
from backend.tests.test_comparison_context_briefing import configure, valid, providers
from backend.tests.test_market_context import _client
from backend.tests.test_technical_inputs import chart

NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
SELECTION = {"anchor": "AAPL", "comparisons": ["BTC-USD"], "period": "1M"}


def histories(*, partial=False):
    days = [date(2026, 8, 24) + timedelta(days=i) for i in range(32)]
    weekdays = [day for day in days if day.weekday() < 5]
    if partial:
        within = [day for day in weekdays if day >= date(2026, 8, 25)]
        weekdays = [within[0], *within[1:19], within[-1]]
    return {"AAPL": chart("AAPL", days=weekdays), "BTC-USD": chart("BTC-USD", crypto=True, days=days),
            "SPY": chart("SPY", days=weekdays), "BAD": RuntimeError("provider failed")}


def snapshot(*, partial=False, comparisons=None):
    data = histories(partial=partial)
    client = _client(data, sources={symbol: "yahoo" for symbol in data}, feeds={symbol: "yahoo_chart" for symbol in data})
    raw = client.post("/api/market-context/compare", json={**SELECTION, "comparisons": comparisons or ["BTC-USD"]}).json()
    result = MarketComparisonResponse.model_validate(raw)
    result.retrieved_at = NOW
    return result


def packet(snap=None, **options):
    snap = snap or snapshot()
    return build_context_evidence(build_comparison_evidence(snap), BriefingContextOptions(technical=True, **options),
                                  prepared_at=NOW, technical_snapshot=snap)


def answer(evidence):
    result = valid(evidence)
    by_pair = {}
    for group in synthesis.context_reference_requirements(evidence)["technical_required_source_groups"]:
        by_pair.setdefault(group["pair"], [group["pair"]]).append(group["at_least_one_of"][0])
    for refs in by_pair.values():
        result["possible_context"].append({"text": "The supplied own-date technical observations may inform a conditional interpretation.",
                                           "citation_ids": refs})
    return result


def test_explicit_selection_is_required_and_technical_only_requests_are_valid():
    snap = snapshot()
    price = build_comparison_evidence(snap)
    ordinary = build_context_evidence(price, BriefingContextOptions(), prepared_at=NOW)
    assert ordinary.sections == [] and "technical_measures" in ordinary.always_excluded
    assert "technical_measures" in ordinary.price.not_included
    with pytest.raises(ValueError, match="Unrequested technical"):
        build_context_evidence(price, BriefingContextOptions(), prepared_at=NOW, technical_snapshot=snap)
    assert routes.ComparisonContextBriefingRequest(**SELECTION, context={"technical": True}).context.technical
    with pytest.raises(ValidationError):
        routes.ComparisonContextBriefingRequest(**SELECTION, context={})
    with pytest.raises(ValidationError):
        BriefingContextOptions(technical="yes")


def test_projection_preserves_exact_values_dates_quality_and_inspectable_inputs():
    snap = snapshot()
    result = packet(snap)
    section = result.sections[0]
    assert section.kind == "technical" and section.status == "available"
    assert section.citation_id == "C1" and section.pair_citation_id == "P1"
    assert section.retrieved_at == snap.retrieved_at
    assert "technical_measures" not in result.always_excluded and "technical_measures" in result.price.not_included
    for index, asset in enumerate(section.assets, 1):
        original = getattr(snap.comparisons[0].technical_indicators, "anchor" if index == 1 else "comparison")
        source = getattr(snap.comparisons[0].technical_inputs, "anchor" if index == 1 else "comparison")
        assert asset.input_id == original.input_id and asset.freshness == original.freshness
        assert asset.exchange_timezone == source.exchange_timezone and asset.instrument_type == source.instrument_type
        assert asset.shifted_local_dates == source.shifted_local_dates
        assert asset.adjustment_verification == "not_independently_verified" and asset.annualized is False
        for number, metric in enumerate(asset.metrics, 1):
            assert metric.citation_id == f"C1A{index}T{number}"
            assert metric.model_dump(exclude={"citation_id"}) == original.metrics[number - 1].model_dump()
            assert set(metric.observation_dates) <= {point.date for point in asset.supporting_points}
        assert len(asset.supporting_points) == 21
    assert section.assets[0].metrics[1].start_date != section.assets[1].metrics[1].start_date
    before = result.model_dump_json()
    snap.comparisons[0].technical_indicators.anchor.metrics[0].value += 1
    assert result.model_dump_json() == before  # No mutable live-source alias.
    assert packet(snap).sections[0].reason == "invalid_response"


def test_fingerprint_covers_selection_and_observations_and_mismatches_are_isolated():
    snap = snapshot()
    first = packet(snap)
    assert first.packet_id == packet(snap.model_copy(deep=True)).packet_id
    wrong = snap.model_copy(deep=True)
    wrong.comparisons[0].anchor_return_pct += 1
    result = build_context_evidence(first.price, BriefingContextOptions(technical=True), prepared_at=NOW, technical_snapshot=wrong)
    assert result.sections[0].reason == "invalid_response" and result.sections[0].assets == []
    assert result.price == first.price and result.packet_id != first.packet_id
    missing = build_context_evidence(first.price, BriefingContextOptions(technical=True), prepared_at=NOW)
    assert missing.sections[0].reason == "not_prepared"


def test_partial_and_unavailable_metrics_are_known_but_never_usable_as_context():
    result = packet(snapshot(partial=True, comparisons=["BTC-USD", "BAD"]))
    section, missing_pair = result.sections
    assert section.status == "partial" and section.assets[0].status == "partial"
    assert section.assets[0].metrics[0].status == "available"
    assert section.assets[0].metrics[1].reason == "insufficient_history"
    assert len(section.assets[0].supporting_points) == 20
    assert missing_pair.status == "no_price_window" and missing_pair.assets == []
    known, usable, missing, material = synthesis._reference_rules(result)
    assert "C1A1T2" in known & missing and "C1A1T2" not in usable
    assert {"C1", "C1A1", "C1A2"} <= material
    generated = answer(result)
    synthesis.validate_context_briefing(json.dumps(generated), result)
    generated["possible_context"].append({"text": "This unavailable indicator is not a usable numerical observation.", "citation_ids": ["P1", "C1A1T2"]})
    with pytest.raises(InvalidComparisonBriefing) as error:
        synthesis.validate_context_briefing(json.dumps(generated), result)
    assert error.value.code == "context_source_pair"


@pytest.mark.parametrize("refs", [["C1A1T1"], ["P1", "C1A1"], ["P1", "C2A1T1"], ["P1", "C99A1T1"]])
def test_wrong_pair_group_or_unknown_reference_is_rejected(refs):
    evidence = packet(snapshot(comparisons=["BTC-USD", "SPY"]))
    generated = answer(evidence)
    generated["possible_context"].append({"text": "A technical interpretation must cite its exact available metric and pair.", "citation_ids": refs})
    with pytest.raises(InvalidComparisonBriefing):
        synthesis.validate_context_briefing(json.dumps(generated), evidence)


def test_coverage_requires_a_metric_for_each_usable_asset_and_quality_limitations():
    evidence = packet()
    generated = answer(evidence)
    generated["possible_context"] = []
    with pytest.raises(InvalidComparisonBriefing) as error:
        synthesis.validate_context_briefing(json.dumps(generated), evidence)
    assert error.value.code == "technical_coverage"
    assert error.value.feedback()["required_references"] == ["C1A1T1", "C1A1T2", "C1A1T3"]
    generated = answer(evidence)
    for statement in generated["limitations"]:
        statement["citation_ids"] = [ref for ref in statement["citation_ids"] if ref != "C1A1"]
    with pytest.raises(InvalidComparisonBriefing) as error:
        synthesis.validate_context_briefing(json.dumps(generated), evidence)
    assert error.value.code == "context_limitations"


@pytest.mark.asyncio
async def test_technical_collection_needs_no_provider_job_and_news_failure_keeps_technical(monkeypatch):
    snap = snapshot()
    calls = providers(monkeypatch)
    evidence = await collection.collect_context_evidence(build_comparison_evidence(snap), BriefingContextOptions(technical=True),
                                                         user="owner", economic_service=None, technical_snapshot=snap)
    assert calls == [] and evidence.sections[0].status == "available"
    async def broken(*args):
        raise RuntimeError("DO_NOT_EXPOSE")
    monkeypatch.setattr(collection.sources, "get_market_context_headlines", broken)
    mixed = await collection.collect_context_evidence(build_comparison_evidence(snap), BriefingContextOptions(news=True, technical=True),
                                                      user="owner", economic_service=None, technical_snapshot=snap)
    assert mixed.sections[0].reason == "provider_error" and mixed.sections[1].status == "available"
    assert "DO_NOT_EXPOSE" not in mixed.model_dump_json()


@pytest.mark.asyncio
async def test_technical_evidence_combines_with_selected_news_and_macro(monkeypatch):
    snap = snapshot()
    calls = providers(monkeypatch)
    news = collection.sources.get_market_context_headlines
    async def in_window(request, user):
        raw = await news(request, user)
        for group in raw["groups"]:
            for headline in group["headlines"]:
                headline["published_at"] = datetime.combine(request.start_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return raw
    monkeypatch.setattr(collection.sources, "get_market_context_headlines", in_window)
    evidence = await collection.collect_context_evidence(
        build_comparison_evidence(snap), BriefingContextOptions(news=True, macro_regions=["us"], technical=True),
        user="owner", economic_service=None, technical_snapshot=snap,
    )
    assert [section.kind for section in evidence.sections] == ["headlines", "macro", "technical"]
    assert [section.status for section in evidence.sections] == ["available", "available", "available"]
    assert len(calls) == 2
    synthesis.validate_context_briefing(json.dumps(answer(evidence)), evidence)


def test_valid_zero_metrics_remain_usable_references():
    data = histories()
    for raw in (data["AAPL"], data["BTC-USD"]):
        result = raw["chart"]["result"][0]
        result["indicators"]["adjclose"][0]["adjclose"] = [100.0] * len(result["timestamp"])
    client = _client(data, sources={symbol: "yahoo" for symbol in data}, feeds={symbol: "yahoo_chart" for symbol in data})
    snap = MarketComparisonResponse.model_validate(client.post("/api/market-context/compare", json=SELECTION).json())
    evidence = packet(snap)
    _, usable, _, _ = synthesis._reference_rules(evidence)
    assert all(metric.value == 0 and metric.citation_id in usable for asset in evidence.sections[0].assets for metric in asset.metrics)
    synthesis.validate_context_briefing(json.dumps(answer(evidence)), evidence)


def test_evidence_api_reuses_one_fresh_history_snapshot_and_rejects_browser_facts(monkeypatch):
    data, calls = histories(), []
    class Fetcher:
        async def fetch_history_with_provenance(self, symbol, **kwargs):
            calls.append(symbol)
            return data[symbol], "yahoo", "yahoo_chart"
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="owner")
    app.dependency_overrides[get_unified_fetcher] = lambda: Fetcher()
    app.dependency_overrides[get_economic_data_service] = lambda: None
    with TestClient(app) as client:
        body = {**SELECTION, "context": {"technical": True}}
        response = client.post("/api/market-context/briefing-context-evidence", json=body)
        assert response.status_code == 200, response.text
        assert calls == ["AAPL", "BTC-USD"]
        assert response.json()["requested"]["technical"] is True
        assert response.json()["sections"][0]["assets"][1]["metrics"][0]["value"] is not None
        assert client.post("/api/market-context/briefing-context-evidence", json={**body, "technical_snapshot": {}}).status_code == 422


@pytest.mark.asyncio
async def test_deep_synthesis_repairs_missing_technical_coverage_once_with_safe_feedback(monkeypatch):
    evidence = packet()
    first, repaired = answer(evidence), answer(evidence)
    first["possible_context"] = []
    model = _Client(json.dumps(first), json.dumps(repaired))
    configure(monkeypatch, model)
    result = await synthesis.generate_context_briefing(evidence)
    assert result.status == "complete" and len(model.calls) == 2
    assert result.model_profile.requested_profile == "deep"
    assert "technical_required_source_groups" in str(model.calls[0])
    assert "technical_coverage" in str(model.calls[1]) and "C1A1T1" in str(model.calls[1])
    assert "do not calculate new indicators" in model.calls[0][0][0]["content"]


def test_section_and_safe_reference_bounds_include_six_pairs_and_all_selected_sources():
    safe = InvalidComparisonBriefing("technical_coverage", references=["C24A2T3", "C25A1T1", "C1A1T1", "secret"])
    assert safe.references == ["C1A1T1", "C24A2T3"]
    data = histories()
    selected = ["BTC-USD", "SPY", "QQQ", "MSFT", "GOOG", "IWM"]
    for symbol in selected[2:]:
        data[symbol] = chart(symbol)
    client = _client(data, sources={symbol: "yahoo" for symbol in data}, feeds={symbol: "yahoo_chart" for symbol in data})
    raw = client.post("/api/market-context/compare", json={**SELECTION, "comparisons": selected}).json()
    snap = MarketComparisonResponse.model_validate(raw)
    evidence = packet(snap, news=True, macro_regions=["us", "euro_area"])
    assert len(evidence.sections) == 24 and evidence.sections[-1].citation_id == "C24"
    assert evidence.sections[-1].assets[1].metrics[2].citation_id == "C24A2T3"
    synthesis.validate_context_briefing(json.dumps(answer(evidence)), evidence)


@pytest.mark.asyncio
async def test_selected_technical_stream_disconnect_joins_the_original_history_fetches():
    started, cleaned = set(), set()
    all_started = asyncio.Event()
    class Fetcher:
        async def fetch_history_with_provenance(self, symbol, **kwargs):
            started.add(symbol)
            if len(started) == 2:
                all_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.add(symbol)
    payload = routes.ComparisonContextBriefingRequest(**SELECTION, context={"technical": True})
    response = await routes.stream_context_briefing(payload, "owner", Fetcher(), None)
    iterator = response.body_iterator
    assert json.loads(await anext(iterator))["type"] == "start"
    await anext(iterator)
    await asyncio.wait_for(all_started.wait(), 1)
    assert started == {"AAPL", "BTC-USD"}
    await iterator.aclose()
    assert cleaned == started


@pytest.mark.asyncio
async def test_selected_technical_price_deadline_keeps_typed_failure_and_joins_fetches(monkeypatch):
    cleaned = set()
    class Fetcher:
        async def fetch_history_with_provenance(self, symbol, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.add(symbol)
    monkeypatch.setattr(routes, "EVIDENCE_TIMEOUT_SECONDS", 0.01)
    payload = routes.ComparisonContextBriefingRequest(**SELECTION, context={"technical": True})
    result = await routes._run_context_briefing(payload, "owner", Fetcher(), None)
    assert result.status == "unavailable" and result.failure.code == "evidence_timed_out"
    assert cleaned == {"AAPL", "BTC-USD"} and result.evidence is None
