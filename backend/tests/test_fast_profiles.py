"""Fast generation never inherits Deep transport, identity or cache state."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from starlette.requests import Request

from backend.api.routes import ai, emotion, ai_insights
from backend.services import ai_service, llm_client, llm_sentiment, stock_emotion
from backend.tests.test_llm_profiles import settings


ARTICLES = [{"id": "article-1", "title": "Company profit improves", "summary": "Supplied headline."}]
MODULES = {"sentiment": llm_sentiment, "emotion": stock_emotion, "query": ai_service}


def configured(**overrides):
    return settings(**{"llm_deep_model": "deep-model", "llm_deep_base_url": "https://deep.example/v1",
                       "llm_deep_api_key": "deep-test-secret", "llm_deep_timeout_seconds": 600, **overrides})


class Cache:
    def __init__(self): self.rows = {}
    def build_key(self, family, key, params=None): return json.dumps([family, key, params], sort_keys=True)
    async def get(self, key): return self.rows.get(key)
    async def set(self, key, value, **kwargs): self.rows[key] = value


@pytest.fixture
def memory(monkeypatch):
    cache = Cache()
    monkeypatch.setattr(llm_sentiment, "cache_instance", cache)
    monkeypatch.setattr(emotion, "cache_instance", cache)
    return cache


async def run(task):
    if task == "sentiment": return await llm_sentiment.score_articles(ARTICLES)
    if task == "emotion": return await stock_emotion.analyze_stock_emotion("AAPL", ARTICLES)
    return await ai_service.AIQueryService().query("alice", "show AAPL", {})


def answer(task):
    if task == "sentiment":
        return {"articles": [{"index": 0, "label": "Bullish", "score": 0.5, "rationale": "Supplied profits improved."}]}
    if task == "emotion":
        return {"analyses": [{"sentiment_score": 0.5, "sentiment_label": "Bullish", "confidence": 0.8,
                              "emotion": "optimism", "emotion_intensity": 0.7, "rationale": "Supplied profit growth."}]}
    return {"intent": "chart_command", "params": {"ticker": "AAPL"}, "explanation": "Open the requested chart."}


@pytest.mark.asyncio
@pytest.mark.parametrize("task", MODULES)
async def test_health_generation_and_public_identity_stay_on_fast_with_deep_configured(monkeypatch, memory, task):
    monkeypatch.setattr(MODULES[task], "get_settings", configured)
    requests = []
    def handle(request):
        requests.append(request)
        assert request.url.host == "fast.example"
        assert request.headers["authorization"] == "Bearer fast-test-secret"
        if request.method == "GET": return httpx.Response(200, json={"data": []})
        body = json.loads(request.content)
        assert body["model"] == "fast-model" and request.extensions["timeout"]["read"] == 30
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer(task))}, "finish_reason": "stop"}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await run(task)
    assert len(requests) == 2 and result["model"] == "fast-model"
    assert result["model_profile"] == {"requested_profile": "fast", "resolved_profile": "fast", "model": "fast-model"}
    assert "example" not in json.dumps(result) and "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("task", MODULES)
async def test_fast_provider_failure_does_not_escalate_to_deep(monkeypatch, memory, task):
    monkeypatch.setattr(MODULES[task], "get_settings", configured)
    calls = []
    def handle(request):
        calls.append(request)
        assert request.url.host == "fast.example"
        return httpx.Response(503, json={"error": "unavailable"})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = await run(task)
    assert len(calls) == 1 and result["model_profile"]["resolved_profile"] == "fast"
    assert result.get("engine", "") != "llm"
    if task == "query":
        assert result["error"] == "classification_unavailable" and "example" not in result["data"]


@pytest.mark.asyncio
@pytest.mark.parametrize("task", MODULES)
@pytest.mark.parametrize("stage", ["health", "chat"])
async def test_fast_deadline_covers_health_and_generation_and_joins_cancellation(monkeypatch, memory, task, stage):
    monkeypatch.setattr(MODULES[task], "get_settings", lambda: configured(llm_timeout_seconds=0.01))
    cleaned = []
    async def block():
        try: await asyncio.Event().wait()
        finally: cleaned.append(True)
    class Client:
        async def health(self): return await block() if stage == "health" else True
        async def chat(self, *args, **kwargs): return await block()
    monkeypatch.setattr(MODULES[task], "get_llm_client", lambda **kwargs: Client())
    result = await run(task)
    assert cleaned == [True] and result["model_profile"]["requested_profile"] == "fast"
    assert result.get("engine", "") != "llm"
    if task == "query": assert result["error"] == "timeout"


@pytest.mark.asyncio
@pytest.mark.parametrize("task", MODULES)
async def test_global_disable_skips_fast_client(monkeypatch, memory, task):
    monkeypatch.setattr(MODULES[task], "get_settings", lambda: configured(llm_enabled=False))
    monkeypatch.setattr(MODULES[task], "get_llm_client", lambda **kwargs: pytest.fail("Disabled"))
    result = await run(task)
    assert result["model_profile"]["model"] == "fast-model" and result.get("engine", "") != "llm"


@pytest.mark.asyncio
async def test_article_cache_tracks_fast_configuration_but_not_deep_changes(monkeypatch, memory):
    selected, calls = configured(), []
    monkeypatch.setattr(llm_sentiment, "get_settings", lambda: selected)
    async def score(articles, *, profile):
        calls.append(profile)
        return {articles[0]["id"]: {"engine": "llm", "label": "Bullish", "score": 0.5, "confidence": 0.8, "rationale": "Observed"}}
    monkeypatch.setattr(llm_sentiment, "_score_batch_llm", score)
    await llm_sentiment.score_articles(ARTICLES)
    selected = configured(llm_deep_model="different-deep")
    await llm_sentiment.score_articles(ARTICLES)
    selected = configured(llm_model="different-fast")
    result = await llm_sentiment.score_articles(ARTICLES)
    assert [profile.model for profile in calls] == ["fast-model", "different-fast"]
    assert result["model"] == "different-fast" and len(memory.rows) == 2
    assert all("example" not in key and "test-secret" not in key for key in memory.rows)


@pytest.mark.asyncio
async def test_emotion_cache_tracks_the_same_profile_used_for_generation(monkeypatch, memory):
    selected, calls = configured(), []
    monkeypatch.setattr(emotion, "get_settings", lambda: selected)
    monkeypatch.setattr(emotion, "_load_db_articles", lambda *args: ARTICLES)
    async def analyze(symbol, articles, *, profile, **kwargs):
        calls.append(profile)
        return {"ticker": symbol, "engine": "llm", "model": profile.model, "model_profile": profile.public_identity()}
    monkeypatch.setattr(emotion, "analyze_stock_emotion", analyze)
    await emotion.get_stock_emotion("AAPL", 7, None, 6)
    selected = configured(llm_deep_model="different-deep")
    await emotion.get_stock_emotion("AAPL", 7, None, 6)
    selected = configured(llm_model="different-fast")
    result = await emotion.get_stock_emotion("AAPL", 7, None, 6)
    assert [profile.model for profile in calls] == ["fast-model", "different-fast"]
    assert result["model_profile"] == calls[-1].public_identity()


@pytest.mark.asyncio
async def test_query_routes_use_authenticated_owner_for_shared_rate_limit(monkeypatch):
    seen = []
    class Service:
        async def query(self, owner, query, context, **kwargs):
            seen.append(owner)
            return {"type": "text_answer", "data": "ok", "explanation": "ok"}
    monkeypatch.setattr(ai, "get_settings", configured)
    user = SimpleNamespace(id="authenticated-owner")
    await ai.ai_query(Request({"type": "http", "headers": []}), {"query": "hello"}, Service(), user)
    response = await ai.ai_query_stream(ai.AIQueryPayload(query="hello"), Service(), user)
    events = [json.loads(chunk) async for chunk in response.body_iterator]
    assert seen == [user.id, user.id]
    assert events[0]["model_profile"]["requested_profile"] == "fast" and events[0]["deadlines"]["operation_seconds"] == 90


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["sentiment", "emotion"])
async def test_stream_profiles_are_snapshotted_before_operation_and_cancelled_on_close(monkeypatch, route):
    module, name = (ai_insights, "score_articles") if route == "sentiment" else (emotion, "_stock_emotion")
    monkeypatch.setattr(module, "get_settings", configured)
    started, cleaned = asyncio.Event(), []
    async def block(*args, **kwargs):
        profile = kwargs.get("profile") or args[-1]
        assert profile.model == "fast-model" and profile.requested_profile == "fast"
        started.set()
        try: await asyncio.Event().wait()
        finally: cleaned.append(True)
    monkeypatch.setattr(module, name, block)
    response = await ai_insights.news_sentiment_stream({"items": ARTICLES}) if route == "sentiment" else await emotion.stream_stock_emotion(emotion.EmotionRequest(ticker="AAPL"))
    iterator = response.body_iterator
    first = json.loads(await anext(iterator))
    assert first["model_profile"]["model"] == "fast-model" and first["deadlines"]["operation_seconds"] == 90
    await anext(iterator); await asyncio.wait_for(started.wait(), 1)
    await iterator.aclose()
    assert cleaned == [True]
