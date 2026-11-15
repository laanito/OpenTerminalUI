"""Explicit selected text, method distinctions and cache/restart provenance."""
import asyncio
import copy
import hashlib
import json
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from backend.api.routes import comparison_captures as routes
from backend.api.routes.news_evidence import router as evidence_router
from backend.config.settings import AppSettings
from backend.models import NewsTextSnapshotORM, NewsSentimentAssessmentORM
from backend.services import captured_headline_sentiment as scoring, llm_client
from backend.services.news_evidence import NewsText
from backend.tests.test_comparison_captures import store, setup_provider, URL, SELECTION  # noqa: F401
from backend.tests.test_comparison_context_briefing import packet, valid

CHOICE = {"headlines": [{"citation_id": "C1G1H1", "target_symbol": "AAPL"}]}


def verdict(index=0, **changes):
    return {"index": index, "score": -0.5, "label": "bearish", "rationale": "Limited headline suggests an adverse implication.", **changes}


@pytest.fixture(autouse=True)
def evidence_store(store, monkeypatch):
    client, _, _, engine = store
    NewsTextSnapshotORM.__table__.create(engine)
    NewsSentimentAssessmentORM.__table__.create(engine)
    client.app.include_router(evidence_router)
    cached = {}
    async def get(key): return copy.deepcopy(cached.get(key))
    async def put(key, value, **kwargs): cached[key] = copy.deepcopy(value)
    monkeypatch.setattr(scoring, "cache_instance", SimpleNamespace(build_key=lambda *parts: json.dumps(parts, sort_keys=True), get=get, set=put))
    return cached


def source(client, monkeypatch, replies=None, evidence=None, enabled=True):
    evidence = evidence or packet()
    _, calls, preparations = setup_provider(monkeypatch, context=True, evidence_override=evidence,
        replies=[valid(evidence), *(replies or [{"articles": [verdict()]}])], enabled=enabled)
    saved = client.post(URL, json={**SELECTION, "context": {"news": True, "macro_regions": ["us", "euro_area"]}}).json()
    return saved, calls, preparations


def capture(client, saved, selection=CHOICE):
    response = client.post(f"{URL}/{saved['id']}/sentiment", json=selection)
    assert response.status_code == 201, response.text
    return response.json()


def test_explicit_scoring_retains_exact_text_target_and_actual_dispatch_without_changing_source(store, monkeypatch):
    client, factory, owner, engine = store
    evidence = packet()
    headline = evidence.sections[0].groups[0].headlines[0]
    headline.title = "  Strong growth but shares fall  "
    headline.title_truncated = True
    saved, calls, preparations = source(client, monkeypatch, evidence=evidence)
    result = capture(client, saved)
    assert len(result) == 1 and len(calls) == 2 and len(preparations) == 1
    row = result[0]
    text = row["payload"]
    assert text["title"] == headline.title and text["summary"] == "" and text["text_scope"] == "headline_only"
    assert text["truncated"] is True and text["symbols"] == ["AAPL"]
    assert text["retrieved_at"] == evidence.sections[0].retrieved_at.isoformat().replace("+00:00", "Z")
    assert text["origin"] == {"kind": "saved_comparison_headlines", "capture_id": saved["id"],
        "capture_content_hash": saved["content_hash"], "citation_ids": ["C1G1H1"]}
    baseline, fast = [item["payload"] for item in row["assessments"]]
    assert baseline["meaning"] == "text_tone" and baseline["method"] == "lexical" and baseline["model"] is None
    assert fast["meaning"] == "asset_implication" and fast["target_symbol"] == "AAPL" and fast["method"] == "llm"
    assert fast["status"] == "complete" and fast["score"] == -0.5
    assert fast["confidence"] is None and fast["confidence_kind"] == "not_provided"
    assert fast["input_text"] == headline.title
    assert fast["generation"]["attempts"][0]["body"] == calls[1]
    assert json.loads(calls[1]["messages"][1]["content"])[0]["target_symbol"] == "AAPL"
    assert "PRIVATE-CONFIGURED-KEY" not in json.dumps(result) and "private-endpoint.test" not in json.dumps(result)
    assert client.get(f"{URL}/{saved['id']}").json() == saved
    engine.dispose()
    async def forbidden(*args, **kwargs): pytest.fail("Read must not fetch or infer")
    monkeypatch.setattr(scoring, "assess_headlines", forbidden)
    monkeypatch.setattr(routes, "assess_headlines", forbidden)
    assert client.get(f"/api/news/evidence/{row['id']}").json() == row
    assert client.get(f"{URL}/{saved['id']}/sentiment").json() == result
    assert client.get(f"{URL}/{saved['id']}/sentiment?offset=1").json() == []
    owner["id"] = "other"
    assert client.get(f"/api/news/evidence/{row['id']}").status_code == 404
    assert client.get(f"{URL}/{saved['id']}/sentiment").json() == []
    assert client.post(f"{URL}/{saved['id']}/sentiment", json=CHOICE).status_code == 404
    owner["id"] = "owner"
    client.delete(f"{URL}/{saved['id']}")
    assert client.get(f"/api/news/evidence/{row['id']}").json() == row
    assert client.get(f"{URL}/{saved['id']}/sentiment").json() == result


