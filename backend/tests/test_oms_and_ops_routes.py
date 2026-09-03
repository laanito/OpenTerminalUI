from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import audit, oms, ops
from backend.auth.deps import get_current_user
from backend.models import UserRole
from backend.oms.service import create_order
from backend.shared.db import Base


def _build_app(monkeypatch, *, user_id: str = "u_test", role: UserRole = UserRole.ADMIN):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(oms.router, prefix="/api")
    app.include_router(ops.router, prefix="/api")
    app.include_router(audit.router, prefix="/api")

    async def _fake_snap(_: str):
        return {"current_price": 100.0, "market_cap": 1_000_000_000}

    monkeypatch.setattr(oms, "fetch_stock_snapshot_coalesced", _fake_snap)

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _user_override():
        return type("FakeUser", (), {"id": user_id, "role": role})()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override
    return TestClient(app), SessionLocal


def test_oms_restricted_and_kill_switch(monkeypatch) -> None:
    client, _ = _build_app(monkeypatch)

    rest = client.post("/api/oms/restricted", json={"symbol": "RELIANCE", "reason": "test block", "active": True})
    assert rest.status_code == 200

    blocked = client.post("/api/oms/order", json={"symbol": "RELIANCE", "side": "buy", "quantity": 10})
    assert blocked.status_code == 200
    assert blocked.json()["order"]["status"] == "rejected"

    ks = client.post("/api/ops/kill-switch", json={"scope": "orders", "enabled": True, "reason": "maintenance"})
    assert ks.status_code == 200

    blocked2 = client.post("/api/oms/order", json={"symbol": "INFY", "side": "buy", "quantity": 10})
    assert blocked2.status_code == 200
    assert blocked2.json()["order"]["status"] == "rejected"


def test_oms_records_and_audit_are_user_scoped_and_global_controls_are_admin_only(monkeypatch) -> None:
    client, session_factory = _build_app(monkeypatch, role=UserRole.VIEWER)
    db = session_factory()
    try:
        create_order(db, "other-user", "MSFT", "buy", 1, "market", None, {}, accepted=True)
    finally:
        db.close()

    simulated = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 1})
    assert simulated.status_code == 200
    assert simulated.json()["order"]["status"] == "filled"

    orders = client.get("/api/oms/orders")
    assert orders.status_code == 200
    assert [row["symbol"] for row in orders.json()["items"]] == ["AAPL"]

    events = client.get("/api/audit")
    assert events.status_code == 200
    assert events.json()["items"]
    assert {row["user_id"] for row in events.json()["items"]} == {"u_test"}
    assert "oms_fill_created" in {row["event_type"] for row in events.json()["items"]}

    restricted = client.post("/api/oms/restricted", json={"symbol": "AAPL", "active": True})
    assert restricted.status_code == 403
    kill_switch = client.post("/api/ops/kill-switch", json={"scope": "orders", "enabled": True})
    assert kill_switch.status_code == 403
