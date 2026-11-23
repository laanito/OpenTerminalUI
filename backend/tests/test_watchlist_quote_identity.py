import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.instruments.models import InstrumentMaster
from backend.services.watchlist_quotes import resolve_watchlist_quotes
from backend.services.marketdata_hub import MarketDataHub, _parse_symbol_token
from backend.shared.db import Base


def test_watchlist_routes_resolve_each_identity_without_ui_market_or_provider_calls():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([
            InstrumentMaster(canonical_id="YAHOO:NEWCO", display_symbol="NEWCO", type="equity", exchange="NMS", currency=None),
            InstrumentMaster(canonical_id="NSE:RELIANCE", display_symbol="RELIANCE", type="equity", exchange="NSE", currency="INR"),
            InstrumentMaster(canonical_id="NSE:TCS", display_symbol="TCS", type="equity", exchange="NSE", currency="INR"),
            InstrumentMaster(canonical_id="NYSE:TCS", display_symbol="TCS", type="equity", exchange="NYSE", currency="USD"),
        ])
        db.commit()
        result = resolve_watchlist_quotes(db, ["NEWCO", "AAPL", "MWRE.DE", "MIGA.MU", "SAP.DE", "BTC-USD", "BTC-EUR", "RELIANCE", "TCS", "NSE:TCS", "RELIANCE.NS", "CRYPTO:MWRE.DE"])
        assert result["NEWCO"]["market"] == "NASDAQ" and result["NEWCO"]["currency"] == "USD"
        assert (result["AAPL"]["market"], result["AAPL"]["currency"]) == ("NASDAQ", "USD")
        for symbol in ["MWRE.DE", "MIGA.MU", "SAP.DE"]:
            assert (result[symbol]["market"], result[symbol]["quote_symbol"], result[symbol]["currency"]) == ("EU", symbol, "EUR")
        assert result["BTC-EUR"]["market"] == "CRYPTO" and result["BTC-EUR"]["currency"] == "EUR"
        assert result["BTC-USD"]["currency"] == "USD"
        assert result["RELIANCE"]["market"] == "NSE" and result["RELIANCE"]["currency"] == "INR"
        assert result["RELIANCE.NS"]["quote_symbol"] == "RELIANCE"
        assert result["TCS"]["status"] == "ambiguous" and result["TCS"]["market"] is None
        assert result["NSE:TCS"]["market"] == "NSE"
        assert result["CRYPTO:MWRE.DE"]["market"] == "EU" and result["CRYPTO:MWRE.DE"]["quote_symbol"] == "MWRE.DE"
        assert db.query(InstrumentMaster).count() == 4
    engine.dispose()


def test_eu_subscriptions_are_accepted_and_poll_unsuffixed_listing():
    async def run():
        socket = object()
        hub = MarketDataHub.__new__(MarketDataHub)
        hub._lock = asyncio.Lock(); hub._connections = {socket: set()}
        hub._sync_stream_subscriptions = AsyncMock()
        assert _parse_symbol_token("EU:MWRE.DE") == ("EU", "MWRE.DE")
        assert await hub.subscribe(socket, ["EU:MWRE.DE", "NASDAQ:AAPL", "CRYPTO:BTC-USD"]) == ["EU:MWRE.DE", "NASDAQ:AAPL", "CRYPTO:BTC-USD"]
        yahoo = SimpleNamespace(get_quotes=AsyncMock(return_value=[{"symbol": "MWRE.DE", "regularMarketPrice": 12}]))
        rows = await hub._fetch_quotes_batch(SimpleNamespace(yahoo=yahoo), "EU", ["MWRE.DE"])
        assert rows[0]["last"] == 12
        yahoo.get_quotes.assert_awaited_once_with(["MWRE.DE"])
        assert await hub.unsubscribe(socket, ["EU:MWRE.DE"]) == ["EU:MWRE.DE"]
    asyncio.run(run())


def test_polled_native_quote_units_are_not_relabelled_or_converted(monkeypatch):
    from backend.services import marketdata_hub
    fetcher = SimpleNamespace(yahoo=SimpleNamespace(get_quotes=AsyncMock(return_value=[{"symbol": "III.L", "regularMarketPrice": 153, "currency": "GBp"}])))
    monkeypatch.setattr(marketdata_hub, "get_unified_fetcher", AsyncMock(return_value=fetcher))
    hub = MarketDataHub.__new__(MarketDataHub)
    tick = asyncio.run(hub._fetch_ticks(["EU:III.L"]))["EU:III.L"]
    assert tick["ltp"] == 153 and tick["currency"] == "GBp"


def test_live_usd_crypto_stream_does_not_suppress_eur_pair_polling(monkeypatch):
    from backend.services import marketdata_hub
    async def run():
        hub = MarketDataHub.__new__(MarketDataHub)
        hub._running = True; hub._kite_stream = None
        hub._finnhub_ws = SimpleNamespace(connected=False)
        hub._binance_ws = SimpleNamespace(connected=True)
        hub._union_subscriptions = AsyncMock(return_value={"CRYPTO:BTC-USD", "CRYPTO:BTC-EUR", "EU:MWRE.DE"})
        hub._fetch_ticks = AsyncMock(return_value={})
        hub.poll_interval_seconds = 2
        monkeypatch.setattr(marketdata_hub.asyncio, "sleep", AsyncMock(side_effect=asyncio.CancelledError))
        with pytest.raises(asyncio.CancelledError):
            await hub._poll_loop()
        hub._fetch_ticks.assert_awaited_once_with(["CRYPTO:BTC-EUR", "EU:MWRE.DE"])
    asyncio.run(run())