def test_cache_hit_preserves_original_scoring_time_and_inputs_while_records_get_new_ids(store, monkeypatch):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    first = capture(client, saved)[0]
    second = capture(client, saved)[0]
    assert len(calls) == 2  # Original comparison + one scoring batch.
    assert first["id"] != second["id"]
    original, reused = first["assessments"][1], second["assessments"][1]
    assert original["id"] != reused["id"]
    assert original["payload"]["reused_from_cache"] is False and reused["payload"]["reused_from_cache"] is True
    assert {**original["payload"], "reused_from_cache": True} == reused["payload"]
    assert reused["recorded_at"] >= original["recorded_at"]
    assert second["assessments"][0]["payload"]["reused_from_cache"] is False
    assert client.get(f"/api/news/evidence/{first['id']}").json() == first


@pytest.mark.parametrize("change", ["target", "batch", "profile", "owner", "prompt"])
def test_cache_identity_includes_target_full_batch_profile_owner_and_prompt(store, monkeypatch, change):
    client, factory, owner, _ = store
    evidence = packet()
    evidence.sections[0].groups[1].headlines[0].title = evidence.sections[0].groups[0].headlines[0].title
    saved, calls, _ = source(client, monkeypatch, evidence=evidence)
    async def chat(self, messages, **kwargs):
        body = {"model": self.model, "messages": copy.deepcopy(messages)}
        kwargs["on_request"](body); calls.append(body)
        count = len(json.loads(messages[1]["content"]))
        return json.dumps({"articles": [verdict(i) for i in range(count)]})
    monkeypatch.setattr(llm_client.LLMClient, "chat", chat)
    capture(client, saved)
    count = len(calls)
    selected = copy.deepcopy(CHOICE)
    if change == "target":
        selected = {"headlines": [{"citation_id": "C1G2H1", "target_symbol": "SPY"}]}
    elif change == "batch":
        selected["headlines"].append({"citation_id": "C1G2H1", "target_symbol": "SPY"})
    elif change == "profile":
        monkeypatch.setattr(routes, "get_settings", lambda: AppSettings(llm_enabled=True, llm_model="changed-fast", llm_timeout_seconds=1))
    elif change == "prompt":
        monkeypatch.setattr(scoring, "PROMPT_VERSION", "different-version")
    else:
        # New owner has an independently captured source; no shared private cache.
        from backend.models import ComparisonCaptureORM
        with factory() as db:
            db.add(ComparisonCaptureORM(id="other-source", user_id="other", captured_at=scoring.datetime.now(scoring.timezone.utc),
                content_hash=saved["content_hash"], mode=saved["mode"], status=saved["status"], payload=saved["content"]))
            db.commit()
        owner["id"] = "other"; saved = {**saved, "id": "other-source"}
    result = capture(client, saved, selected)
    assert len(calls) == count + 1, result
    assert all(not row["assessments"][1]["payload"]["reused_from_cache"] for row in result)


