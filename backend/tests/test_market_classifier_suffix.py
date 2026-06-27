from __future__ import annotations

import asyncio

from backend.shared.market_classifier import (
    MarketClassifier,
    crypto_quote_currency,
    is_crypto_symbol,
)


def test_foreign_suffix_classified_without_network():
    # Known foreign Yahoo suffixes resolve to their real country deterministically
    # (no FMP/NSE lookup), so a non-IN symbol never falls through to the India
    # default and never triggers a spurious NSE quote call.
    mc = MarketClassifier()

    async def run():
        cases = [
            ("III.L", "LSE", "GB"),
            ("ADS.DE", "XETRA", "DE"),
            ("NESN.SW", "SIX", "CH"),
            ("AC.PA", "EURONEXT", "FR"),
            ("ENI.MI", "BIT", "IT"),
            ("EQNR.OL", "OSE", "NO"),
        ]
        for sym, exch, cc in cases:
            c = await mc.classify(sym)
            assert c.country_code == cc, (sym, c.country_code)
            assert c.exchange == exch
            # base symbol keeps the full Yahoo ticker so quotes/charts route right
            assert c.symbol == sym
            # and yfinance_symbol echoes it verbatim (non-IN path)
            assert await mc.yfinance_symbol(sym) == sym

    asyncio.run(run())


def test_indian_suffix_still_classified_in():
    mc = MarketClassifier()

    async def run():
        c = await mc.classify("RELIANCE.NS")
        assert c.country_code == "IN" and c.exchange == "NSE"

    asyncio.run(run())


def test_crypto_pairs_classified_as_global_crypto_without_network():
    # Crypto pairs must not fall through to the NASDAQ/US default (which rendered
    # a wrong US flag). They classify deterministically as a global 24/7 asset
    # whose display currency is the pair's quote leg.
    mc = MarketClassifier()

    async def run():
        cases = [
            ("BTC-USD", "USD"),
            ("ETH-USD", "USD"),
            ("BTC-EUR", "EUR"),
            ("BTCUSDT", "USD"),
            ("CRYPTO:SOL-USD", "USD"),
        ]
        for sym, currency in cases:
            c = await mc.classify(sym)
            assert c.exchange == "CRYPTO", (sym, c.exchange)
            assert c.country_code == "", (sym, c.country_code)
            assert c.flag_emoji == "🌐"
            assert c.currency == currency, (sym, c.currency)
            assert c.has_futures is False and c.has_options is False
            assert c.market_status == "open"

    asyncio.run(run())


def test_crypto_detection_helpers():
    assert is_crypto_symbol("BTC-USD") is True
    assert is_crypto_symbol("ETH-EUR") is True
    assert is_crypto_symbol("BTCUSDT") is True
    assert is_crypto_symbol("CRYPTO:DOGE-USD") is True
    assert is_crypto_symbol("AAPL") is False
    assert is_crypto_symbol("RELIANCE.NS") is False
    assert is_crypto_symbol("JEIP.DE") is False
    # Quote leg drives the display currency; stablecoins resolve to their fiat.
    assert crypto_quote_currency("BTC-USD") == "USD"
    assert crypto_quote_currency("BTC-EUR") == "EUR"
    assert crypto_quote_currency("BTCUSDT") == "USD"
    assert crypto_quote_currency("ETH-GBP") == "GBP"
