from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import portfolio, watchlists
from backend.auth.deps import get_current_user
from backend.db.models import WatchlistORM
from backend.models import UserRole
from backend.shared.db import Base


def _build_app():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(watchlists.router)
    app.include_router(portfolio.router, prefix="/api", tags=["portfolio"])
    identity = {"id": "user-one", "role": UserRole.VIEWER}

    def _db_override():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    def _user_override():
        return type("FakeUser", (), identity)()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override
    return TestClient(app), session_factory, identity


def _watchlist(*, watchlist_id: str, user_id: str, symbol: str) -> WatchlistORM:
    return WatchlistORM(
        id=watchlist_id,
        user_id=user_id,
        name=f"{user_id} watchlist",
        symbols_json=[symbol],
        column_config_json={},
        created_at=datetime.now(timezone.utc),
    )


def test_watchlists_are_read_and_mutated_only_by_their_owner() -> None:
    client, session_factory, _ = _build_app()
    with session_factory() as db:
        db.add_all([
            _watchlist(watchlist_id="wl-one", user_id="user-one", symbol="AAPL"),
            _watchlist(watchlist_id="wl-two", user_id="user-two", symbol="MSFT"),
        ])
        db.commit()

    response = client.get("/api/watchlists")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ["wl-one"]

    assert client.put("/api/watchlists/wl-two", json={"name": "stolen"}).status_code == 404
    assert client.delete("/api/watchlists/wl-two").status_code == 404
    assert client.post("/api/watchlists/wl-two/symbols", json=["TSLA"]).status_code == 404
    assert client.delete("/api/watchlists/wl-two/symbols/MSFT").status_code == 404

    updated = client.post("/api/watchlists/wl-one/symbols", json=[" tsla "])
    assert updated.status_code == 200
    assert updated.json()["symbols"] == ["AAPL", "TSLA"]

    with session_factory() as db:
        other = db.query(WatchlistORM).filter(WatchlistORM.id == "wl-two").one()
        assert other.name == "user-two watchlist"
        assert other.symbols_json == ["MSFT"]


def test_legacy_flat_watchlist_feed_is_admin_only_and_deprecated() -> None:
    client, _, identity = _build_app()

    assert client.get("/api/watchlists/items").status_code == 403
    identity["role"] = UserRole.ADMIN
    response = client.get("/api/watchlists/items")
    assert response.status_code == 200
    assert response.json() == {"items": []}

    assert portfolio.router.routes
    assert all(route.deprecated for route in portfolio.router.routes)
