"""Brain profile identity, owned deadlines and unchanged private retrieval."""
import asyncio
import json

import httpx
import pytest

from backend.services import llm_client
from backend.services.brain import brain_service as brain
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_llm_profiles import settings
from backend.tests.test_brain import _chunk
from backend.services.brain.vector_store import VectorMatch


def configured(**overrides):
    return settings(**{"llm_deep_model": "deep-model", "llm_deep_base_url": "https://deep.example/v1",
                       "llm_deep_timeout_seconds": 600, **overrides})


def request():
    return brain._SynthesisRequest(sources=["note"], citations=[{"n": 1, "source": "note"}],
                                   messages=[{"role": "user", "content": "Private evidence [1]."}])


def prepare(monkeypatch):
    captured = []
    async def run(db, owner, question, **kwargs):
        captured.append((owner, question, kwargs))
        return None, request()
    monkeypatch.setattr(brain, "_prepare_ask", run)
    return captured


@pytest.mark.asyncio
@pytest.mark.parametrize("deep", [False, True])
@pytest.mark.parametrize("stream", [False, True])
async def test_actual_transport_and_metadata_use_one_profile_with_no_credential_leak(monkeypatch, deep, stream):
    config = configured() if deep else settings()
    monkeypatch.setattr(brain, "get_settings", lambda: config)
    captured = prepare(monkeypatch)
    calls = []
    def handle(req):
        calls.append(req)
        assert req.url.host == ("deep.example" if deep else "fast.example")
        assert req.headers.get("authorization") == (None if deep else "Bearer fast-test-secret")
        body = json.loads(req.content)
        assert body["model"] == ("deep-model" if deep else "fast-model")
        assert req.extensions["timeout"]["read"] == (600 if deep else 30)
        if body.get("stream"):
            return httpx.Response(503, json={"error": "unsupported stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "A complete answer [1]."}, "finish_reason": "stop"}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    if stream:
        events = [event async for event in brain.ask_stream(None, "owner", "Why?", sources=["note"])]
        assert events[0]["deadlines"]["operation_seconds"] == (720 if deep else 150)
        result = events[-1]["result"]
    else:
        result = await brain.ask(None, "owner", "Why?", sources=["note"])
    assert result["answer"] == "A complete answer [1]."
    assert len(calls) == (2 if stream else 1)
    assert result["model_profile"]["resolved_profile"] == ("deep" if deep else "fast")
    assert result["llm_model"] == result["model_profile"]["model"]
    assert result["llm_provider"] == "openai-compatible"
    assert "example" not in json.dumps(result) and "test-secret" not in json.dumps(result)
    assert captured[0][0] == "owner" and captured[0][2]["sources"] == ["note"]


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["preparation", "stream", "fallback"])
async def test_deadlines_work_across_distinct_consumer_tasks_and_discard_partial_text(monkeypatch, stage):
    config = configured(llm_deep_timeout_seconds=0.02)
    monkeypatch.setattr(brain, "get_settings", lambda: config)
    monkeypatch.setattr(brain, "_PREPARATION_SECONDS", 0.01)
    cleaned = []
    async def block():
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.append(stage)
    if stage == "preparation":
        async def prep(*args, **kwargs):
            return await block()
        monkeypatch.setattr(brain, "_prepare_ask", prep)
    else:
        prepare(monkeypatch)
    class Client:
        async def chat_stream(self, *args, **kwargs):
            yield "provisional"
            if stage == "stream":
                await block()
            raise llm_client.LLMError("stream unavailable")
        async def chat(self, *args, **kwargs):
            return await block()
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: Client())
    iterator = brain.ask_stream(None, "owner", "why", sources=["note"])
    events = []
    try:
        while True:
            # Mirrors the heartbeat adapter: each anext runs in a fresh task.
            events.append(await asyncio.wait_for(anext(iterator), 1))
    except StopAsyncIteration:
        pass
    final = events[-1]["result"]
    assert cleaned == [stage]
    assert final["error"] == ("preparation_timeout" if stage == "preparation" else "timeout")
    assert "provisional" not in final["answer"]
    assert final["citations"] == ([] if stage == "preparation" else request().citations)
    assert final["model_profile"]["resolved_profile"] == "deep"


