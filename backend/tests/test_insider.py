from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import insider as insider_routes
from backend.models.core import InsiderTrade
from backend.shared.db import Base


def _build_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(insider_routes.router)

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db_override
    return TestClient(app), SessionLocal


def _seed(SessionLocal) -> None:
    """Insert a small set of REAL insider trades (not the old fabricated seed)."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    db = SessionLocal()
    try:
        rows = []
        for i, sym in enumerate(["AAPL", "AAPL", "AAPL", "MSFT"]):
            rows.append(
                InsiderTrade(
                    symbol=sym,
                    insider_name=f"Person {i}",
                    insider_title="Director",
                    transaction_type="buy",
                    shares=1000 + i * 100,
                    price=100.0 + i,
                    value=(1000 + i * 100) * (100.0 + i),
                    date=today - timedelta(days=i),
                    filing_date=today - timedelta(days=i),
                    source="TEST",
                )
            )
        db.add_all(rows)
        db.commit()
    finally:
        db.close()


def test_recent_empty_db_is_degraded() -> None:
    client, _ = _build_client()

    response = client.get("/api/insider/recent", params={"min_value": 0})

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"] == []
    assert payload["degraded"]["reason"] == "no_provider_data"


def test_recent_returns_real_trades() -> None:
    client, SessionLocal = _build_client()
    _seed(SessionLocal)

    response = client.get("/api/insider/recent", params={"min_value": 0})

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"]
    assert payload["degraded"] is None
    assert {"date", "symbol", "name", "insider_name", "designation", "type", "quantity", "price", "value"} <= set(
        payload["trades"][0]
    )


def test_stock_returns_trades_and_summary() -> None:
    client, SessionLocal = _build_client()
    _seed(SessionLocal)

    response = client.get("/api/insider/stock/AAPL", params={"days": 365})

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"]
    assert payload["summary"]["insider_count"] >= 1
    assert all(row["symbol"] == "AAPL" for row in payload["trades"])


def test_top_buyers_ranked_and_cluster_detection() -> None:
    client, SessionLocal = _build_client()
    _seed(SessionLocal)

    buyers = client.get("/api/insider/top-buyers", params={"days": 90, "limit": 5}).json()["buyers"]
    assert buyers == sorted(buyers, key=lambda item: item["total_value"], reverse=True)

    clusters = client.get("/api/insider/cluster-buys", params={"days": 365, "min_insiders": 3}).json()["clusters"]
    # AAPL has 3 distinct insiders -> a cluster; MSFT (1) should not appear.
    assert any(c["symbol"] == "AAPL" and c["insider_count"] >= 3 for c in clusters)


def test_empty_db_endpoints_are_degraded() -> None:
    client, _ = _build_client()

    for path in ("/api/insider/top-buyers", "/api/insider/top-sellers", "/api/insider/cluster-buys"):
        payload = client.get(path).json()
        assert payload["degraded"]["reason"] == "no_provider_data"
