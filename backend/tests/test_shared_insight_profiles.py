"""Shared insights resolve one model for transport, deadlines, identity and caches."""
import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from backend.api.routes import ai_insights as routes
from backend.services import llm_client, llm_insights
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_llm_profiles import settings


def configured(**overrides):
    return settings(**{"llm_deep_model": "deep-model", "llm_deep_base_url": "https://deep.example/v1",
                       "llm_deep_timeout_seconds": 600, "llm_deep_structured_output": "json", **overrides})


def content():
    return {"summary": "Observed facts have limits.", "sections": [
        {"title": "Evidence", "tone": "neutral", "points": ["Observed"]},
        {"title": "Risks", "tone": "negative", "points": ["Limited"]},
    ]}


@pytest.mark.asyncio
@pytest.mark.parametrize("deep", [False, True])
async def test_transport_health_stream_fallback_and_repair_stay_on_selected_model(monkeypatch, deep):
    profile = resolve_llm_profile(configured() if deep else settings(), "portfolio_risk")
    requests, completions = [], []

    def handle(request):
        requests.append(request)
        assert request.url.host == ("deep.example" if deep else "fast.example")
        assert request.headers.get("authorization") == (None if deep else "Bearer fast-test-secret")
        if request.method == "GET":
            return httpx.Response(200, json={"data": []})
        body = json.loads(request.content)
        assert body["model"] == profile.model
        assert request.extensions["timeout"]["read"] == profile.timeout_seconds
        if body.get("stream"):
            return httpx.Response(503, json={"error": "stream unavailable"})
        completions.append(body)
        answer = {} if len(completions) == 1 else content()
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer)}, "finish_reason": "stop"}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await llm_insights.run_insight("system", "facts", profile=profile, on_token=lambda _: None)
    assert result["engine"] == "llm" and len(requests) == 4
    assert result["model_profile"] == profile.public_identity()
    assert "example" not in json.dumps(result) and "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["health", "stream", "repair"])
async def test_deep_deadline_cancels_health_stream_and_repair(monkeypatch, stage):
    profile = resolve_llm_profile(configured(llm_deep_timeout_seconds=0.01), "portfolio_risk")
    cleaned = []

    async def block():
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(stage)

    class Client:
        async def health(self):
            return await block() if stage == "health" else True

        async def chat_stream(self, *args, **kwargs):
            if stage == "stream":
                await block()
            yield "{}"  # Invalid structure forces same-profile completion/repair.

        async def chat(self, *args, **kwargs):
            return await block()

    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: Client())
    result = await llm_insights.run_insight("system", "facts", profile=profile, on_token=lambda _: None)
    assert result["failure"]["code"] == "timeout"
    assert result["model_profile"] == profile.public_identity() and cleaned == [stage]


@pytest.mark.asyncio
async def test_disabled_deep_never_constructs_client(monkeypatch):
    profile = resolve_llm_profile(configured(llm_enabled=False), "portfolio_risk")
    monkeypatch.setattr(llm_insights, "get_llm_client", lambda **kwargs: pytest.fail("disabled"))
    result = await llm_insights.run_insight("system", "facts", profile=profile)
    assert result["failure"]["code"] == "disabled"


@pytest.mark.asyncio
async def test_deep_health_failure_is_explicit_and_never_tries_fast(monkeypatch):
    profile = resolve_llm_profile(configured(), "portfolio_risk")
    calls = []
    def handle(request):
        calls.append(request)
        assert request.url.host == "deep.example" and "authorization" not in request.headers
        return httpx.Response(503, json={"error": "unavailable"})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await llm_insights.run_insight("system", "facts", profile=profile)
    assert result["failure"]["code"] == "provider_unavailable"
    assert result["model_profile"]["resolved_profile"] == "deep" and len(calls) == 1