@pytest.mark.asyncio
async def test_non_streaming_deadline_retains_sources(monkeypatch):
    monkeypatch.setattr(brain, "get_settings", lambda: configured(llm_deep_timeout_seconds=0.01))
    prepare(monkeypatch)
    class Client:
        async def chat(self, *args, **kwargs):
            await asyncio.Event().wait()
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: Client())
    result = await brain.ask(None, "owner", "why", sources=["note"])
    assert result["error"] == "timeout" and result["citations"] == request().citations


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_configured_deep_failure_retains_private_sources_without_trying_fast(monkeypatch, stream):
    monkeypatch.setattr(brain, "get_settings", configured)
    prepare(monkeypatch)
    calls = []
    def handle(req):
        calls.append(req)
        assert req.url.host == "deep.example" and "authorization" not in req.headers
        return httpx.Response(503, json={"error": "unavailable"})
    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    if stream:
        events = [event async for event in brain.ask_stream(None, "owner", "why", sources=["note"])]
        result = events[-1]["result"]
    else:
        result = await brain.ask(None, "owner", "why", sources=["note"])
    assert result["error"] == "llm_unavailable" and result["citations"] == request().citations
    assert result["model_profile"]["resolved_profile"] == "deep"
    assert len(calls) == (2 if stream else 1)


@pytest.mark.asyncio
async def test_closing_stream_joins_producer_and_never_falls_back_after_cancellation(monkeypatch):
    monkeypatch.setattr(brain, "get_settings", configured)
    prepare(monkeypatch)
    cleaned = []
    class Client:
        async def chat_stream(self, *args, **kwargs):
            try:
                yield "provisional"
                await asyncio.Event().wait()
            finally:
                cleaned.append(True)
        async def chat(self, *args, **kwargs):
            pytest.fail("Cancellation must not start completion")
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: Client())
    iterator = brain.ask_stream(None, "owner", "why", sources=["note"])
    assert (await anext(iterator))["type"] == "queued"
    assert (await anext(iterator))["type"] == "start"
    assert (await anext(iterator))["type"] == "delta"
    await iterator.aclose()
    assert cleaned == [True]


@pytest.mark.asyncio
async def test_profile_snapshot_survives_configuration_change_during_preparation(monkeypatch):
    first = configured()
    monkeypatch.setattr(brain, "get_settings", lambda: first)
    async def prep(*args, **kwargs):
        monkeypatch.setattr(brain, "get_settings", lambda: settings())
        return None, request()
    monkeypatch.setattr(brain, "_prepare_ask", prep)
    captured = []
    class Client:
        async def chat_stream(self, *args, **kwargs):
            yield "Complete answer [1]."
    def client(*, profile):
        captured.append(profile)
        return Client()
    monkeypatch.setattr(brain, "get_llm_client", client)
    events = [event async for event in brain.ask_stream(None, "owner", "why", sources=["note"])]
    assert captured[0].model == "deep-model"
    assert events[0]["model_profile"] == events[1]["model_profile"] == captured[0].public_identity()


@pytest.mark.asyncio
async def test_disabled_deep_preserves_owner_scoped_embedding_retrieval_without_chat(monkeypatch):
    monkeypatch.setattr(brain, "get_settings", lambda: configured(llm_enabled=False))
    calls = []
    class Embedder:
        dim = 2
        async def embed_query(self, question):
            calls.append(("embedding", question))
            return [1, 0]
    class Store:
        def count(self, db, owner): return 1
        def search(self, db, owner, vector, *, k, sources):
            calls.append(("retrieval", owner, sources))
            return [VectorMatch(chunk=_chunk([1, 0], source="note", chunk_text="Private writing"), score=0.9)]
    monkeypatch.setattr(brain, "get_embedding_service", lambda: Embedder())
    monkeypatch.setattr(brain, "make_vector_store", lambda *args: Store())
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: pytest.fail("Disabled generation"))
    result = await brain.ask(None, "alice", "why", sources=["note"])
    assert result["llm"] is False and result["citations"][0]["source"] == "note"
    assert ("retrieval", "alice", ["note"]) in calls
    assert result["model_profile"]["resolved_profile"] == "deep"
