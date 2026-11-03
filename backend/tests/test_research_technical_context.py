"""Exact instrument technical evidence, bounded reference repair and research consumers."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.routes import ai_insights as routes
from backend.services import llm_insights
from backend.services.llm_profiles import resolve_llm_profile
from backend.services.research_technical_context import (
    research_technical_evidence, technical_research_prompts, validate_technical_references,
)
from backend.services.technical_snapshots import TechnicalSnapshotRequest, build_technical_snapshot
from backend.tests.test_technical_inputs import chart, DAYS
from backend.tests.test_shared_insight_profiles import Cache, configured

NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)


def evidence(kind="complete", symbol="AAPL"):
    raw = chart(symbol, crypto=symbol == "BTC-USD", days=DAYS[-20:] if kind == "partial" else DAYS)
    if kind == "zero":
        raw["chart"]["result"][0]["indicators"]["adjclose"][0]["adjclose"] = [100.0] * 32
    snapshot = build_technical_snapshot(
        TechnicalSnapshotRequest(symbol=symbol), raw if kind != "unavailable" else None,
        source="yahoo" if kind != "unavailable" else None, feed="yahoo_chart" if kind != "unavailable" else None,
        retrieved_at=NOW,
    )
    return research_technical_evidence(snapshot)


def answer(reference="TECH1"):
    return {"summary": "The supplied observations support only a conditional interpretation.", "sections": [
        {"title": "Evidence", "tone": "neutral", "points": [f"Recent behaviour is observable [{reference}]."]},
        {"title": "Risks", "tone": "negative", "points": ["The supplied data does not establish a mechanism."]},
    ]}


@pytest.mark.parametrize("kind,usable,points", [("complete", 3, 21), ("partial", 1, 20), ("unavailable", 0, 0), ("zero", 3, 21)])
def test_projection_keeps_exact_metric_references_and_only_used_closes(kind, usable, points):
    result = evidence(kind)
    assert [metric.citation_id for metric in result.metrics] == ["TECH1", "TECH2", "TECH3"]
    assert sum(metric.status == "available" for metric in result.metrics) == usable
    assert len(result.supporting_points) == points
    dates = {point.date for point in result.supporting_points}
    assert dates == {day for metric in result.metrics for day in metric.observation_dates}
    assert result.retrieved_at == NOW and result.history_semantics == "current_source_history_not_point_in_time"
    assert result.bar_completion == "not_verified" and "never-copy" not in result.model_dump_json()
    if kind == "zero":
        assert all(metric.value == 0 for metric in result.metrics)


def test_projection_rejects_substituted_metrics():
    snapshot = build_technical_snapshot(TechnicalSnapshotRequest(symbol="AAPL"), chart(), source="yahoo", feed="yahoo_chart", retrieved_at=NOW)
    snapshot.indicators.metrics[0] = snapshot.indicators.metrics[0].model_copy(update={"value": 999})
    with pytest.raises(ValueError, match="do not match"):
        research_technical_evidence(snapshot)


@pytest.mark.parametrize("kind", ["complete", "partial", "zero"])
def test_available_technical_references_are_required_even_for_zero(kind):
    result = evidence(kind)
    good = answer()
    validate_technical_references(good["summary"], good["sections"], result)
    with pytest.raises(llm_insights.InvalidInsightResponse, match="at least one"):
        validate_technical_references("No technical references", [], result)


@pytest.mark.parametrize("reference,kind", [("TECH4", "complete"), ("TECH2", "partial"), ("TECH1", "unavailable"), ("TECHgarbage", "complete")])
def test_unknown_or_unavailable_references_cannot_support_prose(reference, kind):
    bad = answer(reference)
    with pytest.raises(llm_insights.InvalidInsightResponse, match="available supplied"):
        validate_technical_references(bad["summary"], bad["sections"], evidence(kind))


def test_unknown_heading_reference_is_also_rejected_and_missing_context_can_use_other_facts():
    bad = answer()
    bad["sections"][0]["title"] += " [TECH9]"
    with pytest.raises(llm_insights.InvalidInsightResponse):
        validate_technical_references(bad["summary"], bad["sections"], evidence())
    validate_technical_references("Other facts remain usable.", [], evidence("unavailable"))


def test_prompt_preserves_notes_and_honest_technical_scope():
    system, facts = technical_research_prompts("Original scope", "Private thesis remains here", evidence())
    assert system.startswith("Original scope") and facts.startswith("Private thesis remains here")
    assert "untrusted research content" in system and "RSI/MACD" in system
    assert "current-source" in system and "at least one" in system
    assert '"citation_id":"TECH1"' in facts and '"supporting_points"' in facts


@pytest.mark.asyncio
async def test_missing_reference_repairs_once_on_same_profile_with_safe_feedback(monkeypatch):
    context = evidence()
    profile = resolve_llm_profile(configured(), "stock_briefing")
    calls = []

    class Client:
        async def health(self): return True
        async def chat(self, messages, **kwargs):
            calls.append(messages)
            value = answer() if len(calls) == 2 else answer("TECH99")
            return json.dumps(value)

    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: Client())
    result = await llm_insights.run_insight("system", "private facts", profile=profile,
        validate_result=lambda summary, sections: validate_technical_references(summary, sections, context))
    assert result["engine"] == "llm" and result["model"] == profile.model and len(calls) == 2
    assert "Technical citations" in calls[1][-1]["content"]
    assert "TECH99" not in calls[1][-1]["content"]


@pytest.fixture
def research(monkeypatch):
    cache = Cache()
    calls = {"history": [], "model": [], "related_queries": []}
    current = {"context": evidence(), "day": "2026-09-25"}

    async def technical(symbol):
        calls["history"].append(symbol)
        return current["context"]

    async def snapshot(symbol): return {"company_name": "Company", "current_price": 100}
    async def news(*args, **kwargs): return [{"title": "Supplied headline"}]
    async def empty(*args, **kwargs): return []
    async def related(db, owner, query, **kwargs):
        calls["related_queries"].append(query)
        return []
    async def crypto(*args, **kwargs): return {}
    async def run(system, facts, *, profile, validate_result=None, **kwargs):
        calls["model"].append((system, facts, profile))
        value = answer() if current["context"].status != "unavailable" else {**answer(), "summary": "Technical data is unavailable."}
        if current["context"].status == "unavailable": value["sections"][0]["points"] = ["Only other supplied facts are usable."]
        if validate_result: validate_result(value["summary"], value["sections"])
        return {**value, "engine": "llm", "model": profile.model, "model_profile": profile.public_identity()}

    monkeypatch.setattr(routes, "get_settings", lambda: configured())
    monkeypatch.setattr(routes, "cache_instance", cache)
    monkeypatch.setattr(routes, "_technical_for_symbol", technical)
    monkeypatch.setattr(routes, "_technical_cache_scope", lambda: {"technical_contract": "instrument-research-v1", "technical_date": current["day"]})
    monkeypatch.setattr(routes, "fetch_stock_snapshot_coalesced", snapshot)
    monkeypatch.setattr(routes, "_fetch_news_fallback", news)
    monkeypatch.setattr(routes, "_crypto_context", crypto)
    monkeypatch.setattr(routes.brain_service, "related_notes", related)
    monkeypatch.setattr(routes, "_note_cache_version", lambda db, owner: f"notes-{owner}")
    monkeypatch.setattr(routes, "run_insight", run)
    return calls, current, cache


@pytest.mark.asyncio
async def test_briefing_uses_same_context_for_prompt_and_response_and_versions_cache(research):
    calls, current, cache = research
    first = await routes.stock_briefing("AAPL", None, False)
    assert first["technical_context"] == current["context"].model_dump(mode="json")
    assert current["context"].snapshot_id in calls["model"][0][1]
    await routes.stock_briefing("AAPL", None, False)
    assert calls["history"] == ["AAPL"] and len(calls["model"]) == 1
    current["day"] = "2026-09-26"
    await routes.stock_briefing("AAPL", None, False)
    await routes.stock_briefing("AAPL", None, True)
    assert len(calls["history"]) == 3
    assert all("instrument-research-v1" in key for key in cache.keys)


class NotesDB:
    def __init__(self, owner): self.owner = owner
    def query(self, *args): return self
    def filter(self, *args): return self
    def order_by(self, *args): return self
    def limit(self, *args): return self
    def all(self): return [SimpleNamespace(title="Thesis", body=f"private-{self.owner}",
        effective_at=NOW - timedelta(days=30), created_at=NOW - timedelta(days=1))]


@pytest.mark.asyncio
async def test_interrogate_preserves_owner_notes_and_private_cache_isolation(research):
    calls, current, cache = research
    for owner in ["alice", "alice", "bob"]:
        result = await routes.interrogate_stock("AAPL", None, False, NotesDB(owner), SimpleNamespace(id=owner))
        assert result["technical_context"]["snapshot_id"] == current["context"].snapshot_id
    assert len(calls["model"]) == 2 and len(cache.rows) == 2
    assert "private-alice" in calls["model"][0][1] and "private-bob" not in calls["model"][0][1]
    assert "effective: 2026-08-26" in calls["model"][0][1] and "recorded: 2026-09-24" in calls["model"][0][1]
    assert "effective:" not in calls["related_queries"][0] and "recorded:" not in calls["related_queries"][0]
    assert "private-alice" in calls["related_queries"][0]
    assert "private-bob" in calls["model"][1][1] and "private-alice" not in calls["model"][1][1]


@pytest.mark.asyncio
async def test_unavailable_history_keeps_existing_research_inputs_usable(research):
    calls, current, _ = research
    current["context"] = evidence("unavailable")
    result = await routes.stock_briefing("AAPL", None, True)
    assert result["engine"] == "llm" and result["technical_context"]["status"] == "unavailable"
    assert "Company" in calls["model"][0][1] and "Supplied headline" in calls["model"][0][1]


@pytest.mark.asyncio
async def test_lazy_provider_failure_is_optional_and_cancellation_propagates(monkeypatch):
    async def broken(): raise RuntimeError("private?key=never-copy")
    monkeypatch.setattr(routes, "get_unified_fetcher", broken)
    result = await routes._technical_for_symbol("AAPL")
    assert result.input_reason == "provider_error" and result.status == "unavailable"
    assert "never-copy" not in result.model_dump_json()

    entered, closed = asyncio.Event(), asyncio.Event()
    async def stalled():
        try:
            entered.set()
            await asyncio.sleep(60)
        finally:
            closed.set()
    monkeypatch.setattr(routes, "get_unified_fetcher", stalled)
    task = asyncio.create_task(routes._technical_for_symbol("AAPL"))
    await entered.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert closed.is_set()


@pytest.mark.asyncio
async def test_invalid_stream_references_use_same_model_bounded_completion(monkeypatch):
    context = evidence()
    profile = resolve_llm_profile(configured(), "stock_briefing")
    calls = []
    class Client:
        async def health(self): return True
        async def chat_stream(self, messages, **kwargs):
            calls.append("stream")
            yield json.dumps(answer("TECH99"))
        async def chat(self, messages, **kwargs):
            calls.append("completion")
            assert "Technical citations" in messages[-1]["content"]
            return json.dumps(answer())
    def client(**kwargs):
        assert kwargs["profile"] is profile
        return Client()
    monkeypatch.setattr(llm_insights, "get_llm_client", client)
    result = await llm_insights.run_insight("system", "facts", profile=profile, on_token=lambda _: None,
        validate_result=lambda summary, sections: validate_technical_references(summary, sections, context))
    assert result["engine"] == "llm" and calls == ["stream", "completion"]


@pytest.mark.asyncio
async def test_persistent_missing_technical_references_fail_after_one_repair(monkeypatch):
    context = evidence()
    profile = resolve_llm_profile(configured(), "stock_briefing")
    calls = []
    class Client:
        async def health(self): return True
        async def chat(self, messages, **kwargs):
            calls.append(messages)
            return json.dumps(answer("TECH99"))
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: Client())
    result = await llm_insights.run_insight("system", "facts", profile=profile,
        validate_result=lambda summary, sections: validate_technical_references(summary, sections, context))
    assert len(calls) == 2 and result["failure"]["code"] == "invalid_response"


def test_get_endpoints_publish_the_typed_companion_and_validate_symbols(research, monkeypatch):
    from backend.main import app
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db
    # Exercise response serialization with controlled owner/DB dependencies;
    # the existing auth-route tests retain the real middleware/auth checks.
    monkeypatch.setenv("AUTH_MIDDLEWARE_ENABLED", "0")
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="alice")
    app.dependency_overrides[get_db] = lambda: NotesDB("alice")
    try:
        client = TestClient(app)
        for path in ["/api/ai/briefing/AAPL", "/api/ai/interrogate/AAPL"]:
            response = client.get(path)
            assert response.status_code == 200, response.text
            value = response.json()
            assert value["technical_context"]["symbol"] == "AAPL"
            assert value["technical_context"]["metrics"][0]["citation_id"] == "TECH1"
            assert value["engine"] == "llm" and value["model_profile"]["model"] == value["model"]
        assert client.get("/api/ai/briefing/A@B").status_code == 422
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.mark.asyncio
async def test_lazy_fetcher_startup_timeout_remains_optional(monkeypatch):
    closed = asyncio.Event()
    async def stalled():
        try: await asyncio.sleep(60)
        finally: closed.set()
    real_timeout = asyncio.timeout
    monkeypatch.setattr(routes, "get_unified_fetcher", stalled)
    monkeypatch.setattr(routes.asyncio, "timeout", lambda seconds: real_timeout(0.001))
    result = await routes._technical_for_symbol("AAPL")
    assert closed.is_set() and result.input_reason == "provider_timeout"
    assert result.status == "unavailable"
