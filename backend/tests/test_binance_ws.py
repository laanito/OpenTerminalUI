from __future__ import annotations

import asyncio

from backend.services.binance_ws import (
    BinanceSpotWebSocket,
    app_symbol_from_binance,
    parse_ticker_message,
    to_binance_stream,
)


def test_to_binance_stream():
    assert to_binance_stream("BTC-USD") == "btcusdt"
    assert to_binance_stream("eth-usd") == "ethusdt"
    assert to_binance_stream("RENDER-USD") == "renderusdt"
    assert to_binance_stream("AAPL") is None  # not -USD
    assert to_binance_stream("") is None


def test_app_symbol_from_binance():
    assert app_symbol_from_binance("BTCUSDT") == "BTC-USD"
    assert app_symbol_from_binance("ethusdt") == "ETH-USD"
    assert app_symbol_from_binance("BTC") is None
    assert app_symbol_from_binance("") is None


def test_roundtrip():
    for sym in ["BTC-USD", "ETH-USD", "SOL-USD"]:
        stream = to_binance_stream(sym)
        assert stream is not None
        assert app_symbol_from_binance(stream.upper()) == sym


def test_parse_ticker_message():
    msg = {"e": "24hrTicker", "E": 1700000000000, "s": "BTCUSDT", "c": "67000.5", "P": "1.82", "p": "1200", "v": "12345"}
    parsed = parse_ticker_message(msg)
    assert parsed == ("BTC-USD", 67000.5, 1.82, 12345.0, 1700000000000)
    # Wrong event type / shape -> None
    assert parse_ticker_message({"e": "depthUpdate", "s": "BTCUSDT"}) is None
    assert parse_ticker_message({"e": "24hrTicker", "s": "FOOBAR"}) is None  # not USDT
    assert parse_ticker_message("nope") is None


def test_set_symbols_maps_to_streams_without_connection():
    ws = BinanceSpotWebSocket(lambda *a: None)
    asyncio.run(ws.set_symbols({"BTC-USD", "ETH-USD", "AAPL"}))
    # AAPL dropped (not crypto); others mapped to @ticker streams.
    assert ws._desired_streams == {"btcusdt@ticker", "ethusdt@ticker"}  # noqa: SLF001
