from __future__ import annotations

from backend.instruments.models import InstrumentMaster
from backend.instruments.search import search_instruments
from backend.shared.db import SessionLocal, init_db


def _seed(db):
    db.query(InstrumentMaster).delete()
    db.add_all([
        InstrumentMaster(canonical_id="NASDAQ:AAPL", display_symbol="AAPL", name="Apple Inc.",
                         type="equity", exchange="NASDAQ", currency="USD",
                         vendor_mappings_json={"yahoo": "AAPL"}),
        InstrumentMaster(canonical_id="NASDAQ:APP", display_symbol="APP", name="AppLovin Corp",
                         type="equity", exchange="NASDAQ", currency="USD"),
        InstrumentMaster(canonical_id="CRYPTO:BTC", display_symbol="BTC", name="Bitcoin",
                         type="crypto", exchange="CRYPTO", currency="USD"),
    ])
    db.commit()


def test_exact_ticker_ranks_first_and_carries_name():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        results = search_instruments(db, "AAPL")
        assert results[0].display_symbol == "AAPL"
        assert results[0].name == "Apple Inc."
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_search_matches_company_name_not_just_ticker():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        assert any(r.display_symbol == "BTC" for r in search_instruments(db, "bitcoin"))
        assert any(r.display_symbol == "APP" for r in search_instruments(db, "applovin"))
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_empty_query_returns_nothing():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        assert search_instruments(db, "   ") == []
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()
