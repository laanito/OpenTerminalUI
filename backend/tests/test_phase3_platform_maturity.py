from __future__ import annotations

from fastapi.testclient import TestClient

from backend.auth.jwt import create_access_token
from backend.main import app
from backend.models.user import User, UserRole
from backend.shared.db import SessionLocal


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# The legacy global tax-lot endpoints (/api/portfolio/tax-lots*) and the global
# analytics endpoints (/api/portfolio/analytics/*) were removed in v1.1 (part C).
# Tax lots are shelved; the analytics live per-user under
# /api/portfolios/{id}/analytics/* and are covered by test_portfolio_manager_analytics.


def test_export_csv_endpoint_smoke() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "phase3-export@example.com")
    res = client.get("/api/export/watchlist?format=csv", headers=headers)
    assert res.status_code == 200
    assert "text/csv" in str(res.headers.get("content-type", ""))


def test_plugins_routes_are_admin_only_and_discover_examples() -> None:
    client = TestClient(app)
    email = "phase3-plugins@example.com"
    viewer_headers = _auth_headers(client, email)
    denied = client.get("/api/plugins", headers=viewer_headers)
    assert denied.status_code == 403
    denied_mutation = client.post("/api/plugins/missing@0/enable", headers=viewer_headers)
    assert denied_mutation.status_code == 403

    session_factory = getattr(app.state, "db_session_factory", SessionLocal)
    db = session_factory()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        user.role = UserRole.ADMIN
        db.commit()
        db.refresh(user)
        admin_token = create_access_token(user.id, user.email, user.role.value)
    finally:
        db.close()

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    res = client.get("/api/plugins", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert "items" in body
    assert any("rsi_divergence_scanner" in str(x.get("name")) for x in body["items"])

    missing = client.post("/api/plugins/missing@0/enable", headers=admin_headers)
    assert missing.status_code == 404
