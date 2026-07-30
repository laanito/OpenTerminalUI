"""v1.2 "research interrogates": adversarial stock interrogation grounded in notes.

GET /api/ai/interrogate/{ticker} is authed and per-user: it folds the user's own
notes on the ticker into an adversarial prompt (pressure-test the bull case, not
flatter it). Offline (no LLM) it still returns the shared {summary, sections}
shape with engine "unavailable" — never a fabricated analysis.
"""
from __future__ import annotations

import uuid

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
    assert r1.json()["note_count"] == 1