@pytest.mark.parametrize("reply,code", [
    ({"articles": []}, "missing_item"), ({"articles": [verdict(), verdict()]}, "invalid_response"),
    ({"articles": [verdict(index=10)]}, "invalid_response"),
    ({"articles": [verdict(score=float("nan"))]}, "invalid_response"),
    ({"articles": [verdict(score=0.5)]}, "invalid_response"),
    ({"articles": [verdict(index=True)]}, "invalid_response"),
    ({"articles": [verdict(extra="unchecked")]}, "invalid_response"),
    ("invalid JSON", "invalid_response"), (500, "provider_error"),
])
def test_invalid_missing_and_provider_failures_never_become_neutral_or_lexical_asset_verdicts(store, monkeypatch, reply, code):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch, replies=[reply])
    rows = capture(client, saved)
    baseline, fast = [item["payload"] for item in rows[0]["assessments"]]
    assert baseline["status"] == "complete" and baseline["meaning"] == "text_tone"
    assert fast["status"] == "failed" and fast["failure_code"] == code
    assert fast["score"] is fast["label"] is fast["rationale"] is fast["confidence"] is None
    capture(client, saved)
    assert len(calls) == 3  # Failed assessments are retained but never cached.


def test_partial_valid_batch_keeps_success_and_missing_failure(store, monkeypatch):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    rows = capture(client, saved, {"headlines": [*CHOICE["headlines"], {"citation_id": "C1G2H1", "target_symbol": "SPY"}]})
    assert [row["assessments"][1]["payload"]["status"] for row in rows] == ["complete", "failed"]
    assert rows[1]["assessments"][1]["payload"]["failure_code"] == "missing_item"


@pytest.mark.parametrize("selection", [
    {"headlines": []}, {"headlines": CHOICE["headlines"] * 11}, {"headlines": CHOICE["headlines"] * 2},
    {"headlines": [{"citation_id": "C1G1H1", "target_symbol": "SPY"}]},
    {"headlines": [{"citation_id": "P1", "target_symbol": "AAPL"}]},
    {"headlines": [{**CHOICE["headlines"][0], "title": "browser replacement"}]},
    {**CHOICE, "generation": {}},
])
def test_invalid_scope_and_browser_text_fail_before_scoring(store, monkeypatch, selection):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    assert client.post(f"{URL}/{saved['id']}/sentiment", json=selection).status_code == 422
    assert len(calls) == 1
    assert client.get(f"{URL}/{saved['id']}/sentiment").json() == []


@pytest.mark.parametrize("failure", ["disabled", "health", "timeout"])
def test_disabled_unavailable_timeout_are_explicit_failed_assessments(store, monkeypatch, failure):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    if failure == "disabled":
        monkeypatch.setattr(routes, "get_settings", lambda: AppSettings(llm_enabled=False))
        expected = "disabled"
    elif failure == "health":
        async def unhealthy(self): return False
        monkeypatch.setattr(llm_client.LLMClient, "health", unhealthy)
        expected = "provider_unavailable"
    else:
        async def timeout(self, *args, **kwargs): raise TimeoutError()
        monkeypatch.setattr(llm_client.LLMClient, "chat", timeout)
        expected = "timeout"
    row = capture(client, saved)[0]
    assert row["assessments"][1]["payload"]["failure_code"] == expected
    assert row["assessments"][1]["payload"]["generation"]["attempts"] == []
    assert len(calls) == 1


