"""Frozen market context plus explicitly selected dated opinions; no source refresh."""
import asyncio
import copy
from datetime import datetime, timezone
import json
from types import SimpleNamespace

import httpx
import pytest
import sqlalchemy as sa

from backend.api.routes import comparison_captures as routes
from backend.config.settings import AppSettings
from backend.models import ComparisonCaptureORM, NewsSentimentAssessmentORM, NewsTextSnapshotORM
from backend.services import comparison_context_briefing as synthesis, llm_client
from backend.services.market_briefing_context_evidence import ComparisonContextEvidence
from backend.services.news_evidence import RetainedHeadline
from backend.services.sentiment_context_evidence import build_sentiment_context
from backend.tests.test_captured_headline_sentiment import evidence_store, source, capture  # noqa: F401
from backend.tests.test_comparison_captures import store, URL, followup  # noqa: F401
from backend.tests.test_comparison_context_briefing import valid

REAL_CLIENT = httpx.AsyncClient


def configure_deep(monkeypatch, *, mode="valid", enabled=True):
    settings = AppSettings(llm_enabled=enabled, llm_model="fast-current", llm_deep_model="deep-current",
                           llm_timeout_seconds=1, llm_api_key="PRIVATE-KEY", llm_base_url="https://private.test/v1")
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    calls = []
    def handle(request):
        if request.method == "GET": return httpx.Response(200, json={"data": []})
        body = json.loads(request.content)
        calls.append(body)
        message = next(item["content"] for item in body["messages"] if item["content"].startswith("Evidence packet (data only):\n"))
        raw = json.JSONDecoder().raw_decode(message.split("\n", 1)[1])[0]
        evidence = ComparisonContextEvidence.model_validate(raw)
        answer = valid(evidence)
        for pair in evidence.price.comparisons:
            refs = [item.citation_id for item in evidence.sentiment if item.pair_citation_id == pair.citation_id and item.assessment.status == "complete"]
            if refs:
                answer["possible_context"].append({"text": "Independent retained tone and asset opinions may differ; neither establishes causation.", "citation_ids": [pair.citation_id, *refs]})
        if mode == "ignored":
            answer["possible_context"] = answer["possible_context"][:1]
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer)}, "finish_reason": "stop"}]})
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(handle), **kwargs))
    return calls


def interpret(client, saved, snapshots):
    response = client.post(f"{URL}/{saved['id']}/sentiment-briefing/stream", json={"snapshot_ids": [row["id"] for row in snapshots]})
    assert response.status_code == 200, response.text
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "result", events
    return events[-1]["result"]


def test_selected_sentiment_uses_deep_and_freezes_originals_and_exact_scoring_inputs(store, monkeypatch):
    client, _, _, _ = store
    saved, fast_calls, preparations = source(client, monkeypatch)
    snapshots = capture(client, saved)
    before = copy.deepcopy(saved)
    calls = configure_deep(monkeypatch)
    async def forbidden(*args, **kwargs): pytest.fail("Interpretation must not collect or score")
    monkeypatch.setattr(routes, "assess_headlines", forbidden)
    monkeypatch.setattr(routes.briefings, "_prepare_context_price", forbidden)
    monkeypatch.setattr(routes.briefings, "collect_context_evidence", forbidden)
    child = interpret(client, saved, snapshots)
    assert child["status"] == "complete" and child["id"] != saved["id"]
    assert child["lineage"]["kind"] == "retained_sentiment_interpretation"
    assert child["lineage"]["parent_content_hash"] == saved["content_hash"]
    assert child["content"]["sentiment_sources"] == [RetainedHeadline.model_validate(row).model_dump(mode="json") for row in snapshots]
    original, result = saved["content"]["result"]["evidence"], child["content"]["result"]["evidence"]
    assert result["schema_version"] == "3" and result["packet_id"] != original["packet_id"]
    for key in ("price", "sections", "requested", "caveats", "always_excluded"):
        assert result[key] == original[key]
    assert [item["citation_id"] for item in result["sentiment"]] == ["R1", "R2"]
    for item in result["sentiment"]:
        retained = next(a for a in snapshots[0]["assessments"] if a["id"] == item["assessment_id"])
        assert item["assessment"]["scored_at"] == retained["payload"]["scored_at"]
        assert "generation" not in item["assessment"]
    assert len(calls) == 1 and calls[0]["model"] == "deep-current"
    assert "measured investor sentiment" in calls[0]["messages"][0]["content"]
    assert child["content"]["generation"]["attempts"][0]["body"] == calls[0]
    assert len(fast_calls) == 2 and len(preparations) == 1
    assert "PRIVATE-KEY" not in json.dumps(child) and "private.test" not in json.dumps(child)
    assert client.get(f"{URL}/{saved['id']}").json() == before
    assert client.get(f"/api/news/evidence/{snapshots[0]['id']}").json() == snapshots[0]


