"""v1.2 "research interrogates": adversarial stock interrogation grounded in notes.

GET /api/ai/interrogate/{ticker} is authed and per-user: it folds the user's own
notes on the ticker into an adversarial prompt (pressure-test the bull case, not
flatter it). Offline (no LLM) it still returns the shared {summary, sections}
shape with engine "unavailable" — never a fabricated analysis.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.routes.ai_insights import _interrogation_prompts
from backend.main import app


@pytest.fixture(autouse=True, scope="module")
def _ensure_schema() -> None:
    # This file sorts early, so in CI it can run before any test that boots the
    # app lifespan (which calls init_db) and creates the shared test-DB schema —
    # yielding "no such table: users". Create the tables here directly (idempotent
    # create_all), avoiding lifespan start/stop churn between client blocks.
    from backend.shared.db import init_db

    init_db()


def _unique_symbol() -> str:
    # A throwaway ticker unique per run: keeps the test rerun-safe against the
    # persistent local test DB (no note accumulation) and avoids the per-symbol
    # interrogation cache colliding across runs.
    return "ZZ" + uuid.uuid4().hex[:6].upper()


def test_interrogation_prompt_is_adversarial_and_folds_in_notes() -> None:
    system, user = _interrogation_prompts(
        "AAPL",
        {"company_name": "Apple Inc.", "current_price": 200.0, "pe_ratio": 30},
        ["Apple unveils new product"],
        ["Thesis: services margin keeps expanding and offsets hardware slowdown"],
    )
    # Adversarial framing, not a cheerleader.
    assert "devil's-advocate" in system.lower()
    assert "bear case" in system.lower()
    assert "do not flatter" in system.lower()
    # The user's own note is folded in verbatim as the thesis to challenge.
    assert "services margin keeps expanding" in user
    assert "AAPL" in user and "Apple Inc." in user


def test_interrogation_prompt_handles_no_notes() -> None:
    _system, user = _interrogation_prompts("MSFT", {"name": "Microsoft"}, [], [])
    assert "recorded no notes" in user  # honest placeholder, not silence


def test_interrogation_prompt_folds_in_related_notes() -> None:
    # Semantically-related notes on OTHER tickers are folded in as a distinct block
    # so the model can cross-reference the thesis against the user's wider thinking.
    system, user = _interrogation_prompts(
        "AAPL",
        {"company_name": "Apple Inc."},
        [],
        ["Thesis: services moat is durable"],
        ["[on MSFT] I keep betting on 'durable software moats' — this one burned me"],
    )
    assert "related notes on OTHER tickers" in user
    assert "durable software moats" in user
    assert "recurring pattern" in system.lower()
    # Backward-compatible: omitting related notes adds no related block.
    _s2, user2 = _interrogation_prompts("AAPL", {"company_name": "Apple Inc."}, [], [])
    assert "related notes on OTHER tickers" not in user2


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "pw-interrogate-123"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_interrogate_requires_auth() -> None:
    client = TestClient(app)
    resp = client.get("/api/ai/interrogate/AAPL")
    assert resp.status_code == 401


def test_interrogate_returns_insight_shape_and_counts_notes() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "interrogate-shape@example.com")

    # A fresh symbol with no notes → note_count 0, well-formed insight shape
    # (engine "unavailable" offline — never a fabricated analysis).
    no_notes = _unique_symbol()
    r0 = client.get(f"/api/ai/interrogate/{no_notes}", headers=headers)
    assert r0.status_code == 200, r0.text
    body0 = r0.json()
    assert body0["ticker"] == no_notes
    assert set(body0) >= {"ticker", "note_count", "engine", "summary", "sections"}
    assert body0["note_count"] == 0

    # Record one note on a fresh symbol, then the interrogation folds it in.
    with_note = _unique_symbol()
    created = client.post(
        "/api/notes",
        headers=headers,
        json={"symbol": with_note, "context": "security", "title": "My thesis", "body": "AI demand is durable"},
    )
    assert created.status_code in (200, 201), created.text

    r1 = client.get(f"/api/ai/interrogate/{with_note}", headers=headers)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["note_count"] == 1
    # Semantic-related grounding is always reported, even when 0 (no brain / offline
    # embedder degrades to no related notes — never a failure).
    assert "related_count" in body0 and "related_count" in body1


def _match(symbol, text, score):
    from backend.services.brain.vector_store import VectorMatch

    chunk = SimpleNamespace(
        symbol=symbol,
        title=f"Note · {symbol or 'general'}",
        chunk_text=text,
        source="note",
        ref_id=text[:8],
    )
    return VectorMatch(chunk=chunk, score=score)


@pytest.mark.asyncio
async def test_related_notes_excludes_same_ticker_and_applies_floor(monkeypatch) -> None:
    from backend.services.brain import brain_service

    # A same-ticker note (must be EXCLUDED — the caller folds these in directly),
    # an on-topic related note, and an off-topic one below the score floor.
    results = [
        _match("AAPL", "AAPL moat note", 0.95),
        _match("MSFT", "MSFT moat thesis", 0.90),
        _match("KO", "KO dividend note", 0.10),
    ]

    class FakeStore:
        use_pgvector = False

        def count(self, db, uid):
            return len(results)

        def search(self, db, uid, qv, *, k=6, sources=None):
            assert sources == ["note"]  # only the user's own notes, per the chosen scope
            return results

    class FakeEmbedder:
        dim = 3

        async def embed_query(self, q):
            return [1.0, 0.0, 0.0]

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: FakeStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: FakeEmbedder())

    related = await brain_service.related_notes(
        None, "user1", "software moat", exclude_symbol="AAPL", k=4, min_score=0.5
    )
    symbols = {r["symbol"] for r in related}
    assert "AAPL" not in symbols  # same-ticker excluded
    assert "MSFT" in symbols  # on-topic related note retrieved
    assert "KO" not in symbols  # off-topic dropped by the min_score floor


@pytest.mark.asyncio
async def test_related_notes_empty_brain_returns_nothing(monkeypatch) -> None:
    from backend.services.brain import brain_service

    class EmptyStore:
        use_pgvector = False

        def count(self, db, uid):
            return 0

    class FakeEmbedder:
        dim = 3

        async def embed_query(self, q):  # pragma: no cover - must not be reached
            raise AssertionError("should not embed when the brain is empty")

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: EmptyStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: FakeEmbedder())

    assert await brain_service.related_notes(None, "nobody", "anything") == []


@pytest.mark.asyncio
async def test_related_notes_degrades_when_embedder_unavailable(monkeypatch) -> None:
    from backend.services.brain import brain_service
    from backend.services.embeddings import EmbeddingError

    class FakeStore:
        use_pgvector = False

        def count(self, db, uid):
            return 3

    class BrokenEmbedder:
        dim = 3

        async def embed_query(self, q):
            raise EmbeddingError("no embeddings backend")

    monkeypatch.setattr(brain_service, "make_vector_store", lambda engine, dim: FakeStore())
    monkeypatch.setattr(brain_service, "get_embedding_service", lambda: BrokenEmbedder())

    # Never raises — an unreachable embedder just yields no related notes.
    assert await brain_service.related_notes(None, "user1", "anything") == []