def test_storage_failure_rolls_back_all_text_and_assessments(store, monkeypatch):
    client, factory, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    def fail(*args): raise RuntimeError("PRIVATE-DB-DETAIL")
    monkeypatch.setattr(Session, "commit", fail)
    response = client.post(f"{URL}/{saved['id']}/sentiment", json=CHOICE)
    assert response.status_code == 503 and "PRIVATE-DB-DETAIL" not in response.text
    with factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsTextSnapshotORM)) == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsSentimentAssessmentORM)) == 0


def test_repeated_selected_pair_copies_are_scored_once_with_all_local_references():
    evidence = packet()
    section = evidence.sections[0].model_copy(deep=True)
    section.groups[0].headlines[0].citation_id = "C2G1H1"
    selected = scoring.SelectedHeadlines(headlines=[*CHOICE["headlines"], {"citation_id": "C2G1H1", "target_symbol": "AAPL"}])
    texts = scoring.select_headlines(SimpleNamespace(sections=[evidence.sections[0], section]), selected,
                                    capture_id="saved", content_hash="c" * 64)
    assert len(texts) == 1
    assert texts[0].origin.citation_ids == ("C1G1H1", "C2G1H1")


def test_baseline_uses_only_versioned_keyword_tone_without_hidden_models():
    from datetime import datetime, timezone
    text = NewsText(title="strong growth but warning", source_url="https://example.test", publisher="Example",
                    retrieved_at=datetime.now(timezone.utc), text_scope="headline_only")
    result = scoring.baseline(text)
    assert result.score == 0.3333 and result.label == "bullish" and result.meaning == "text_tone"
    assert result.confidence is result.model is result.target_symbol is None
    assert result.method_version == "finance-keyword-tone-v1"


@pytest.mark.asyncio
async def test_cancelled_scoring_does_not_leave_partial_rows(store, monkeypatch):
    client, factory, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def blocked(self, *args, **kwargs):
        started.set()
        try: await asyncio.Future()
        finally: cancelled.set()
    monkeypatch.setattr(llm_client.LLMClient, "chat", blocked)
    with factory() as db:
        task = asyncio.create_task(routes.capture_headline_sentiment(saved["id"], scoring.SelectedHeadlines(**CHOICE), SimpleNamespace(id="owner"), db))
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert cancelled.is_set()
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsTextSnapshotORM)) == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(NewsSentimentAssessmentORM)) == 0


def test_requires_jwt_and_source_integrity_before_any_scoring(store, monkeypatch):
    from backend.auth.deps import get_current_user
    from backend.models import ComparisonCaptureORM
    client, factory, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    with factory() as db:
        db.execute(sa.update(ComparisonCaptureORM).where(ComparisonCaptureORM.id == saved["id"]).values(content_hash="0" * 64))
        db.commit()
    assert client.post(f"{URL}/{saved['id']}/sentiment", json=CHOICE).status_code == 409
    assert len(calls) == 1
    client.app.dependency_overrides.pop(get_current_user)
    assert client.post(f"{URL}/{saved['id']}/sentiment", json=CHOICE).status_code == 401
    assert client.get(f"{URL}/{saved['id']}/sentiment").status_code == 401
    assert client.get("/api/news/evidence/missing").status_code == 401