@pytest.mark.asyncio
async def test_total_operation_deadline_cancels_preparation(monkeypatch):
    profile = resolve_llm_profile(configured(llm_deep_timeout_seconds=0.01), "stock_briefing")
    monkeypatch.setattr(routes, "INSIGHT_PREPARATION_SECONDS", 0.001)
    cleaned = []
    async def preparation():
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(True)
    result = await routes._bounded_insight(preparation, profile)
    assert cleaned == [True] and result["failure"]["code"] == "timeout"
    assert result["model_profile"] == profile.public_identity()


@pytest.mark.parametrize("field,value", [
    ("model", "changed"), ("base_url", "https://other.example/v1"), ("api_key", "rotated-secret"),
    ("timeout_seconds", 900), ("structured_output", "none"), ("enabled", False),
])
def test_profile_cache_namespace_changes_with_configuration_without_exposing_it(field, value):
    profile = resolve_llm_profile(configured(), "interrogate")
    digest = profile.cache_fingerprint()
    assert digest != replace(profile, **{field: value}).cache_fingerprint()
    assert len(digest) == 64 and digest == profile.cache_fingerprint()
    assert "example" not in digest and "test-secret" not in digest


class Cache:
    def __init__(self):
        self.rows, self.keys = {}, []

    def build_key(self, family, symbol, params):
        key = json.dumps([family, symbol, params], sort_keys=True)
        self.keys.append(key)
        return key

    async def get(self, key):
        return self.rows.get(key)

    async def set(self, key, value, **kwargs):
        self.rows[key] = value


@pytest.fixture
def research(monkeypatch):
    cache, calls = Cache(), []

    async def snapshot(*args, **kwargs):
        return {"company_name": "Company", "current_price": 100}

    async def empty(*args, **kwargs):
        return []

    async def run(system, facts, *, profile, **kwargs):
        calls.append((profile, facts))
        return {**content(), "engine": "llm", "model": profile.model, "model_profile": profile.public_identity()}

    monkeypatch.setattr(routes, "cache_instance", cache)
    monkeypatch.setattr(routes, "fetch_stock_snapshot_coalesced", snapshot)
    monkeypatch.setattr(routes, "_fetch_news_fallback", empty)
    monkeypatch.setattr(routes, "run_insight", run)
    monkeypatch.setattr(routes.brain_service, "related_notes", empty)
    return cache, calls


@pytest.mark.asyncio
async def test_briefing_cache_switches_profile_and_refresh_bypasses_it(monkeypatch, research):
    cache, calls = research
    selected = settings()
    monkeypatch.setattr(routes, "get_settings", lambda: selected)
    first = await routes.stock_briefing("AAPL", None, False)
    selected = configured()
    second = await routes.stock_briefing("AAPL", None, False)
    cached = await routes.stock_briefing("AAPL", None, False)
    await routes.stock_briefing("AAPL", None, True)
    assert [first["model"], second["model"], cached["model"]] == ["fast-model", "deep-model", "deep-model"]
    assert len(calls) == 3 and len(cache.rows) == 2
    assert all("example" not in key and "test-secret" not in key for key in cache.keys)


