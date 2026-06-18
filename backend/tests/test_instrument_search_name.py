from __future__ import annotations

from backend.instruments.models import InstrumentMaster
from backend.instruments.search import search_instruments
from backend.instruments.text import search_blob
from backend.shared.db import SessionLocal, init_db


def _im(canonical_id, symbol, name, type_, exchange, currency="USD"):
    return InstrumentMaster(
        canonical_id=canonical_id, display_symbol=symbol, name=name,
        search_blob=search_blob(symbol, name), type=type_, exchange=exchange, currency=currency,
    )


def _seed(db):
    db.query(InstrumentMaster).delete()
    db.add_all([
        _im("NASDAQ:AAPL", "AAPL", "Apple Inc.", "equity", "NASDAQ"),
        _im("NASDAQ:APP", "APP", "AppLovin Corp", "equity", "NASDAQ"),
        _im("CRYPTO:BTC-USD", "BTC-USD", "Bitcoin", "crypto", "CRYPTO"),
        _im("NASDAQ:BTCS", "BTCS", "BTCS Inc.", "equity", "NASDAQ"),
        _im("SIX Swiss:NESN.SW", "NESN.SW", "Nestlé SA", "equity", "SIX Swiss", "CHF"),
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
        assert results[0].country_code == "US"  # derived from NASDAQ
        nesn = next(r for r in search_instruments(db, "nestle") if r.display_symbol == "NESN.SW")
        assert nesn.country_code == "CH"  # derived from SIX Swiss
        btc = next(r for r in search_instruments(db, "BTC-USD") if r.type == "crypto")
        assert btc.country_code is None  # crypto -> no flag
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_accent_insensitive_name_match():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        # ASCII query matches the accented name "Nestlé".
        results = search_instruments(db, "nestle")
        assert any(r.display_symbol == "NESN.SW" for r in results)
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_ranking_exact_then_prefix_shorter_first():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        # "BTC" → no exact ticker; prefix matches BTCS (4) and BTC-USD (7).
        order = [r.display_symbol for r in search_instruments(db, "BTC")]
        assert order.index("BTCS") < order.index("BTC-USD")  # shorter ranks higher
        # An exact ticker always wins its band.
        appres = search_instruments(db, "APP")
        assert appres[0].display_symbol == "APP"
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_search_matches_company_name():
    init_db()
    db = SessionLocal()
    try:
        _seed(db)
        assert any(r.display_symbol == "BTC-USD" for r in search_instruments(db, "bitcoin"))
        assert any(r.display_symbol == "APP" for r in search_instruments(db, "applovin"))
    finally:
        db.query(InstrumentMaster).delete()
        db.commit()
        db.close()


def test_context_market_boosts_matching_country():
    init_db()
    db = SessionLocal()
    try:
        db.query(InstrumentMaster).delete()
        # Both prefix-match "XY"; the EU row is shorter so it wins by default,
        # but a US-market context lifts the NASDAQ row above it — proving the
        # boost while both stay in the results (search is never filtered).
        db.add_all([
            _im("XETRA:XYA", "XYA", "Alpha AG", "equity", "XETRA", "EUR"),
            _im("NASDAQ:XYAB", "XYAB", "Beta Inc", "equity", "NASDAQ", "USD"),
        ])
        db.commit()

        default_order = [r.display_symbol for r in search_instruments(db, "XY")]
        us_order = [r.display_symbol for r in search_instruments(db, "XY", market="NASDAQ")]
        assert default_order[0] == "XYA"              # shorter symbol wins by default
        assert us_order[0] == "XYAB"                  # US context boosts the NASDAQ row
        assert set(us_order) == {"XYA", "XYAB"}       # nothing filtered out
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