def test_cache_and_provider_edits_do_not_rewrite_previous_assessments(store, monkeypatch, evidence_store):
    from backend.models import ComparisonCaptureORM
    client, factory, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    first = capture(client, saved)[0]
    # A provenance-free/legacy-shaped entry in the new namespace is rejected.
    key = next(iter(evidence_store))
    evidence_store[key] = [{"score": 0.8, "label": "bullish", "engine": "llm"}]
    second = capture(client, saved)[0]
    assert len(calls) == 3 and not second["assessments"][1]["payload"]["reused_from_cache"]
    changed = copy.deepcopy(saved["content"])
    changed["result"]["evidence"]["sections"][0]["groups"][0]["headlines"][0]["title"] = "An edited title at the same URL"
    digest = hashlib.sha256(json.dumps(changed, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    with factory() as db:
        db.add(ComparisonCaptureORM(id="edited-source", user_id="owner", captured_at=scoring.datetime.now(scoring.timezone.utc),
            mode=saved["mode"], status=saved["status"], content_hash=digest, payload=changed))
        db.commit()
    edited = capture(client, {**saved, "id": "edited-source"})[0]
    assert len(calls) == 4 and edited["content_hash"] != first["content_hash"]
    assert edited["payload"]["source_url"] == first["payload"]["source_url"]
    assert client.get(f"/api/news/evidence/{first['id']}").json() == first


def test_format_fallback_records_each_actual_dispatch_without_repair_or_secret_metadata(store, monkeypatch):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch, replies=[400, {"articles": [verdict()]}])
    fast = capture(client, saved)[0]["assessments"][1]["payload"]
    assert fast["status"] == "complete"
    assert [item["body"] for item in fast["generation"]["attempts"]] == calls[1:]
    assert calls[1]["response_format"]["type"] == "json_schema" and calls[2]["response_format"]["type"] == "json_object"
    assert calls[1]["messages"] == calls[2]["messages"]


def test_bad_cache_and_cache_write_failure_do_not_lose_retained_scoring(store, monkeypatch):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    async def bad(*args, **kwargs): raise RuntimeError("PRIVATE-CACHE-DETAIL")
    monkeypatch.setattr(scoring.cache_instance, "get", bad)
    monkeypatch.setattr(scoring.cache_instance, "set", bad)
    result = capture(client, saved)
    assert result[0]["assessments"][1]["payload"]["status"] == "complete"
    assert len(calls) == 2 and "PRIVATE-CACHE-DETAIL" not in json.dumps(result)


@pytest.mark.asyncio
async def test_actual_shared_deadline_cancels_unfinished_fast_work(store, monkeypatch):
    client, _, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    cancelled = asyncio.Event()
    async def slow(self, *args, **kwargs):
        try: await asyncio.Future()
        finally: cancelled.set()
    monkeypatch.setattr(llm_client.LLMClient, "chat", slow)
    monkeypatch.setattr(routes, "get_settings", lambda: AppSettings(llm_enabled=True, llm_timeout_seconds=0.02))
    row = capture(client, saved)[0]
    assert cancelled.is_set()
    assert row["assessments"][1]["payload"]["failure_code"] == "timeout"


def test_explicit_assessment_routes_to_fast_even_with_a_separate_deep_model(store, monkeypatch):
    client, _, _, _ = store
    saved, calls, _ = source(client, monkeypatch)
    monkeypatch.setattr(routes, "get_settings", lambda: AppSettings(llm_enabled=True, llm_model="fast-assessor",
        llm_deep_model="deep-interpreter", llm_deep_base_url="https://deep-private.test/v1", llm_timeout_seconds=1))
    fast = capture(client, saved)[0]["assessments"][1]["payload"]
    assert calls[-1]["model"] == fast["model"] == "fast-assessor"
    assert fast["generation"]["profile"] == {"requested_profile": "fast", "resolved_profile": "fast", "model": "fast-assessor"}
    assert "deep-private" not in json.dumps(fast)


def test_read_preserves_raw_stored_extensions_without_hydrating_current_defaults(store, monkeypatch):
    client, factory, _, _ = store
    saved, _, _ = source(client, monkeypatch)
    row = capture(client, saved)[0]
    payload = {**row["payload"], "retained_extension": {"original": True}}
    with factory() as db:
        db.execute(sa.update(NewsTextSnapshotORM).where(NewsTextSnapshotORM.id == row["id"]).values(payload=payload))
        db.commit()
    assert client.get(f"/api/news/evidence/{row['id']}").json()["payload"] == payload
    assert client.get(f"{URL}/{saved['id']}/sentiment").json()[0]["payload"] == payload
