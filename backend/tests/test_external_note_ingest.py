"""API-key note ingestion for external Second Brain automations."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from backend.api.routes import external_notes
from backend.main import app
from backend.models.notes import NoteORM
from backend.models.user import User
from backend.shared.db import SessionLocal, init_db


def _user_and_key(client: TestClient, permissions: str) -> tuple[str, str]:
    suffix = uuid.uuid4().hex[:10]
    email = f"external-notes-{suffix}@example.com"
    password = "external-notes-password"
    assert client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "role": "trader"},
    ).status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    key_response = client.post(
        "/api/settings/api-keys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Hermes", "permissions": permissions},
    )
    assert key_response.status_code == 200

    db = SessionLocal()
    try:
        user_id = db.query(User).filter(User.email == email).one().id
    finally:
        db.close()
    return user_id, key_response.json()["key"]


def test_external_note_upsert_is_write_gated_idempotent_and_owner_scoped(monkeypatch) -> None:
    init_db()
    reindexed: list[str] = []

    async def fake_reindex(user_id: str) -> None:
        reindexed.append(user_id)

    monkeypatch.setattr(external_notes, "_reindex_user_brain", fake_reindex)
    client = TestClient(app)
    _, read_key = _user_and_key(client, "read")
    user_id, write_key = _user_and_key(client, "read_write")
    payload = {
        "source": "YouTube",
        "external_id": "dQw4w9WgXcQ",
        "title": "A useful investing talk",
        "body": "The first Hermes summary.",
        "tags": ["youtube", "hermes", "hermes"],
    }

    forbidden = client.put(
        "/api/v1/notes/external",
        headers={"X-API-Key": read_key},
        json=payload,
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "API key requires read_write permission"

    created = client.put(
        "/api/v1/notes/external",
        headers={"X-API-Key": write_key},
        json=payload,
    )
    assert created.status_code == 201, created.text
    first = created.json()
    assert first["created"] is True
    assert first["note"]["ref_id"] == "youtube:dQw4w9WgXcQ"
    assert first["note"]["tags"] == ["youtube", "hermes", "external", "source:youtube"]

    payload["body"] = "A corrected Hermes summary."
    updated = client.put(
        "/api/v1/notes/external",
        headers={"X-API-Key": write_key},
        json=payload,
    )
    assert updated.status_code == 200, updated.text
    second = updated.json()
    assert second["created"] is False
    assert second["note"]["id"] == first["note"]["id"]
    assert second["note"]["body"] == "A corrected Hermes summary."

    other_user_id, other_key = _user_and_key(client, "read_write")
    other = client.put(
        "/api/v1/notes/external",
        headers={"X-API-Key": other_key},
        json=payload,
    )
    assert other.status_code == 201
    assert other.json()["note"]["id"] != first["note"]["id"]

    db = SessionLocal()
    try:
        assert (
            db.query(NoteORM)
            .filter(NoteORM.user_id == user_id, NoteORM.ref_id == "youtube:dQw4w9WgXcQ")
            .count()
            == 1
        )
    finally:
        db.close()
    assert reindexed == [user_id, user_id, other_user_id]


def test_api_key_permissions_are_validated() -> None:
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:10]
    email = f"invalid-key-permission-{suffix}@example.com"
    password = "external-notes-password"
    client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "role": "trader"},
    )
    login = client.post("/api/auth/login", json={"email": email, "password": password})

    response = client.post(
        "/api/settings/api-keys",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        json={"name": "Too broad", "permissions": "admin"},
    )

    assert response.status_code == 422
