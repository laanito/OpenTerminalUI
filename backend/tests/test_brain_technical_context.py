"""Explicit public technical evidence stays separate from private Brain retrieval."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from backend.api.routes.brain import AskRequest
from backend.services.brain import brain_service as brain
from backend.services.brain import technical_context as technical
from backend.services.llm_client import LLMError
from backend.services.llm_profiles import resolve_llm_profile
from backend.tests.test_research_technical_context import evidence, NOW
from backend.tests.test_shared_insight_profiles import configured


def context(kinds=("complete", "complete")):
    symbols = ["AAPL", "BTC-USD"][:len(kinds)]
    groups = [technical._group(evidence(kind, symbol), index) for index, (symbol, kind) in enumerate(zip(symbols, kinds), 1)]
    available = sum(m.status == "available" for group in groups for m in group.metrics)
    return technical.BrainTechnicalContext(requested_symbols=symbols,
        status="available" if available == len(groups) * 3 else "partial" if available else "unavailable", groups=groups)


@pytest.mark.parametrize("symbols", [["AAPL"] * 2, ["AAPL", "BTC-USD", "SPY", "QQQ"], ["bad/symbol"], [12]])
def test_request_scope_rejects_invalid_duplicate_or_excessive_symbols(symbols):
    with pytest.raises((ValidationError, ValueError)):
        AskRequest(question="What changed?", technical_symbols=symbols)


def test_request_scope_is_optional_normalized_and_separate_from_private_sources():
    assert AskRequest(question="What changed?").technical_symbols == []
    request = AskRequest(question="AI is a theme, not an inferred ticker", sources=["note"], technical_symbols=[" aapl ", "btc-usd"])
    assert request.technical_symbols == ["AAPL", "BTC-USD"] and request.sources == ["note"]


def test_group_references_are_unique_exact_and_bound_to_request_order():
    value = context()
    assert [m.citation_id for m in value.groups[1].metrics] == ["T2.1", "T2.2", "T2.3"]
    assert value.groups[0].snapshot_id == evidence().snapshot_id
    assert value.groups[0].metrics[0].observation_id == evidence().metrics[0].observation_id
    payload = value.model_dump()
    payload["groups"].reverse()
    with pytest.raises(ValidationError): technical.BrainTechnicalContext.model_validate(payload)


@pytest.mark.parametrize("answer", ["Only technical [T1.1] [T2.1]", "Missing second asset [1] [T1.1]",
                                    "Unknown [1] [T1.1] [T2.9]", "Unknown private [9] [T1.1] [T2.1]"])
def test_references_require_both_owned_private_evidence_and_selected_available_assets(answer):
    with pytest.raises(technical.InvalidBrainTechnicalReferences):
        technical.validate_brain_technical_references(answer, context(), [{"n": 1}])


def test_partial_unavailable_and_zero_values_have_honest_reference_rules():
    value = context(("zero", "partial"))
    technical.validate_brain_technical_references("The note [1] can be compared conditionally with [T1.1] and [T2.1].", value, [{"n": 1}])
    with pytest.raises(technical.InvalidBrainTechnicalReferences):
        technical.validate_brain_technical_references("Missing volatility [1] [T1.1] [T2.3]", value, [{"n": 1}])
    unavailable = context(("unavailable", "unavailable"))
    technical.validate_brain_technical_references("Only the private note is usable [1].", unavailable, [{"n": 1}])
    assert all(metric.value == 0 for metric in value.groups[0].metrics)


@pytest.mark.asyncio
async def test_collection_is_bounded_deduplicated_by_validation_and_cancellation_safe(monkeypatch):
    entered, closed = [], []
    async def load(symbol, factory):
        try:
            entered.append(symbol)
            await asyncio.sleep(60)
        finally: closed.append(symbol)
    monkeypatch.setattr(technical, "collect_research_technical_evidence", load)
    task = asyncio.create_task(technical.collect_brain_technical_context(["AAPL", "BTC-USD", "SPY"], lambda: None))
    for _ in range(20):
        if len(entered) == 3: break
        await asyncio.sleep(0)
    assert len(entered) == 3
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert set(closed) == set(entered)


@pytest.mark.asyncio
async def test_collection_preserves_partial_assets_and_performs_no_unrequested_fetch(monkeypatch):
    calls = []
    async def load(symbol, factory):
        calls.append(symbol)
        return evidence("partial" if symbol == "BTC-USD" else "complete", symbol)
    monkeypatch.setattr(technical, "collect_research_technical_evidence", load)
    assert await technical.collect_brain_technical_context([], lambda: None) is None
    assert not calls
    result = await technical.collect_brain_technical_context(["AAPL", "BTC-USD"], lambda: None)
    assert result.status == "partial" and calls == ["AAPL", "BTC-USD"]


def test_prompt_distinguishes_current_snapshots_from_dated_private_claims():
    messages = technical.technical_messages([{"role": "user", "content": "Private note [1] effective last month."}], context())
    assert "effective last month" in messages[0]["content"]
    assert "past-dated claim" in messages[1]["content"] and "recorded date" in messages[1]["content"]
    assert "RSI/MACD" in messages[1]["content"] and "different calendar periods" in messages[1]["content"]
    assert '"citation_id":"T2.1"' in messages[2]["content"]


def prepared(value=None):
    return brain._SynthesisRequest(sources=["note"], citations=[{"n": 1, "source": "note"}],
        messages=[{"role": "system", "content": "Original private evidence"}], technical_context=value or context())


@pytest.mark.asyncio
async def test_stream_repairs_missing_references_on_same_profile_and_preserves_snapshots(monkeypatch):
    profile = resolve_llm_profile(configured(), "brain_answer")
    calls, events = [], []
    class Client:
        async def chat_stream(self, messages, **kwargs):
            calls.append("stream"); yield "An incomplete interpretation [1] [T1.1]."
        async def chat(self, messages, **kwargs):
            calls.append("completion")
            assert "each selected asset" in messages[-1]["content"]
            return "The dated claim [1] is compared with current observations [T1.1] [T2.1]."
    def client(**kwargs):
        assert kwargs["profile"] is profile
        return Client()
    monkeypatch.setattr(brain, "get_llm_client", client)
    await brain._stream_synthesis(prepared(), profile, brain._generation_metadata(profile), events.append)
    final = events[-1]["result"]
    assert calls == ["stream", "completion"] and final["llm"] is True
    assert final["technical_context"] == context().model_dump(mode="json")
    assert final["answer"].endswith("[T1.1] [T2.1].")


@pytest.mark.asyncio
async def test_failed_reference_repair_replaces_provisional_text_with_honest_sources(monkeypatch):
    profile = resolve_llm_profile(configured(), "brain_answer")
    class Client:
        async def chat_stream(self, messages, **kwargs): yield "Bad [T9.9]"
        async def chat(self, messages, **kwargs): return "Still bad [T9.9]"
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: Client())
    events = []
    await brain._stream_synthesis(prepared(), profile, brain._generation_metadata(profile), events.append)
    result = events[-1]["result"]
    assert result["error"] == "invalid_response" and "T9.9" not in result["answer"]
    assert result["technical_context"]["groups"] and result["citations"] == [{"n": 1, "source": "note"}]


@pytest.mark.asyncio
async def test_opt_in_scope_survives_retrieval_only_results_without_fetching_history(monkeypatch):
    profile = resolve_llm_profile(configured(llm_enabled=False), "brain_answer")
    monkeypatch.setattr(brain, "resolve_llm_profile", lambda *args: profile)
    async def prepare(*args, **kwargs): return {"answer": "Private excerpts", "citations": [], "sources": ["note"], "llm": False}, None
    monkeypatch.setattr(brain, "_prepare_ask", prepare)
    events = [event async for event in brain.ask_stream(None, "owner", "Why?", sources=["note"], technical_symbols=["AAPL"])]
    assert events[0]["technical_symbols"] == ["AAPL"]
    result = events[-1]["result"]["technical_context"]
    assert result["status"] == "skipped" and result["reason"] == "model_disabled" and result["groups"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("selected,matched,enabled", [([], True, True), (["AAPL"], False, True), (["AAPL"], True, False), (["AAPL"], True, True)])
async def test_real_preparation_keeps_private_owner_scope_and_dates_and_only_collects_opt_in(monkeypatch, selected, matched, enabled):
    from backend.tests.test_brain import _chunk
    from backend.services.brain.vector_store import VectorMatch
    calls = []
    class Embedder:
        dim = 2
        async def embed_query(self, question):
            assert question == "AI is a theme, not a ticker"
            return [1., 0.]
    class Store:
        def count(self, db, owner):
            assert owner == "private-owner"
            return 1
        def search(self, db, owner, vector, **kwargs):
            assert owner == "private-owner" and vector == [1., 0.]
            assert kwargs["sources"] == ["note"]
            return [VectorMatch(chunk=_chunk([1., 0.], source="note", meta_json={
                "effective_at": "2026-08-01T00:00:00Z", "recorded_at": "2026-09-01T00:00:00Z"}), score=.9)] if matched else []
    monkeypatch.setattr(brain, "get_embedding_service", Embedder)
    monkeypatch.setattr(brain, "make_vector_store", lambda *args: Store())
    async def collect(symbols, factory):
        calls.extend(symbols)
        return context(("complete",)) if symbols else None
    monkeypatch.setattr(brain, "collect_brain_technical_context", collect)
    immediate, request = await brain._prepare_ask(None, "private-owner", "AI is a theme, not a ticker", sources=["note"],
        profile=resolve_llm_profile(configured(llm_enabled=enabled), "brain_answer"), technical_symbols=selected)
    assert calls == (selected if enabled else [])
    if enabled and (matched or selected):
        assert immediate is None and request.sources == ["note"]
        if matched:
            assert "EFFECTIVE 2026-08-01" in request.messages[1]["content"]
            assert "RECORDED 2026-09-01" in request.messages[1]["content"]
        else:
            assert not request.citations
            assert "No private sources were retrieved" in request.messages[-2]["content"]
        assert bool(request.technical_context) == bool(selected)
    else:
        assert request is None and immediate["sources"] == ["note"]


@pytest.mark.asyncio
@pytest.mark.parametrize("valid_repair", [True, False])
async def test_nonstream_answer_has_one_reference_repair_and_keeps_original_capture(monkeypatch, valid_repair):
    profile = resolve_llm_profile(configured(), "brain_answer")
    monkeypatch.setattr(brain, "resolve_llm_profile", lambda *args: profile)
    async def prepare(*args, **kwargs): return None, prepared()
    monkeypatch.setattr(brain, "_prepare_ask", prepare)
    calls = []
    class Client:
        async def chat(self, messages, **kwargs):
            calls.append(messages)
            return "The claim [1] and observations [T1.1] [T2.1]." if valid_repair and len(calls) == 2 else "Bad reference [T9.9]"
    def client(**kwargs):
        assert kwargs["profile"] is profile
        return Client()
    monkeypatch.setattr(brain, "get_llm_client", client)
    result = await brain.ask(None, "owner", "why", sources=["note"], technical_symbols=["AAPL", "BTC-USD"])
    assert len(calls) == 2 and result["technical_context"] == context().model_dump(mode="json")
    assert result.get("llm") is True if valid_repair else result["error"] == "invalid_response"
    assert "T9.9" not in result["answer"]


def test_request_explicit_null_scope_does_not_bypass_list_contract():
    with pytest.raises(ValidationError): AskRequest(question="why", technical_symbols=None)


def test_browser_fixtures_match_server_projection_and_response_contract():
    from pathlib import Path
    from backend.api.routes.brain import AskResponse
    values = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/__tests__/fixtures/brainTechnicalContext.json").read_text())
    for key, kinds in (("complete", ("complete", "complete")), ("partial", ("zero", "partial")), ("unavailable", ("unavailable", "unavailable"))):
        parsed = AskResponse.model_validate(values[key])
        assert parsed.technical_context == context(kinds)
        technical.validate_brain_technical_references(parsed.answer, parsed.technical_context, [citation.model_dump() for citation in parsed.citations])
    skipped = AskResponse.model_validate(values["skipped"])
    assert skipped.technical_context == technical.skipped_technical_context(["AAPL", "BTC-USD"], "model_disabled")


@pytest.mark.asyncio
@pytest.mark.parametrize("private_state", ["empty", "no_matches", "embedding_failure"])
@pytest.mark.parametrize("stream", [True, False])
async def test_explicit_technical_scope_can_answer_without_private_matches(monkeypatch, private_state, stream):
    from backend.services.embeddings import EmbeddingError
    class Embedder:
        dim = 2
        async def embed_query(self, question):
            if private_state == "embedding_failure": raise EmbeddingError("offline test")
            return [1., 0.]
    class Store:
        def count(self, db, owner): return 0 if private_state == "empty" else 3
        def search(self, db, owner, vector, **kwargs):
            assert owner == "owner" and kwargs["sources"] == ["note"]
            return []
    async def reindex(*args): return {}
    monkeypatch.setattr(brain, "get_settings", configured)
    monkeypatch.setattr(brain, "get_embedding_service", Embedder)
    monkeypatch.setattr(brain, "make_vector_store", lambda *args: Store())
    monkeypatch.setattr(brain, "reindex_user", reindex)
    calls = []
    async def collect(symbols, factory):
        calls.append(symbols)
        return context()
    monkeypatch.setattr(brain, "collect_brain_technical_context", collect)
    class Client:
        async def chat(self, messages, **kwargs):
            assert "No private sources were retrieved" in messages[-2]["content"]
            assert "cannot establish whether a long-term purchase is attractive" in messages[-2]["content"]
            if private_state == "embedding_failure": assert "does not mean no relevant notes exist" in messages[1]["content"]
            return "No private evidence was retrieved. Short-window behaviour [T1.1] [T2.1] cannot establish a long-term buying case."
        async def chat_stream(self, messages, **kwargs):
            yield await self.chat(messages, **kwargs)
    monkeypatch.setattr(brain, "get_llm_client", lambda **kwargs: Client())
    if stream:
        events = [event async for event in brain.ask_stream(None, "owner", "Is this attractive long term?", sources=["note"], technical_symbols=["AAPL", "BTC-USD"])]
        assert any(event["type"] == "start" and not event["citations"] for event in events)
        result = events[-1]["result"]
    else:
        result = await brain.ask(None, "owner", "Is this attractive long term?", sources=["note"], technical_symbols=["AAPL", "BTC-USD"])
    assert result["llm"] is True and result["citations"] == []
    assert result["technical_context"] == context().model_dump(mode="json")
    assert calls == [["AAPL", "BTC-USD"]]


@pytest.mark.asyncio
async def test_no_usable_evidence_does_not_ask_the_model_for_an_ungrounded_answer(monkeypatch):
    async def collect(*args): return context(("unavailable", "unavailable"))
    monkeypatch.setattr(brain, "collect_brain_technical_context", collect)
    result, request = await brain._prepare_synthesis("Should I buy?", ["note"], [], ["AAPL", "BTC-USD"], None)
    assert request is None and result["llm"] is False and result["error"] == "evidence_unavailable"
    assert result["citations"] == [] and result["technical_context"]["status"] == "unavailable"


def test_no_private_sources_does_not_allow_invented_private_citations():
    technical.validate_brain_technical_references("Limited interpretation [T1.1] [T2.1]", context(), [])
    with pytest.raises(technical.InvalidBrainTechnicalReferences):
        technical.validate_brain_technical_references("An invented private note [1] plus [T1.1] [T2.1]", context(), [])
