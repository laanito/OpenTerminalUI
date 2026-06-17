from __future__ import annotations

import os
os.environ.setdefault("AUTH_MIDDLEWARE_ENABLED", "0")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.shared.db import Base
from backend.api.deps import get_db
from backend.instruments import routes
from backend.instruments.models import InstrumentMaster

_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Base.metadata.create_all(bind=_engine)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
_db = _Session()
# Seed 3 "AAP"-prefixed hits so a prefix query clears the fallback threshold,
# while an unrelated query (e.g. "ferrari") stays below it.
_db.add_all([
    InstrumentMaster(canonical_id="NASDAQ:AAPL", display_symbol="AAPL", name="Apple Inc.",
                     type="equity", exchange="NASDAQ", currency="USD"),
    InstrumentMaster(canonical_id="NASDAQ:AAPB", display_symbol="AAPB", name="GraniteShares AAPL",
                     type="etf", exchange="NASDAQ", currency="USD"),
    InstrumentMaster(canonical_id="NASDAQ:AAPD", display_symbol="AAPD", name="Direxion AAPL",
                     type="etf", exchange="NASDAQ", currency="USD"),
])
_db.commit()


def _override_get_db():
    try:
        yield _db
    finally:
        pass


@pytest.fixture
def client(monkeypatch):
    app.dependency_overrides[get_db] = _override_get_db
    monkeypatch.setenv("OPENTERMINALUI_INSTRUMENT_LIVE_SEARCH", "1")
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_live_fallback_appends_yahoo_and_persists(client, monkeypatch):
    captured = {}

    async def _fake_yahoo(query, limit=20):
        return [{
            "canonical_id": "YAHOO:RACE.MI", "display_symbol": "RACE.MI", "name": "Ferrari NV",
            "type": "equity", "exchange": "Milan", "currency": None,
            "tick_size": None, "lot_size": None, "vendor_mappings_json": {"yahoo": "RACE.MI"},
        }]

    def _fake_persist(rows, source="yahoo"):
        captured["rows"] = rows

    monkeypatch.setattr(routes, "yahoo_search", _fake_yahoo)
    monkeypatch.setattr(routes, "persist_discovered", _fake_persist)

    # "ferrari" has no seeded hit -> below threshold -> fallback fires.
    r = client.get("/api/instruments/search?q=ferrari")
    assert r.status_code == 200
    syms = [x["display_symbol"] for x in r.json()["results"]]
    assert "RACE.MI" in syms
    # background write-back was scheduled with the discovered rows
    assert captured.get("rows") and captured["rows"][0]["display_symbol"] == "RACE.MI"


def test_no_fallback_when_db_has_enough(client, monkeypatch):
    called = {"n": 0}

    async def _fake_yahoo(query, limit=20):
        called["n"] += 1
        return []

    monkeypatch.setattr(routes, "yahoo_search", _fake_yahoo)
    # "AAP" matches 3 seeded rows (>= threshold) -> no live fallback.
    r = client.get("/api/instruments/search?q=AAP")
    assert r.status_code == 200
    assert called["n"] == 0
    assert len(r.json()["results"]) >= 3