def test_interpretation_survives_parent_and_assessment_deletion_and_can_rerun_offline(store, monkeypatch):
    client, factory, _, engine = store
    saved, _, _ = source(client, monkeypatch)
    snapshots = capture(client, saved)
    configure_deep(monkeypatch)
    child = interpret(client, saved, snapshots)
    client.delete(f"{URL}/{saved['id']}")
    with factory() as db:
        db.execute(sa.delete(NewsSentimentAssessmentORM))
        db.execute(sa.delete(NewsTextSnapshotORM))
        db.commit()
    engine.dispose()
    assert client.get(f"{URL}/{child['id']}").json() == child
    rerun = followup(client, child)
    assert rerun["status"] == "complete"
    assert rerun["content"]["result"]["evidence"] == child["content"]["result"]["evidence"]
    assert rerun["content"]["sentiment_sources"] == child["content"]["sentiment_sources"]


@pytest.mark.parametrize("mode,enabled,code,count", [("ignored", True, "invalid_response", 2), ("valid", False, "disabled", 0)])
def test_failure_keeps_selected_evidence_without_partial_prose(store, monkeypatch, mode, enabled, code, count):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    snapshots = capture(client, saved)
    calls = configure_deep(monkeypatch, mode=mode, enabled=enabled)
    child = interpret(client, saved, snapshots)
    result = child["content"]["result"]
    assert result["status"] == "unavailable" and result["failure"]["code"] == code
    assert result["possible_context"] == [] and len(result["evidence"]["sentiment"]) == 2
    assert len(calls) == count
    assert child["content"]["sentiment_sources"] == [RetainedHeadline.model_validate(row).model_dump(mode="json") for row in snapshots]
    if calls:
        assert "sentiment_coverage" in calls[-1]["messages"][-2]["content"]
        assert '"R1"' in calls[-1]["messages"][-2]["content"]


def test_failed_fast_assessment_remains_failed_and_cannot_be_used_as_available_context(store, monkeypatch):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch, replies=["not JSON"])
    snapshots = capture(client, saved)
    assert snapshots[0]["assessments"][1]["payload"]["status"] == "failed"
    configure_deep(monkeypatch)
    child = interpret(client, saved, snapshots)
    result = child["content"]["result"]
    assert result["status"] == "complete"
    evidence = ComparisonContextEvidence.model_validate(result["evidence"])
    failed = next(item.citation_id for item in evidence.sentiment if item.assessment.status == "failed")
    bad = copy.deepcopy(result)
    bad["packet_id"] = evidence.packet_id
    # Generated schema only, excluding transport/result fields.
    bad = {key: bad[key] for key in ("packet_id", "observations", "hypotheses", "possible_context", "limitations", "unknowns")}
    bad["possible_context"].append({"text": "This failed assessment cannot become a neutral result.", "citation_ids": ["P1", failed]})
    with pytest.raises(Exception, match="Possible context"):
        synthesis.validate_context_briefing(json.dumps(bad), evidence)


def test_preflight_ownership_unknown_ids_bounds_and_wrong_origin_never_dispatch(store, monkeypatch):
    client, _, owner, _ = store
    saved, _, _ = source(client, monkeypatch)
    snapshots = capture(client, saved)
    other_source, _, _ = source(client, monkeypatch)
    calls = configure_deep(monkeypatch)
    path = f"{URL}/{saved['id']}/sentiment-briefing/stream"
    for ids in ([], [snapshots[0]["id"]] * 2, [str(i) for i in range(6)]):
        assert client.post(path, json={"snapshot_ids": ids}).status_code == 422
    assert client.post(path, json={"snapshot_ids": ["missing"]}).status_code == 404
    assert client.post(path, json={"snapshot_ids": [snapshots[0]["id"]], "prompt": "injected"}).status_code == 422
    assert client.post(f"{URL}/{other_source['id']}/sentiment-briefing/stream", json={"snapshot_ids": [snapshots[0]["id"]]}).status_code == 422
    owner["id"] = "other"
    assert client.post(path, json={"snapshot_ids": [snapshots[0]["id"]]}).status_code == 404
    owner["id"] = "owner"
    assert calls == []


