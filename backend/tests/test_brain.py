"""Tests for the private second-brain RAG (no network, no DB)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.brain import brain_service
from backend.services.brain.vector_store import VectorMatch, _cosine_topk


def _chunk(vec, **kw):
    return SimpleNamespace(
        vector_json=vec,
        source=kw.get("source", "journal"),
        title=kw.get("title", "Journal · SHORT AAPL"),
        chunk_text=kw.get("chunk_text", "note"),
        symbol=kw.get("symbol"),
        meta_json=kw.get("meta_json", {}),
        ref_id=kw.get("ref_id", "1"),
    )


# ---- numpy cosine ranking -------------------------------------------------

def test_cosine_topk_ranks_by_similarity():
    rows = [
        _chunk([1.0, 0.0], ref_id="a"),
        _chunk([0.0, 1.0], ref_id="b"),
        _chunk([0.9, 0.1], ref_id="c"),
    ]
    out = _cosine_topk([1.0, 0.0], rows, k=2)
    assert [m.chunk.ref_id for m in out] == ["a", "c"]
    assert out[0].score >= out[1].score


def test_cosine_topk_skips_dimension_drift():
    rows = [_chunk([1.0, 0.0, 0.0], ref_id="stale"), _chunk([1.0, 0.0], ref_id="ok")]
    out = _cosine_topk([1.0, 0.0], rows, k=5)
    assert [m.chunk.ref_id for m in out] == ["ok"]


def test_cosine_topk_zero_query_returns_empty():
    assert _cosine_topk([0.0, 0.0], [_chunk([1.0, 0.0])], k=3) == []


# ---- ask flow (stubbed embedder / store / llm) ----------------------------

@pytest.mark.asyncio
async def test_ask_grounds_answer_and_cites(monkeypatch):
    match = VectorMatch(
        chunk=_chunk(
            [1.0, 0.0],
            source="journal",
            title="Journal · SHORT AAPL",
            chunk_text="Lost money, felt anxious and chased the entry.",
            meta_json={"route": "/equity/journal"},
        ),
        score=0.92,
    )

    class FakeStore:
        use_pgvector = False

        def count(self, db, uid):
            return 5

        def search(self, db, uid, qv, *, k=6, sources=None):
            return [match]

    class FakeEmbedder:
        dim = 2

        async def embed_query(self, q):
            return [1.0, 0.0]

    captured = {}

    class FakeClient:
        async def chat(self, messages, **kw):
            captured["context"] = messages[1]["content"]
            return "You tend to lose when anxious and chasing [1]."

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: FakeStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: FakeEmbedder())
    monkeypatch.setattr(brain_service, "get_llm_client", lambda: FakeClient())

    out = await brain_service.ask(None, "user1", "when do I lose money?")

    assert out["llm"] is True
    assert "[1]" in out["answer"]
    # The note text was actually fed to the model as grounding context.
    assert "anxious" in captured["context"]
    assert out["citations"][0]["source"] == "journal"
    assert out["citations"][0]["route"] == "/equity/journal"
    assert out["citations"][0]["n"] == 1


@pytest.mark.asyncio
async def test_ask_empty_brain_is_graceful(monkeypatch):
    class EmptyStore:
        use_pgvector = False

        def count(self, db, uid):
            return 0

        def search(self, *a, **k):
            return []

    async def fake_reindex(db, uid):
        return {}

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: EmptyStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: SimpleNamespace(dim=2))
    monkeypatch.setattr(brain_service, "reindex_user", fake_reindex)

    out = await brain_service.ask(None, "u", "anything?")
    assert out["indexed_chunks"] == 0
    assert "empty" in out["answer"].lower()
    assert out["citations"] == []


@pytest.mark.asyncio
async def test_ask_no_matches(monkeypatch):
    class Store:
        use_pgvector = False

        def count(self, db, uid):
            return 3

        def search(self, *a, **k):
            return []

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: Store())

    class FakeEmbedder:
        dim = 2

        async def embed_query(self, q):
            return [1.0, 0.0]

    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: FakeEmbedder())

    out = await brain_service.ask(None, "u", "obscure question?")
    assert out["citations"] == []
    assert "don't have" in out["answer"].lower()
