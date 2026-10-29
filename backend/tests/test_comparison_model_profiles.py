"""Comparison operations keep one profile across transport, repair and UI budgets."""
import asyncio
import json

import httpx
import pytest

from backend.api.routes import market_briefing as routes
from backend.services import comparison_briefing as price
from backend.services import comparison_context_briefing as context
from backend.services import llm_client
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_comparison_briefing import _packet, _valid
from backend.tests.test_comparison_context_briefing import packet, valid
from backend.tests.test_llm_profiles import settings
from backend.tests.test_market_briefing_evidence import _client, _Fetcher


def configured(**overrides):
    return settings(**{
        "llm_deep_model": "deep-model", "llm_deep_base_url": "https://deep.example/v1",
        "llm_deep_timeout_seconds": 600, "llm_deep_structured_output": "json",
        **overrides,
    })


def transport(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs,
    ))


@pytest.mark.asyncio
@pytest.mark.parametrize("with_context", [False, True])
async def test_deep_health_generation_and_bounded_repair_share_transport_and_identity(monkeypatch, with_context):
    evidence = packet() if with_context else _packet()
    response = valid(evidence) if with_context else _valid(evidence)
    service = context if with_context else price
    generate = context.generate_context_briefing if with_context else price.generate_comparison_briefing
    monkeypatch.setattr(service, "get_settings", configured)
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.host == "deep.example"
        assert "authorization" not in request.headers  # Fast's key must never leak.
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        body = json.loads(request.content)
        assert body["model"] == "deep-model"
        assert request.extensions["timeout"]["read"] == 600
        content = "{}" if len(calls) == 2 else json.dumps(response)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

    transport(monkeypatch, handle)
    result = await generate(evidence)
    assert result.status == "complete"
    assert len(calls) == 3  # One health check, initial generation, one repair.
    assert result.model == "deep-model"
    assert result.model_profile.model_dump() == {
        "requested_profile": "deep", "resolved_profile": "deep", "model": "deep-model",
    }
    assert "deep.example" not in result.model_dump_json()
    assert "fast-test-secret" not in result.model_dump_json()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["health", "generation"])
async def test_configured_deep_failure_never_tries_fast(monkeypatch, failure):
    monkeypatch.setattr(price, "get_settings", configured)
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.host == "deep.example"
        if failure == "generation" and request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        return httpx.Response(503, json={"error": "unavailable"})

    transport(monkeypatch, handle)
    result = await price.generate_comparison_briefing(_packet())
    assert result.status == "unavailable"
    assert result.failure.code == ("provider_unavailable" if failure == "health" else "provider_error")
    assert len(calls) == (1 if failure == "health" else 2)
    assert result.model_profile.resolved_profile == "deep"


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["health", "generation"])
async def test_deep_deadline_bounds_health_and_generation_and_joins_cancellation(monkeypatch, stage):
    profile = resolve_llm_profile(configured(llm_deep_timeout_seconds=0.01), "comparison_briefing")
    cleaned = []

    async def block():
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(stage)

    class Client:
        async def health(self):
            return await block() if stage == "health" else True

        async def chat(self, *args, **kwargs):
            return await block()

    monkeypatch.setattr(price, "get_llm_client", lambda **kwargs: Client())
    result = await price.generate_comparison_briefing(_packet(), profile=profile)
    assert result.failure.code == "timeout"
    assert result.model_profile.resolved_profile == "deep"
    assert cleaned == [stage]


@pytest.mark.parametrize("with_context", [False, True])
@pytest.mark.parametrize("deep", [False, True])
def test_stream_announces_the_same_snapshot_used_after_collection(monkeypatch, with_context, deep):
    selected = configured() if deep else settings()
    evidence = packet() if with_context else _packet()
    response = valid(evidence) if with_context else _valid(evidence)
    resolutions = []

    def read_settings():
        resolutions.append(True)
        # Detect an unintended second resolution after evidence was prepared.
        return selected if len(resolutions) == 1 else configured(llm_deep_model="changed-model")

    async def prepare(*args):
        return evidence.price if with_context else evidence

    async def collect(*args, **kwargs):
        return evidence

    monkeypatch.setattr(routes, "get_settings", read_settings)
    monkeypatch.setattr(routes, "prepare_comparison_briefing_evidence", prepare)
    monkeypatch.setattr(routes, "collect_context_evidence", collect)

    def handle(request):
        assert request.url.host == ("deep.example" if deep else "fast.example")
        assert request.headers.get("authorization") == (None if deep else "Bearer fast-test-secret")
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        assert json.loads(request.content)["model"] == (selected.llm_deep_model if deep else selected.llm_model)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(response)}, "finish_reason": "stop"}]})

    transport(monkeypatch, handle)
    request = {"anchor": "AAPL", "comparisons": ["SPY"]}
    if with_context:
        request["context"] = {"news": True, "macro_regions": ["us", "euro_area"]}
    path = "/api/market-context/briefing" + ("-context" if with_context else "") + "/stream"
    with _client(_Fetcher()) as client:
        result = client.post(path, json=request)
    assert result.status_code == 200, result.text
    events = [json.loads(line) for line in result.text.splitlines()]
    assert events[0]["deadlines"]["model_seconds"] == (600 if deep else 30)
    final = events[-1]["result"]
    assert final["status"] == "complete"
    assert final["model_profile"]["resolved_profile"] == ("deep" if deep else "fast")
    assert final["model"] == ("deep-model" if deep else "fast-model")
    assert len(resolutions) == 1
    assert "deep.example" not in result.text and "fast-test-secret" not in result.text


def test_factory_keeps_snapshot_despite_changed_defaults(monkeypatch):
    profile = resolve_llm_profile(configured(), "comparison_briefing")
    monkeypatch.setattr(llm_client, "get_settings", lambda: settings(llm_model="changed-model"))
    client = llm_client.get_llm_client(profile=profile)
    assert client.model == profile.model and client.timeout == profile.timeout_seconds
    assert client.resolved_profile is profile
    assert client._headers() == {}
    with pytest.raises(ValueError, match="not both"):
        llm_client.get_llm_client("comparison_briefing", profile=profile)
