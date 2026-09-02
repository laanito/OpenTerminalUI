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


# ---- deterministic source chunking ---------------------------------------

def test_split_text_is_bounded_overlapping_and_deterministic():
    from backend.services.brain.indexer import _split_text

    text = " ".join(f"word-{i}" for i in range(80))
    first = _split_text(text, max_chars=120, overlap_chars=24)
    second = _split_text(text, max_chars=120, overlap_chars=24)

    assert first == second
    assert len(first) > 1
    assert all(0 < len(chunk) <= 120 for chunk in first)
    for left, right in zip(first, first[1:]):
        assert set(left.split()[-4:]) & set(right.split()[:4])


def test_build_chunks_keeps_stable_internal_and_original_source_ids():
    from backend.services.brain.indexer import _build_chunks

    text = " ".join(f"evidence-{i}" for i in range(500))
    kwargs = {
        "source": "note",
        "source_ref_id": "note-123",
        "symbol": "AAPL",
        "title": "Long thesis",
        "text": text,
        "meta_json": {"route": "/equity/security/AAPL"},
    }

    first = _build_chunks(**kwargs)
    second = _build_chunks(**kwargs)

    assert len(first) > 1
    assert [chunk["ref_id"] for chunk in first] == [chunk["ref_id"] for chunk in second]
    assert len({chunk["ref_id"] for chunk in first}) == len(first)
    assert all(len(chunk["ref_id"]) == 64 for chunk in first)
    assert [chunk["meta_json"]["chunk_index"] for chunk in first] == list(range(len(first)))
    assert all(chunk["meta_json"]["source_ref_id"] == "note-123" for chunk in first)


def test_vector_store_only_reembeds_changed_chunks_and_prunes_stale_ones():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from backend.models.brain import BrainChunkORM
    from backend.models.user import User
    from backend.services.brain.indexer import _build_chunks
    from backend.services.brain.vector_store import VectorStore

    test_engine = create_engine("sqlite:///:memory:")
    User.__table__.create(test_engine)
    BrainChunkORM.__table__.create(test_engine)
    db = sessionmaker(bind=test_engine)()
    store = VectorStore(use_pgvector=False)

    try:
        long_text = " ".join(f"observation-{i}" for i in range(500))
        chunks = _build_chunks(
            source="note",
            source_ref_id="note-1",
            symbol=None,
            title="Research log",
            text=long_text,
            meta_json={},
        )
        assert store.pending_chunks(db, "user-1", chunks, dim=2) == chunks

        for chunk in chunks:
            chunk["vector"] = [1.0, 0.0]
        assert store.upsert(db, "user-1", chunks) == len(chunks)
        assert store.pending_chunks(db, "user-1", chunks, dim=2) == []
        assert store.count_by_source(db, "user-1") == {"note": len(chunks)}
        assert store.count_by_source(db, "other-user") == {}

        missing_vector = db.query(BrainChunkORM).filter_by(user_id="user-1").first()
        missing_vector.vector_json = []
        db.commit()
        pending_missing = store.pending_chunks(db, "user-1", chunks, dim=2)
        assert len(pending_missing) == 1
        assert store.upsert(db, "user-1", pending_missing) == 1

        shortened = _build_chunks(
            source="note",
            source_ref_id="note-1",
            symbol=None,
            title="Research log",
            text="A much shorter revised note.",
            meta_json={},
        )
        pending = store.pending_chunks(db, "user-1", shortened, dim=2)
        assert pending == shortened

        keep = {(chunk["source"], chunk["ref_id"]) for chunk in shortened}
        assert store.delete_missing(db, "user-1", keep) == len(chunks) - 1
        assert store.count(db, "user-1") == 1
    finally:
        db.close()
        test_engine.dispose()


def test_vector_store_filters_numpy_search_by_user_and_source():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from backend.models.brain import BrainChunkORM
    from backend.models.user import User
    from backend.services.brain.vector_store import VectorStore

    test_engine = create_engine("sqlite:///:memory:")
    User.__table__.create(test_engine)
    BrainChunkORM.__table__.create(test_engine)
    db = sessionmaker(bind=test_engine)()
    store = VectorStore(use_pgvector=False)

    try:
        for user_id, source, ref_id, vector in (
            ("user-1", "note", "note-1", [1.0, 0.0]),
            ("user-1", "journal", "journal-1", [0.9, 0.1]),
            ("user-2", "note", "private-note", [1.0, 0.0]),
        ):
            store.upsert(
                db,
                user_id,
                [
                    {
                        "source": source,
                        "ref_id": ref_id,
                        "title": ref_id,
                        "chunk_text": ref_id,
                        "content_hash": ref_id,
                        "vector": vector,
                    }
                ],
            )

        matches = store.search(db, "user-1", [1.0, 0.0], sources=["journal"])

        assert [match.chunk.ref_id for match in matches] == ["journal-1"]
        assert store.count_by_source(db, "user-1") == {"journal": 1, "note": 1}
    finally:
        db.close()
        test_engine.dispose()


