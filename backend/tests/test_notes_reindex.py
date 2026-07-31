"""Writing a note reindexes the second brain (so #81's related-notes grounding
sees fresh notes) — in the background, best-effort, never failing the save.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api.routes import notes as notes_route
from backend.main import app


@pytest.fixture(autouse=True, scope="module")
def _ensure_schema() -> None:
    from backend.shared.db import init_db

    init_db()


def _auth(client: TestClient, email: str) -> dict[str, str]:
    pw = "pw-notes-reindex-123"
    client.post("/api/auth/register", json={"email": email, "password": pw, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": pw})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_creating_a_note_schedules_a_brain_reindex(monkeypatch) -> None:
    calls: list[str] = []

    async def _fake_reindex(user_id: str) -> None:
        calls.append(user_id)

    monkeypatch.setattr(notes_route, "_reindex_user_brain", _fake_reindex)

    client = TestClient(app)
    headers = _auth(client, f"reindex-{uuid.uuid4().hex[:8]}@example.com")
    r = client.post(
        "/api/notes",
        headers=headers,
        json={"symbol": "AAPL", "context": "security", "title": "t", "body": "AI demand is durable"},
    )
    assert r.status_code == 201, r.text
    # BackgroundTasks execute after the response in TestClient — the reindex fired.
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_reindex_helper_swallows_errors(monkeypatch) -> None:
    import backend.services.brain.indexer as indexer

    async def _boom(db, user_id):  # noqa: ANN001, ANN202
        raise RuntimeError("embedder offline")

    monkeypatch.setattr(indexer, "reindex_user", _boom)
    # A note save must never fail because the embedder is down: the helper eats it.
    await notes_route._reindex_user_brain("user-x")
