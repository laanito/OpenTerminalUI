from __future__ import annotations

import asyncio

from backend.services import crypto_derivatives_service as svc


def test_load_depth_map_builds_real_notional_and_imbalance(monkeypatch) -> None:
    class _FakeClient:
        async def get_book_tickers(self):
            return [
                {"symbol": "BTCUSDT", "bidPrice": "100", "bidQty": "20000", "askPrice": "101", "askQty": "10000"},
                {"symbol": "ETHUSDT", "bidPrice": "10", "bidQty": "100", "askPrice": "10", "askQty": "100"},
                {"symbol": "ETHBTC", "bidPrice": "0.05", "bidQty": "5", "askPrice": "0.05", "askQty": "5"},
                {"not": "a ticker"},
            ]

        async def close(self):
            return None

    monkeypatch.setattr(svc, "BinanceClient", lambda *a, **k: _FakeClient())
    out = asyncio.run(svc.load_depth_map())

    # Only USDT-quoted pairs map to app symbols; ETHBTC and the junk row drop out.
    assert set(out) == {"BTC-USD", "ETH-USD"}
    btc = out["BTC-USD"]
    assert btc["bid_notional"] == 100 * 20000
    assert btc["ask_notional"] == 101 * 10000
    # bid notional > ask notional → positive imbalance, clamped to [-1, 1].
    assert 0.0 < btc["imbalance"] <= 1.0
    # Perfectly balanced book → zero imbalance.
    assert out["ETH-USD"]["imbalance"] == 0.0


def test_load_funding_oi_combines_premium_and_open_interest(monkeypatch) -> None:
    oi_calls: list[str] = []

    class _FakeClient:
        async def get_premium_index(self):
            return [
                {"symbol": "BTCUSDT", "markPrice": "100", "lastFundingRate": "0.0001"},
                {"symbol": "ETHUSDT", "markPrice": "10", "lastFundingRate": "-0.00005"},
            ]

        async def get_open_interest(self, symbol):
            oi_calls.append(symbol)
            return {"BTCUSDT": 1000.0, "ETHUSDT": 2000.0}.get(symbol)

        async def close(self):
            return None

    monkeypatch.setattr(svc, "BinanceClient", lambda *a, **k: _FakeClient())
    out = asyncio.run(svc.load_funding_oi(["BTC-USD", "ETH-USD", "DOGE-USD"]))

    # DOGE has no perp in premiumIndex → omitted, never zero-padded.
    assert set(out) == {"BTC-USD", "ETH-USD"}
    assert out["BTC-USD"]["funding_rate_8h"] == 0.0001
    # open_interest_usd = contracts * mark price.
    assert out["BTC-USD"]["open_interest_usd"] == 1000.0 * 100
    assert out["ETH-USD"]["open_interest_usd"] == 2000.0 * 10
    # OI is only queried for symbols Binance actually lists as perps.
    assert set(oi_calls) == {"BTCUSDT", "ETHUSDT"}


def test_load_funding_oi_empty_when_no_premium(monkeypatch) -> None:
    class _FakeClient:
        async def get_premium_index(self):
            return []

        async def close(self):
            return None

    monkeypatch.setattr(svc, "BinanceClient", lambda *a, **k: _FakeClient())
    assert asyncio.run(svc.load_funding_oi(["BTC-USD"])) == {}
