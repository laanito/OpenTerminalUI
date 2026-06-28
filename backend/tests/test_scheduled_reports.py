from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app
from backend.shared.db import init_db


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_scheduled_report_crud_and_user_scoping() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "reports-crud@example.com")

    # Starts empty.
    assert client.get("/api/reports/scheduled", headers=headers).json() == {"items": []}

    created = client.post(
        "/api/reports/scheduled",
        headers=headers,
        json={"report_type": "portfolio_summary", "frequency": "daily", "email": "me@example.com", "data_type": "positions"},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["report_type"] == "portfolio_summary"
    assert body["frequency"] == "daily"
    assert body["enabled"] is True
    config_id = body["id"]

    listed = client.get("/api/reports/scheduled", headers=headers).json()["items"]
    assert len(listed) == 1
    assert listed[0]["id"] == config_id

    # A different user does not see the first user's reports.
    other = _auth_headers(client, "reports-other@example.com")
    assert client.get("/api/reports/scheduled", headers=other).json() == {"items": []}

    # Delete.
    deleted = client.delete(f"/api/reports/scheduled/{config_id}", headers=headers)
    assert deleted.status_code == 200
    assert client.get("/api/reports/scheduled", headers=headers).json() == {"items": []}

    # Deleting a missing config is a 404.
    assert client.delete(f"/api/reports/scheduled/{config_id}", headers=headers).status_code == 404


def test_scheduled_report_defaults_email_to_account() -> None:
    # Omitting `email` must NOT 422 — it falls back to the authenticated user's
    # account email so the common "schedule it for me" case just works.
    init_db()
    client = TestClient(app)
    user_email = "reports-default-email@example.com"
    headers = _auth_headers(client, user_email)

    created = client.post(
        "/api/reports/scheduled",
        headers=headers,
        json={"report_type": "portfolio_summary", "frequency": "weekly"},
    )
    assert created.status_code == 200
    assert created.json()["email"] == user_email

    # An explicit email still wins over the account default.
    explicit = client.post(
        "/api/reports/scheduled",
        headers=headers,
        json={"report_type": "portfolio_summary", "email": "elsewhere@example.com"},
    )
    assert explicit.status_code == 200
    assert explicit.json()["email"] == "elsewhere@example.com"


def test_generate_report_returns_pdf() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "reports-gen@example.com")

    res = client.post("/api/reports/generate", headers=headers, json={"type": "portfolio", "params": {}})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content[:5] == b"%PDF-"

    # Per-stock variant accepts params without erroring.
    stock = client.post("/api/reports/generate", headers=headers, json={"type": "stock", "params": {"ticker": "AAPL"}})
    assert stock.status_code == 200
    assert stock.content[:5] == b"%PDF-"


def test_scheduled_report_endpoints_require_auth() -> None:
    init_db()
    client = TestClient(app)
    assert client.get("/api/reports/scheduled").status_code == 401
    assert client.post("/api/reports/generate", json={"type": "portfolio"}).status_code == 401
