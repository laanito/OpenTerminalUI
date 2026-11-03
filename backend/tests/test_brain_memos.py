"""Owner scope and immutability contract for saved Second Brain answers."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from backend.main import app
from backend.shared.db import init_db


def test_saved_technical_context_is_immutable_owner_scoped_and_not_refreshed(monkeypatch):
    from backend.tests.test_brain_technical_context import context
    from backend.services.brain import technical_context as technical
    async def must_not_fetch(*args, **kwargs):
        raise AssertionError("reading a saved memo must not refresh technical markets")
    monkeypatch.setattr(technical, "collect_research_technical_evidence", must_not_fetch)
    init_db()
    client = TestClient(app)
    owner, other = _auth(client, "technical-owner"), _auth(client, "technical-other")
    payload = _payload()
    payload["answer"] = "The dated private claim [1] can be compared conditionally with [T1.1] and [T2.1]."
    payload["technical_context"] = context().model_dump(mode="json")
    payload["generated_at"] = "2026-09-25T12:01:00+00:00"
    created = client.post("/api/brain/memos", headers=owner, json=payload)
    assert created.status_code == 201, created.text
    memo = created.json()
    assert memo["technical_context"] == payload["technical_context"]
    url = f"/api/brain/memos/{memo['id']}"
    assert client.get(url, headers=other).status_code == 404
    assert client.patch(url, headers=owner, json={"technical_context": None}).status_code == 422
    assert client.patch(url, headers=owner, json={"title": "Reviewed title"}).status_code == 200
    assert client.get(url, headers=owner).json()["technical_context"] == payload["technical_context"]
    assert client.get(url + "/evidence-status", headers=owner).status_code == 200
    assert client.get(url, headers=owner).json()["technical_context"] == payload["technical_context"]


def test_saved_technical_answers_cannot_drop_their_reference_targets():
    from backend.tests.test_brain_technical_context import context
    init_db()
    client = TestClient(app)
    owner = _auth(client, "technical-invalid")
    payload = {**_payload(), "technical_context": context().model_dump(mode="json"),
               "answer": "Wrong or incomplete targets [1] [T9.9]."}
    assert client.post("/api/brain/memos", headers=owner, json=payload).status_code == 422


def _auth(client: TestClient, label: str) -> dict[str, str]:
    email = f"brain-memo-{label}-{uuid.uuid4().hex[:8]}@example.com"
    password = "brain-memo-password"
    assert client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "role": "trader"},
    ).status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _payload() -> dict[str, object]:
    return {
        "question": "What changed in my current thesis?",
        "answer": "The newer margin evidence supersedes the older view [1].",
        "sources": ["note", "journal", "note"],
        "citations": [
            {
                "n": 1,
                "source": "note",
                "title": "Current margin view",
                "symbol": "aapl",
                "snippet": "Guidance changed the margin outlook.",
                "score": 0.87,
                "effective_at": "2026-09-15T14:30:00+00:00",
                "ref_id": "note-current",
                "chunk_index": 0,
                "content_hash": "a" * 64,
            }
        ],
        "generated_at": "2026-09-20T12:00:00+00:00",
        "llm": True,
        "llm_provider": "local",
        "llm_model": "qwen3",
        "tags": ["review", "review"],
        "symbol": "aapl",
    }


def test_brain_memo_crud_is_owner_scoped_and_snapshot_is_immutable() -> None:
    init_db()
    client = TestClient(app)
    owner = _auth(client, "owner")
    other = _auth(client, "other")

    created = client.post("/api/brain/memos", headers=owner, json=_payload())
    assert created.status_code == 201, created.text
    memo = created.json()
    assert memo["title"] == "What changed in my current thesis?"
    assert memo["sources"] == ["note", "journal"]
    assert memo["tags"] == ["review"]
    assert memo["symbol"] == "AAPL"
    assert memo["citation_count"] == 1
    assert memo["citations"][0]["content_hash"] == "a" * 64

    listed = client.get("/api/brain/memos", headers=owner)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [memo["id"]]
    assert "answer" not in listed.json()[0]
    assert listed.json()[0]["answer_preview"].startswith("The newer margin")

    assert client.get(f"/api/brain/memos/{memo['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/brain/memos/{memo['id']}", headers=other).status_code == 404

    immutable = client.patch(
        f"/api/brain/memos/{memo['id']}",
        headers=owner,
        json={"answer": "A rewritten conclusion"},
    )
    assert immutable.status_code == 422

    updated = client.patch(
        f"/api/brain/memos/{memo['id']}",
        headers=owner,
        json={
            "title": "Margin thesis review",
            "annotation": "Revisit after earnings.",
            "tags": ["earnings", "review"],
            "symbol": None,
            "pinned": True,
        },
    )
    assert updated.status_code == 200, updated.text
    revised = updated.json()
    assert revised["title"] == "Margin thesis review"
    assert revised["annotation"] == "Revisit after earnings."
    assert revised["symbol"] is None
    assert revised["pinned"] is True
    assert revised["answer"] == memo["answer"]
    assert revised["citations"] == memo["citations"]

    assert client.delete(f"/api/brain/memos/{memo['id']}", headers=owner).status_code == 204
    assert client.get(f"/api/brain/memos/{memo['id']}", headers=owner).status_code == 404


def test_brain_memo_requires_timezone_and_known_snapshot_fields() -> None:
    init_db()
    client = TestClient(app)
    owner = _auth(client, "validation")
    payload = _payload()
    payload["generated_at"] = "2026-09-20T12:00:00"

    ambiguous = client.post("/api/brain/memos", headers=owner, json=payload)
    assert ambiguous.status_code == 422
    assert "timezone" in ambiguous.text

    payload = _payload()
    payload["citations"][0]["invented"] = "not part of the snapshot contract"  # type: ignore[index]
    extra = client.post("/api/brain/memos", headers=owner, json=payload)
    assert extra.status_code == 422


def test_brain_memo_list_filters_symbol_and_pin() -> None:
    init_db()
    client = TestClient(app)
    owner = _auth(client, "filters")
    first = _payload()
    first["symbol"] = "MSFT"
    first["pinned"] = True
    second = _payload()
    second["symbol"] = "AAPL"
    assert client.post("/api/brain/memos", headers=owner, json=first).status_code == 201
    assert client.post("/api/brain/memos", headers=owner, json=second).status_code == 201

    pinned = client.get("/api/brain/memos", headers=owner, params={"pinned": True})
    assert pinned.status_code == 200
    assert [item["symbol"] for item in pinned.json()] == ["MSFT"]

    apple = client.get("/api/brain/memos", headers=owner, params={"symbol": "aapl"})
    assert apple.status_code == 200
    assert [item["symbol"] for item in apple.json()] == ["AAPL"]


def test_reviewed_promotion_creates_linked_note_without_rewriting_memo(monkeypatch) -> None:
    from backend.api.routes import brain_memos

    indexed: list[str] = []

    async def fake_reindex(user_id: str) -> None:
        indexed.append(user_id)

    monkeypatch.setattr(brain_memos, "_reindex_user_brain", fake_reindex)
    init_db()
    client = TestClient(app)
    owner = _auth(client, "promote-owner")
    other = _auth(client, "promote-other")
    created = client.post("/api/brain/memos", headers=owner, json=_payload())
    assert created.status_code == 201, created.text
    memo = created.json()
    path = f"/api/brain/memos/{memo['id']}/promote-to-note"
    reviewed = {
        "title": "My reviewed margin note",
        "body": "I checked the source; margins may improve, but guidance is provisional.",
        "symbol": "msft",
        "tags": ["reviewed", "reviewed"],
        "effective_at": "2026-09-21T09:00:00+00:00",
    }

    assert client.post(path, headers=other, json=reviewed).status_code == 404
    assert client.post(path, headers=owner, json={**reviewed, "body": "  "}).status_code == 422
    assert client.post(path, headers=owner, json={**reviewed, "effective_at": "2026-09-21T09:00:00"}).status_code == 422
    assert client.post("/api/notes", headers=owner, json={"context": "brain_memo", "body": "Forged"}).status_code == 422

    promoted = client.post(path, headers=owner, json=reviewed)
    assert promoted.status_code == 201, promoted.text
    note = promoted.json()
    assert note["context"] == "brain_memo"
    assert note["ref_id"] == memo["id"]
    assert note["body"] == reviewed["body"]
    assert note["body"] != memo["answer"]
    assert note["symbol"] == "MSFT"
    assert note["tags"] == ["reviewed"]
    assert note["effective_at"].startswith("2026-09-21T09:00:00")
    assert len(indexed) == 1
    assert client.get("/api/notes", headers=other).json() == []
    assert client.get(f"/api/brain/memos/{memo['id']}", headers=owner).json()["answer"] == memo["answer"]


def test_evidence_status_uses_live_owner_records_without_mutating_snapshot(monkeypatch) -> None:
    from backend.api.routes import notes
    from backend.models.journal import JournalEntry
    from backend.models.notes import NoteORM
    from backend.services.brain.indexer import _collect_chunks
    from backend.shared.db import SessionLocal

    async def skip_reindex(_user_id: str) -> None:
        return None

    monkeypatch.setattr(notes, "_reindex_user_brain", skip_reindex)
    init_db()
    client = TestClient(app)
    owner = _auth(client, "evidence-owner")
    other = _auth(client, "evidence-other")
    created_note = client.post(
        "/api/notes", headers=owner,
        json={"title": "Current margin view", "body": "Guidance changed the margin outlook.", "symbol": "AAPL"},
    )
    assert created_note.status_code == 201, created_note.text
    note_id = created_note.json()["id"]

    with SessionLocal() as db:
        note = db.query(NoteORM).filter(NoteORM.id == note_id).one()
        current = _collect_chunks(db, note.user_id, {"note": {note_id}})
        assert len(current) == 1
        current_hash = current[0]["content_hash"]
        journal = JournalEntry(
            user_id=note.user_id, symbol="AAPL", direction="long",
            entry_date=note.created_at, entry_price=100, quantity=1,
        )
        db.add(journal)
        db.commit()
        assert [chunk["source"] for chunk in _collect_chunks(db, note.user_id, {"journal": {str(journal.id)}})] == ["journal"]

    payload = _payload()
    payload["citations"][0]["ref_id"] = note_id  # type: ignore[index]
    payload["citations"][0]["content_hash"] = current_hash  # type: ignore[index]
    saved = client.post("/api/brain/memos", headers=owner, json=payload)
    assert saved.status_code == 201, saved.text
    memo_id = saved.json()["id"]
    path = f"/api/brain/memos/{memo_id}/evidence-status"

    assert client.get(path, headers=other).status_code == 404
    initial = client.get(path, headers=owner)
    assert initial.status_code == 200, initial.text
    assert initial.json()["status"] == "current"
    assert initial.json()["citations"] == [{"n": 1, "status": "current"}]

    with SessionLocal() as db:
        note = db.query(NoteORM).filter(NoteORM.id == note_id).one()
        note.body = "Margin outlook was revised again."
        db.commit()
    changed = client.get(path, headers=owner)
    assert changed.json()["status"] == "stale"
    assert changed.json()["citations"] == [{"n": 1, "status": "changed"}]
    assert client.get(f"/api/brain/memos/{memo_id}", headers=owner).json()["citations"][0]["content_hash"] == current_hash

    with SessionLocal() as db:
        note = db.query(NoteORM).filter(NoteORM.id == note_id).one()
        db.delete(note)
        db.commit()
    missing = client.get(path, headers=owner)
    assert missing.json()["status"] == "stale"
    assert missing.json()["citations"] == [{"n": 1, "status": "unavailable"}]

    legacy = _payload()
    legacy["citations"][0].pop("content_hash")  # type: ignore[index]
    legacy["citations"][0].pop("chunk_index")  # type: ignore[index]
    legacy_memo = client.post("/api/brain/memos", headers=owner, json=legacy)
    assert legacy_memo.status_code == 201
    unknown = client.get(f"/api/brain/memos/{legacy_memo.json()['id']}/evidence-status", headers=owner)
    assert unknown.json()["status"] == "unverifiable"
    assert unknown.json()["citations"] == [{"n": 1, "status": "unverifiable"}]


def test_technical_only_answer_can_be_saved_without_fabricating_private_citations():
    from backend.tests.test_brain_technical_context import context
    init_db()
    client = TestClient(app)
    owner = _auth(client, "technical-only")
    payload = {**_payload(), "technical_context": context().model_dump(mode="json"), "citations": [],
               "answer": "No private evidence was retrieved. Short-window observations [T1.1] [T2.1] cannot establish a long-term buying case."}
    created = client.post("/api/brain/memos", headers=owner, json=payload)
    assert created.status_code == 201, created.text
    memo = client.get(f"/api/brain/memos/{created.json()['id']}", headers=owner).json()
    assert memo["citations"] == [] and memo["technical_context"] == payload["technical_context"]