@pytest.mark.asyncio
async def test_interrogate_cache_keeps_owner_note_versions_and_profile_scoped(monkeypatch, research):
    cache, calls = research
    selected, revision = configured(), "notes-v1"
    monkeypatch.setattr(routes, "get_settings", lambda: selected)
    monkeypatch.setattr(routes, "_note_cache_version", lambda db, owner: revision)

    class DB:
        def __init__(self, owner): self.owner = owner
        def query(self, *args): return self
        def filter(self, *args): return self
        def order_by(self, *args): return self
        def limit(self, *args): return self
        def all(self): return [SimpleNamespace(title="Thesis", body=f"private-{self.owner}")]

    async def ask(owner):
        return await routes.interrogate_stock("AAPL", None, False, DB(owner), SimpleNamespace(id=owner))

    await ask("alice"); await ask("alice"); await ask("bob")
    revision = "notes-v2"
    await ask("alice")
    selected = settings()
    await ask("alice")
    assert len(calls) == 4 and len(cache.rows) == 4
    assert all("private-bob" not in facts for _, facts in [calls[0], calls[2], calls[3]])
    assert "private-bob" in calls[1][1] and "private-alice" not in calls[1][1]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,scope,task", [
    ("risk", "portfolio", "portfolio_risk"), ("backtest", "strategy", "backtest_explanation"),
    ("collection", "global markets", "market_outlook"), ("collection", "watchlist", "collection_briefing"),
    ("briefing", "", "stock_briefing"), ("interrogate", "", "interrogate"),
])
async def test_stream_resolves_once_for_task_budget_and_final_identity(monkeypatch, kind, scope, task):
    selected = resolve_llm_profile(configured(), task)
    resolutions, received = [], []

    def resolve(config, requested):
        resolutions.append(requested)
        return selected

    async def operation(*args, profile, **kwargs):
        received.append(profile)
        return {**content(), "engine": "llm", "model": profile.model, "model_profile": profile.public_identity()}

    monkeypatch.setattr(routes, "resolve_llm_profile", resolve)
    for name in ["_stock_briefing", "_interrogate_stock", "_backtest_explain", "_collection_briefing", "_risk_insights"]:
        monkeypatch.setattr(routes, name, operation)
    payload = {"ticker": "AAPL"} if kind in {"briefing", "interrogate"} else {"scope": scope}
    response = await routes.insight_stream(routes.InsightStreamRequest(kind=kind, payload=payload), None, SimpleNamespace(id="owner"))
    events = [json.loads(chunk) async for chunk in response.body_iterator]
    assert resolutions == [task] and received == [selected]
    assert events[0]["deadlines"] == {"operation_seconds": 660}
    assert events[0]["model_profile"] == events[-1]["result"]["model_profile"] == selected.public_identity()


@pytest.mark.asyncio
async def test_closing_stream_cancels_inflight_provider_work(monkeypatch):
    started, cleaned = asyncio.Event(), []

    async def block(*args, **kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(True)

    monkeypatch.setattr(routes, "_risk_insights", block)
    response = await routes.insight_stream(routes.InsightStreamRequest(kind="risk"))
    iterator = response.body_iterator
    assert json.loads(await anext(iterator))["type"] == "start"
    assert json.loads(await anext(iterator))["type"] == "progress"
    await asyncio.wait_for(started.wait(), 1)
    await iterator.aclose()
    assert cleaned == [True]


@pytest.mark.parametrize("payload", [{}, {"ticker": "bad symbol"}, {"ticker": "AAPL", "refresh": "invalid"}, {"ticker": "AAPL", "owner": "other"}])
def test_research_stream_target_is_validated_before_headers(payload):
    with pytest.raises(ValidationError):
        routes.InsightStreamRequest(kind="interrogate", payload=payload)


def test_research_stream_requires_authentication_and_uses_dependency_owner(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.dependency_overrides[routes.get_db] = lambda: None
    with TestClient(app) as client:
        denied = client.post("/api/ai/insights/stream", json={"kind": "interrogate", "payload": {"ticker": "AAPL"}})
    assert denied.status_code in {401, 403}
    seen = []
    async def operation(ticker, market, refresh, db, owner, *, profile, **kwargs):
        seen.append(owner.id)
        return {**content(), "engine": "llm", "model": profile.model, "model_profile": profile.public_identity()}
    monkeypatch.setattr(routes, "_interrogate_stock", operation)
    app.dependency_overrides[routes.get_current_user] = lambda: SimpleNamespace(id="authenticated-owner")
    with TestClient(app) as client:
        response = client.post("/api/ai/insights/stream", json={"kind": "interrogate", "payload": {"ticker": "AAPL"}})
        invalid = client.post("/api/ai/insights/stream", json={"kind": "interrogate", "payload": {"ticker": "AAPL", "owner": "other"}})
    assert response.status_code == 200 and invalid.status_code == 422
    assert seen == ["authenticated-owner"]