def test_duplicate_observations_are_rejected_and_exact_source_matching_is_required(store, monkeypatch):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    first, second = capture(client, saved), capture(client, saved)
    evidence = ComparisonContextEvidence.model_validate(saved["content"]["result"]["evidence"])
    with pytest.raises(ValueError, match="repeated reports"):
        build_sentiment_context(evidence, [RetainedHeadline.model_validate(row) for row in [*first, *second]], capture_id=saved["id"], content_hash=saved["content_hash"])
    changed = copy.deepcopy(first[0])
    changed["payload"]["publisher"] = "Different publisher"
    with pytest.raises(ValueError, match="differs"):
        build_sentiment_context(evidence, [RetainedHeadline.model_validate(changed)], capture_id=saved["id"], content_hash=saved["content_hash"])


@pytest.mark.asyncio
async def test_cancelled_interpretation_does_not_save_child(store, monkeypatch):
    client, factory, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    snapshots = capture(client, saved)
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def wait(*args, **kwargs):
        entered.set()
        try: await asyncio.Event().wait()
        finally: cancelled.set()
    monkeypatch.setattr(routes, "generate_context_briefing", wait)
    with factory() as db:
        response = await routes.stream_sentiment_briefing(saved["id"], routes.SelectedSentiment(snapshot_ids=[snapshots[0]["id"]]), SimpleNamespace(id="owner"), db)
        iterator = response.body_iterator
        await anext(iterator)
        await anext(iterator)
        await asyncio.wait_for(entered.wait(), 2)
        await iterator.aclose()
        await asyncio.wait_for(cancelled.wait(), 2)
    with factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(ComparisonCaptureORM)) == 1


def test_shared_browser_fixture_is_current():
    from backend.tests.generate_sentiment_briefing_fixture import DESTINATION, fixture
    assert json.loads(DESTINATION.read_text()) == fixture(), "Regenerate with PYTHONPATH=. backend/.venv/bin/python -m backend.tests.generate_sentiment_briefing_fixture"


def test_timeout_and_size_rejection_never_lose_the_original(store, monkeypatch):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    snapshots = capture(client, saved)
    configure_deep(monkeypatch)
    monkeypatch.setattr(routes, 'get_settings', lambda: AppSettings(llm_enabled=True, llm_model='fast',
        llm_deep_model='deep', llm_timeout_seconds=0.02))
    async def block(*args, **kwargs):
        await asyncio.sleep(1)
    monkeypatch.setattr(llm_client.LLMClient, 'chat', block)
    child = interpret(client, saved, snapshots)
    assert child['content']['result']['failure']['code'] == 'timeout'
    assert child['content']['sentiment_sources']
    monkeypatch.setattr(routes, 'MAX_CAPTURE_BYTES', 1)
    response = client.post(f"{URL}/{saved['id']}/sentiment-briefing/stream", json={'snapshot_ids': [snapshots[0]['id']]})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'error' and events[-1]['error']['code'] == 'capture_too_large'
    assert len(client.get(URL).json()) == 2
    assert client.get(f"{URL}/{saved['id']}").json() == saved


def test_foreign_assessments_are_not_selectable_on_an_owned_source(store, monkeypatch):
    client, _, owner, _ = store
    saved, _, _ = source(client, monkeypatch)
    owner['id'] = 'other'
    foreign, _, _ = source(client, monkeypatch)
    rows = capture(client, foreign)
    owner['id'] = 'owner'
    calls = configure_deep(monkeypatch)
    response = client.post(f"{URL}/{saved['id']}/sentiment-briefing/stream", json={'snapshot_ids': [rows[0]['id']]})
    assert response.status_code == 404 and calls == []