@pytest.mark.asyncio
async def test_reindex_keeps_old_rows_when_replacement_embedding_fails(monkeypatch):
    from backend.services.brain import indexer
    from backend.services.brain.indexer import _build_chunks

    chunks = _build_chunks(
        source="note",
        source_ref_id="note-1",
        symbol=None,
        title="Research log",
        text="A replacement chunk.",
        meta_json={},
    )
    events: list[str] = []

    class Store:
        use_pgvector = False

        def pending_chunks(self, db, user_id, candidates, *, dim):
            events.append("pending")
            return candidates

        def upsert(self, db, user_id, candidates):
            events.append("upsert")
            return len(candidates)

        def delete_missing(self, db, user_id, keep):
            events.append("prune")
            return 1

        def count(self, db, user_id):
            return 1

    class BrokenEmbedder:
        dim = 2

        async def embed_texts(self, texts):
            events.append("embed")
            raise RuntimeError("embedding provider offline")

    monkeypatch.setattr(indexer, "_collect_chunks", lambda db, user_id: chunks)
    monkeypatch.setattr(indexer, "get_embedding_service", lambda: BrokenEmbedder())
    monkeypatch.setattr(indexer, "make_vector_store", lambda engine, dim: Store())

    with pytest.raises(RuntimeError, match="provider offline"):
        await indexer.reindex_user(None, "user-1")

    assert events == ["pending", "embed"]


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
            captured["sources"] = sources
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

    out = await brain_service.ask(
        None,
        "user1",
        "when do I lose money?",
        sources=["journal", "journal"],
    )

    assert out["llm"] is True
    assert "[1]" in out["answer"]
    # The note text was actually fed to the model as grounding context.
    assert "anxious" in captured["context"]
    assert out["citations"][0]["source"] == "journal"
    assert out["citations"][0]["route"] == "/equity/journal"
    assert out["citations"][0]["n"] == 1
    assert out["sources"] == ["journal"]
    assert captured["sources"] == ["journal"]


@pytest.mark.asyncio
async def test_ask_defaults_to_all_private_sources_without_filtering_store(monkeypatch):
    captured = {}

    class EmptyStore:
        use_pgvector = False

        def count(self, db, uid):
            return 1

        def search(self, db, uid, qv, *, k=6, sources=None):
            captured["sources"] = sources
            return []

    class FakeEmbedder:
        dim = 2

        async def embed_query(self, q):
            return [1.0, 0.0]

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: EmptyStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: FakeEmbedder())

    out = await brain_service.ask(None, "user1", "anything?")

    assert out["sources"] == list(brain_service.BRAIN_SOURCES)
    assert captured["sources"] is None


@pytest.mark.asyncio
async def test_ask_rejects_empty_or_unknown_source_scopes():
    with pytest.raises(ValueError, match="At least one"):
        await brain_service.ask(None, "user1", "anything?", sources=[])
    with pytest.raises(ValueError, match="Unknown brain sources: market"):
        await brain_service.ask(None, "user1", "anything?", sources=["market"])


def test_ask_request_validates_source_vocabulary():
    from pydantic import ValidationError

    from backend.api.routes.brain import AskRequest

    assert AskRequest(question="why?", sources=["note", "journal"]).sources == [
        "note",
        "journal",
    ]
    with pytest.raises(ValidationError):
        AskRequest(question="why?", sources=[])
    with pytest.raises(ValidationError):
        AskRequest(question="why?", sources=["market"])


@pytest.mark.asyncio
async def test_status_exposes_zero_filled_per_source_counts(monkeypatch):
    class Store:
        use_pgvector = False

        def count(self, db, uid):
            return 4

        def count_by_source(self, db, uid):
            return {"note": 3, "journal": 1}

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: Store())
    monkeypatch.setattr(
        brain_service,
        "get_embedding_service",
        lambda: SimpleNamespace(dim=2),
    )

    out = await brain_service.status(None, "user1")

    assert out["indexed_chunks"] == 4
    assert out["source_counts"] == {
        "note": 3,
        "journal": 1,
        "portfolio": 0,
        "holding": 0,
        "transaction": 0,
    }


def test_citation_exposes_original_source_id_and_chunk_index():
    match = VectorMatch(
        chunk=_chunk(
            [1.0, 0.0],
            ref_id="internal-chunk-hash",
            meta_json={"source_ref_id": "note-123", "chunk_index": 2},
        ),
        score=0.8,
    )

    citation = brain_service._citations([match])[0]

    assert citation["ref_id"] == "note-123"
    assert citation["chunk_index"] == 2


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


# ---- notes indexing -------------------------------------------------------

class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def all(self):
        return self._rows


class _FakeDB:
    def __init__(self, mapping):
        self._m = mapping

    def query(self, model):
        return _FakeQuery(self._m.get(model, []))


def test_collect_chunks_indexes_notes():
    from backend.models.journal import JournalEntry
    from backend.models.notes import NoteORM
    from backend.models.core import PortfolioORM
    from backend.services.brain.indexer import _collect_chunks

    note = SimpleNamespace(
        id="n1", body="Margins peaking, watch Q3 guidance.", symbol="AAPL",
        context="security", title="Thesis check", tags=["margins"],
    )
    empty = SimpleNamespace(id="n2", body="   ", symbol=None, context="general", title="", tags=[])
    db = _FakeDB({NoteORM: [note, empty], JournalEntry: [], PortfolioORM: []})

    chunks = _collect_chunks(db, "user1")

    # Only the non-empty note is indexed.
    note_chunks = [c for c in chunks if c["source"] == "note"]
    assert len(note_chunks) == 1
    c = note_chunks[0]
    assert c["ref_id"] != "n1"  # internal row key is chunk-specific
    assert c["meta_json"]["source_ref_id"] == "n1"
    assert c["meta_json"]["chunk_index"] == 0
    assert c["symbol"] == "AAPL"
    assert "Margins peaking" in c["chunk_text"]
    assert "Thesis check" in c["chunk_text"]
    # security note with a symbol deep-links to the security page.
    assert c["meta_json"]["route"] == "/equity/security/AAPL"
    assert c["content_hash"]  # hashed for incremental skip


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
