from __future__ import annotations

import asyncio

from backend.instruments import populate
from backend.instruments.models import InstrumentMaster
from backend.instruments.search import search_instruments
from backend.shared.db import SessionLocal, init_db


def _us_rows():
    return [
        {"canonical_id": "NASDAQ:AAPL", "display_symbol": "AAPL", "name": "Apple Inc.",
         "type": "equity", "exchange": "NASDAQ", "currency": "USD",
         "tick_size": None, "lot_size": "100", "vendor_mappings_json": {"yahoo": "AAPL"}},
        {"canonical_id": "NYSE ARCA:SPY", "display_symbol": "SPY", "name": "SPDR S&P 500",
         "type": "etf", "exchange": "NYSE ARCA", "currency": "USD",
         "tick_size": None, "lot_size": "100", "vendor_mappings_json": {"yahoo": "SPY"}},
    ]


def _eu_rows():
    # Same type='equity' as US — only `source` distinguishes the slices.
    return [
        {"canonical_id": "XETRA:ADS.DE", "display_symbol": "ADS.DE", "name": "Adidas",
         "type": "equity", "exchange": "XETRA", "currency": "EUR",
         "tick_size": None, "lot_size": None, "vendor_mappings_json": {"yahoo": "ADS.DE"}},
    ]


def _crypto_rows():
    return [
        {"canonical_id": "CRYPTO:BTC-USD", "display_symbol": "BTC-USD", "name": "Bitcoin",
         "type": "crypto", "exchange": "CRYPTO", "currency": "USD",
         "tick_size": None, "lot_size": None,
         "vendor_mappings_json": {"coingecko": "bitcoin", "yahoo": "BTC-USD"}},
    ]


def _clear(db):
    db.query(InstrumentMaster).delete()
    db.commit()


def test_replace_rows_is_idempotent_and_scoped_by_source():
    init_db()
    db = SessionLocal()
    try:
        _clear(db)
        populate.replace_rows(db, _us_rows(), populate.SOURCE_US)
        populate.replace_rows(db, _eu_rows(), populate.SOURCE_EU)
        populate.replace_rows(db, _crypto_rows(), populate.SOURCE_CRYPTO)
        assert db.query(InstrumentMaster).count() == 4

        # Re-running US replaces only the US slice (no dupes); EU (also
        # type='equity') and crypto are untouched.
        populate.replace_rows(db, _us_rows(), populate.SOURCE_US)
        assert db.query(InstrumentMaster).count() == 4
        assert db.query(InstrumentMaster).filter(InstrumentMaster.source == "eu").count() == 1
        assert db.query(InstrumentMaster).filter(InstrumentMaster.source == "crypto").count() == 1
    finally:
        _clear(db)
        db.close()


def test_replace_rows_empty_does_not_wipe():
    init_db()
    db = SessionLocal()
    try:
        _clear(db)
        populate.replace_rows(db, _us_rows(), populate.SOURCE_US)
        assert populate.replace_rows(db, [], populate.SOURCE_US) == 0
        assert db.query(InstrumentMaster).count() == 2
    finally:
        _clear(db)
        db.close()


def test_seed_if_empty_populates_when_empty(monkeypatch):
    init_db()
    db = SessionLocal()
    try:
        _clear(db)
    finally:
        db.close()

    called = {"n": 0}

    async def _fake_refresh(**_kwargs):
        called["n"] += 1
        d = SessionLocal()
        try:
            populate.replace_rows(d, _us_rows(), populate.SOURCE_US)
        finally:
            d.close()
        return {"us": 2, "eu": 0, "crypto": 0}

    monkeypatch.setattr(populate, "refresh_instrument_master", _fake_refresh)
    asyncio.run(populate.seed_if_empty())
    assert called["n"] == 1

    db = SessionLocal()
    try:
        assert db.query(InstrumentMaster).count() == 2
    finally:
        _clear(db)
        db.close()


def test_seed_if_empty_skips_when_populated(monkeypatch):
    init_db()
    db = SessionLocal()
    try:
        _clear(db)
        populate.replace_rows(db, _us_rows(), populate.SOURCE_US)
    finally:
        db.close()

    called = {"n": 0}

    async def _fake_refresh(**_kwargs):
        called["n"] += 1
        return {}

    monkeypatch.setattr(populate, "refresh_instrument_master", _fake_refresh)
    asyncio.run(populate.seed_if_empty())
    assert called["n"] == 0  # already populated -> no fetch

    db = SessionLocal()
    try:
        _clear(db)
    finally:
        db.close()


def test_refresh_instrument_master_writes_all_sources(monkeypatch):
    init_db()
    db = SessionLocal()
    try:
        _clear(db)
    finally:
        db.close()

    async def _fake_us():
        return _us_rows()

    async def _fake_eu():
        return _eu_rows()

    async def _fake_crypto(limit=300):  # noqa: ARG001
        return _crypto_rows()

    monkeypatch.setattr(populate, "fetch_us_equities", _fake_us)
    monkeypatch.setattr(populate, "fetch_eu_equities", _fake_eu)
    monkeypatch.setattr(populate, "fetch_crypto", _fake_crypto)

    counts = asyncio.run(populate.refresh_instrument_master())
    assert counts == {"us": 2, "eu": 1, "crypto": 1}

    db = SessionLocal()
    try:
        assert any(r.display_symbol == "AAPL" for r in search_instruments(db, "apple"))
        assert any(r.display_symbol == "ADS.DE" for r in search_instruments(db, "adidas"))
        btc = search_instruments(db, "BTC-USD")
        assert btc and btc[0].type == "crypto"
    finally:
        _clear(db)
        db.close()
